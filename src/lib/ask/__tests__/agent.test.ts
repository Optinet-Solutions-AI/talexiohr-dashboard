import { describe, it, expect, vi } from 'vitest'

vi.mock('../tools', () => ({
  TOOL_DEFINITIONS: [],
  getAvailableToolDefinitions: () => [],
  executeTool: vi.fn(),
}))

import { runAgent, MAX_ITERATIONS, MAX_TOOL_RESULT_BYTES, type AgentEvent } from '../agent'
import { executeTool } from '../tools'

type FakeChunk = {
  choices: Array<{
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: 'stop' | 'tool_calls' | null
  }>
  usage?: { total_tokens: number }
}

// Build a content-only streaming response as an async iterable
function contentStream(text: string, tokens?: number): AsyncIterable<FakeChunk> {
  const parts = text.match(/.{1,4}/g) ?? [text]
  const chunks: FakeChunk[] = parts.map((p, i) => ({
    choices: [{ delta: { content: p }, finish_reason: i === parts.length - 1 ? 'stop' : null }],
  }))
  // Final usage chunk
  chunks.push({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: tokens ?? 100 } })
  return (async function* () { for (const c of chunks) yield c })()
}

// Build a tool-call streaming response
function toolCallStream(calls: Array<{ id: string; name: string; args: string }>, tokens = 50): AsyncIterable<FakeChunk> {
  const chunks: FakeChunk[] = []
  // Emit each tool call's id/name on first chunk for that index, then stream the args
  for (const [i, c] of calls.entries()) {
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] }, finish_reason: null }] })
    // Split args into ~4-char fragments
    const fragments = c.args.match(/.{1,4}/g) ?? [c.args]
    for (const f of fragments) {
      chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: f } }] }, finish_reason: null }] })
    }
  }
  chunks.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { total_tokens: tokens } })
  return (async function* () { for (const c of chunks) yield c })()
}

function makeOpenAI(streams: AsyncIterable<FakeChunk>[]) {
  let i = 0
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => streams[i++]),
      },
    },
  }
}

describe('runAgent (streaming-based)', () => {
  it('returns immediately when the model responds with text only', async () => {
    const openai = makeOpenAI([contentStream('Hello world')])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Hello world')
    expect(res.toolCalls).toHaveLength(0)
  })

  it('executes tool calls and loops until a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: { rows: [{ x: 1 }] }, rowCount: 1 })
    const openai = makeOpenAI([
      toolCallStream([{ id: 't1', name: 'query_attendance', args: '{}' }]),
      contentStream('Final'),
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Final')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0].tool).toBe('query_attendance')
  })

  it('throws when the iteration cap is hit without a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: {}, rowCount: 0 })
    const streams = Array.from({ length: MAX_ITERATIONS + 1 }, (_, i) =>
      toolCallStream([{ id: `t${i}`, name: 'list_employees', args: '{}' }]),
    )
    const openai = makeOpenAI(streams)
    const supabase = {} as never
    await expect(runAgent({ question: 'q', openai: openai as never, supabase })).rejects.toThrow(/iteration cap/i)
  })

  it('truncates tool results larger than the cap', async () => {
    const big = { huge: 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1000) }
    vi.mocked(executeTool).mockResolvedValue({ result: big, rowCount: 1 })
    const openai = makeOpenAI([
      toolCallStream([{ id: 't1', name: 'run_readonly_sql', args: '{}' }]),
      contentStream('done'),
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.toolCalls[0].truncated).toBe(true)
  })

  it('emits onEvent status events for each iteration and tool call', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: {}, rowCount: 0 })
    const events: AgentEvent[] = []
    const openai = makeOpenAI([
      toolCallStream([{ id: 't1', name: 'query_attendance', args: '{}' }]),
      contentStream('Done'),
    ])
    await runAgent({
      question: 'q',
      openai: openai as never,
      supabase: {} as never,
      onEvent: (e) => events.push(e),
    })
    const statuses = events.filter(e => e.type === 'status')
    expect(statuses.length).toBeGreaterThanOrEqual(3) // agent_call, tool_call, agent_call
    const toolCallStatus = statuses.find(s => s.type === 'status' && s.stage === 'tool_call')
    expect(toolCallStatus && toolCallStatus.type === 'status' ? toolCallStatus.message : undefined).toBe('Analyzing attendance...')
  })

  it('emits onEvent token events as content streams', async () => {
    const events: AgentEvent[] = []
    const openai = makeOpenAI([contentStream('Hello there')])
    await runAgent({
      question: 'q',
      openai: openai as never,
      supabase: {} as never,
      onEvent: (e) => events.push(e),
    })
    const tokens = events.filter(e => e.type === 'token')
    expect(tokens.length).toBeGreaterThan(0)
    const assembled = tokens.map(t => (t as { type: 'token'; delta: string }).delta).join('')
    expect(assembled).toBe('Hello there')
  })
})
