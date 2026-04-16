import { describe, it, expect, vi } from 'vitest'
import { writeLog } from '../logging'

function makeSupabase() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn().mockReturnValue({ insert })
  return { supabase: { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>, insert }
}

describe('writeLog', () => {
  it('inserts a row with provided fields', async () => {
    const { supabase, insert } = makeSupabase()
    await writeLog(supabase, {
      userId: 'u1',
      question: 'q',
      relevancePassed: true,
      rateLimited: false,
      toolCalls: [],
      finalAnswer: 'a',
      totalTokens: 100,
      totalDurationMs: 1234,
    })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1',
      question: 'q',
      relevance_passed: true,
      rate_limited: false,
      tool_calls: [],
      final_answer: 'a',
      total_tokens: 100,
      total_duration_ms: 1234,
      error: null,
    })
  })

  it('swallows insert errors (logging must not break the handler)', async () => {
    const from = vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }),
    })
    const supabase = { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
    await expect(writeLog(supabase, { question: 'q' })).resolves.toBeUndefined()
  })
})
