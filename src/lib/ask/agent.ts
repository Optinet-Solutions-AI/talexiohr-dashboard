import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { getAvailableToolDefinitions, executeTool } from './tools'
import { buildSystemPrompt } from './systemPrompt'
import { statusMessageForTool } from './statusMessages'
import type { AskResult, ToolCallRecord } from './types'

export const MAX_ITERATIONS = 5
export const MAX_TOKENS_PER_REQUEST = 8000
export const MAX_TOOL_RESULT_BYTES = 10 * 1024

export type AgentEvent =
  | { type: 'status'; stage: 'agent_call' | 'tool_call'; message?: string }
  | { type: 'token'; delta: string }

type AccumulatedToolCall = {
  index: number
  id: string
  name: string
  argsFragments: string[]
}

export async function runAgent(params: {
  question: string
  openai: OpenAI
  supabase: SupabaseClient
  onEvent?: (e: AgentEvent) => void
  signal?: AbortSignal
}): Promise<AskResult> {
  const { question, openai, supabase, onEvent, signal } = params
  const started = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(today) },
    { role: 'user', content: question },
  ]
  const toolCalls: ToolCallRecord[] = []
  let totalTokens = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) {
      throw new Error('Client disconnected')
    }
    onEvent?.({ type: 'status', stage: 'agent_call' })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: getAvailableToolDefinitions(),
      tool_choice: 'auto',
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true },
    }, { signal })

    let content = ''
    const deltaBuffer: string[] = []
    const accToolCalls = new Map<number, AccumulatedToolCall>()
    for await (const chunk of response as AsyncIterable<unknown>) {
      const c = chunk as {
        choices?: Array<{
          delta?: {
            content?: string | null
            tool_calls?: Array<{
              index: number
              id?: string
              type?: 'function'
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: 'stop' | 'tool_calls' | 'length' | null
        }>
        usage?: { total_tokens: number }
      }

      const choice = c.choices?.[0]
      const delta = choice?.delta
      if (!delta) {
        if (c.usage) totalTokens += c.usage.total_tokens
        continue
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content
        // Buffer the delta. We can't emit token events yet — this iteration
        // might turn out to have tool calls, in which case the content is
        // preamble, not the final answer.
        deltaBuffer.push(delta.content)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let entry = accToolCalls.get(tc.index)
          if (!entry) {
            entry = { index: tc.index, id: tc.id ?? '', name: tc.function?.name ?? '', argsFragments: [] }
            accToolCalls.set(tc.index, entry)
          }
          if (tc.id) entry.id = tc.id
          if (tc.function?.name) entry.name = tc.function.name
          if (tc.function?.arguments) entry.argsFragments.push(tc.function.arguments)
        }
      }

      if (c.usage) totalTokens += c.usage.total_tokens
    }

    if (totalTokens > MAX_TOKENS_PER_REQUEST) {
      throw new Error('Token budget exceeded')
    }

    // If this iteration has no tool calls, it produced the final answer — emit
    // the buffered content deltas as token events now.
    if (accToolCalls.size === 0) {
      for (const piece of deltaBuffer) {
        onEvent?.({ type: 'token', delta: piece })
      }
    }

    // If no tool calls, this is the final iteration
    if (accToolCalls.size === 0) {
      return {
        answer: content,
        toolCalls,
        totalTokens,
        totalDurationMs: Date.now() - started,
      }
    }

    // Reassemble tool calls and push an assistant message
    const reassembled = [...accToolCalls.values()].sort((a, b) => a.index - b.index).map(e => ({
      id: e.id,
      type: 'function' as const,
      function: { name: e.name, arguments: e.argsFragments.join('') },
    }))

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: reassembled,
    } as ChatCompletionMessageParam)

    // Execute each tool
    for (const call of reassembled) {
      if (signal?.aborted) {
        throw new Error('Client disconnected')
      }
      onEvent?.({ type: 'status', stage: 'tool_call', message: statusMessageForTool(call.function.name) })

      const t0 = Date.now()
      let record: ToolCallRecord
      let toolOutput: string
      try {
        const out = await executeTool(call.function.name, call.function.arguments, supabase)
        const serialized = JSON.stringify(out.result)
        const truncated = serialized.length > MAX_TOOL_RESULT_BYTES
        toolOutput = truncated ? serialized.slice(0, MAX_TOOL_RESULT_BYTES) + '"...(truncated)"' : serialized
        record = {
          tool: call.function.name,
          args: safeJson(call.function.arguments),
          rowCount: out.rowCount,
          durationMs: Date.now() - t0,
          truncated,
        }
      } catch (err) {
        toolOutput = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        record = {
          tool: call.function.name,
          args: safeJson(call.function.arguments),
          rowCount: null,
          durationMs: Date.now() - t0,
          truncated: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
      toolCalls.push(record)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolOutput,
      })
    }

  }

  throw new Error('Agent iteration cap reached without final answer')
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
