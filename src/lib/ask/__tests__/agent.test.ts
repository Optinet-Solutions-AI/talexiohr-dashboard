import { describe, it, expect, vi } from 'vitest'

vi.mock('../tools', () => ({
  TOOL_DEFINITIONS: [],
  executeTool: vi.fn(),
}))

import { runAgent, MAX_ITERATIONS, MAX_TOOL_RESULT_BYTES } from '../agent'
import { executeTool } from '../tools'

function makeOpenAI(responses: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: string }> }>) {
  let i = 0
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          const r = responses[i++]
          return {
            choices: [{
              message: {
                content: r.content ?? null,
                tool_calls: r.toolCalls?.map(tc => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.args },
                })),
              },
            }],
            usage: { total_tokens: 100 },
          }
        }),
      },
    },
  }
}

describe('runAgent', () => {
  it('returns immediately when the model responds with no tool call', async () => {
    const openai = makeOpenAI([{ content: 'Hello world' }])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Hello world')
    expect(res.toolCalls).toHaveLength(0)
  })

  it('executes tool calls and loops until a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: { rows: [{ x: 1 }] }, rowCount: 1 })
    const openai = makeOpenAI([
      { toolCalls: [{ id: 't1', name: 'query_attendance', args: '{}' }] },
      { content: 'Final' },
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Final')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0].tool).toBe('query_attendance')
  })

  it('throws when the iteration cap is hit without a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: {}, rowCount: 0 })
    const loops = Array.from({ length: MAX_ITERATIONS + 1 }, (_, i) => ({
      toolCalls: [{ id: `t${i}`, name: 'list_employees', args: '{}' }],
    }))
    const openai = makeOpenAI(loops)
    const supabase = {} as never
    await expect(runAgent({ question: 'q', openai: openai as never, supabase })).rejects.toThrow(/iteration cap/i)
  })

  it('truncates tool results larger than the cap', async () => {
    const big = { huge: 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1000) }
    vi.mocked(executeTool).mockResolvedValue({ result: big, rowCount: 1 })
    const openai = makeOpenAI([
      { toolCalls: [{ id: 't1', name: 'run_readonly_sql', args: '{}' }] },
      { content: 'done' },
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.toolCalls[0].truncated).toBe(true)
  })
})
