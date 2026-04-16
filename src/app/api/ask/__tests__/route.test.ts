import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('openai', () => ({ default: class OpenAI {} }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@/lib/ask/guards', () => ({
  validateInput: () => ({ ok: true }),
  isRelevant: async () => true,
  checkRateLimit: async () => ({ allowed: true }),
  RATE_LIMIT_PER_HOUR: 30,
  QUESTION_CHAR_LIMIT: 500,
}))
vi.mock('@/lib/ask/logging', () => ({ writeLog: async () => {} }))
vi.mock('@/lib/ask/agent', () => ({
  runAgent: async ({ onEvent }: { onEvent?: (e: { type: 'status' | 'token'; stage?: string; message?: string; delta?: string }) => void }) => {
    onEvent?.({ type: 'status', stage: 'agent_call' })
    onEvent?.({ type: 'status', stage: 'tool_call', message: 'Analyzing attendance...' })
    onEvent?.({ type: 'token', delta: 'Hello ' })
    onEvent?.({ type: 'token', delta: 'world' })
    return {
      answer: 'Hello world',
      toolCalls: [{ tool: 'query_attendance', args: { from: '2026-04-01', to: '2026-04-16' }, rowCount: 5, durationMs: 100, truncated: false }],
      totalTokens: 150,
      totalDurationMs: 800,
    }
  },
}))

import { POST } from '../route'

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

describe('POST /api/ask SSE framing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns text/event-stream for accepted questions', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('emits status, token, and done events in order', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)

    const firstStatus = text.indexOf('event: status')
    const firstToken  = text.indexOf('event: token')
    const done        = text.indexOf('event: done')

    expect(firstStatus).toBeGreaterThanOrEqual(0)
    expect(firstToken).toBeGreaterThan(firstStatus)
    expect(done).toBeGreaterThan(firstToken)
  })

  it('includes the mock tool_call status message', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)
    expect(text).toContain('"message":"Analyzing attendance..."')
  })

  it('emits deltas from the mock onEvent token events', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)
    expect(text).toContain('"delta":"Hello "')
    expect(text).toContain('"delta":"world"')
  })

  it('done payload carries the full context', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)
    expect(text).toContain('"answer":"Hello world"')
    expect(text).toContain('"recordCount":5')
    expect(text).toContain('"from":"2026-04-01"')
  })
})
