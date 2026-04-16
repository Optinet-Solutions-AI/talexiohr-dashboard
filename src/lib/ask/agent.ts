import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { getAvailableToolDefinitions, executeTool } from './tools'
import { buildSystemPrompt } from './systemPrompt'
import type { AskResult, ToolCallRecord } from './types'

export const MAX_ITERATIONS = 5
export const MAX_TOKENS_PER_REQUEST = 8000
export const MAX_TOOL_RESULT_BYTES = 10 * 1024

export async function runAgent(params: {
  question: string
  openai: OpenAI
  supabase: SupabaseClient
}): Promise<AskResult> {
  const { question, openai, supabase } = params
  const started = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(today) },
    { role: 'user', content: question },
  ]
  const toolCalls: ToolCallRecord[] = []
  let totalTokens = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: getAvailableToolDefinitions(),
      tool_choice: 'auto',
      temperature: 0.2,
    })
    totalTokens += res.usage?.total_tokens ?? 0
    if (totalTokens > MAX_TOKENS_PER_REQUEST) {
      throw new Error('Token budget exceeded')
    }

    const msg = res.choices[0]?.message
    if (!msg) throw new Error('Empty response from OpenAI')
    messages.push(msg as ChatCompletionMessageParam)

    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      return {
        answer: msg.content ?? '',
        toolCalls,
        totalTokens,
        totalDurationMs: Date.now() - started,
      }
    }

    for (const call of calls) {
      const t0 = Date.now()
      let record: ToolCallRecord
      let toolOutput: unknown
      try {
        if (call.type !== 'function') {
          continue
        }
        const fn = call.function
        const out = await executeTool(fn.name, fn.arguments, supabase)
        const serialized = JSON.stringify(out.result)
        const truncated = serialized.length > MAX_TOOL_RESULT_BYTES
        toolOutput = truncated ? serialized.slice(0, MAX_TOOL_RESULT_BYTES) + '"...(truncated)"' : serialized
        record = {
          tool: fn.name,
          args: safeJson(fn.arguments),
          rowCount: out.rowCount,
          durationMs: Date.now() - t0,
          truncated,
        }
      } catch (err) {
        toolOutput = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        const fn = call.type === 'function' ? call.function : { name: call.type, arguments: '{}' }
        record = {
          tool: fn.name,
          args: safeJson(fn.arguments),
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
        content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
      })
    }
  }

  throw new Error('Agent iteration cap reached without final answer')
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
