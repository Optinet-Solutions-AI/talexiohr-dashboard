import { describe, it, expect, vi } from 'vitest'
import { checkRateLimit, RATE_LIMIT_PER_HOUR } from '../guards'

function makeSupabase(count: number) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    then: (resolve: (v: { count: number; error: null }) => void) => resolve({ count, error: null }),
  }
  const from = vi.fn().mockReturnValue(chain)
  return { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
}

describe('checkRateLimit', () => {
  it('allows under the threshold', async () => {
    const sb = makeSupabase(RATE_LIMIT_PER_HOUR - 1)
    const res = await checkRateLimit('user-1', sb)
    expect(res.allowed).toBe(true)
  })
  it('blocks at the threshold', async () => {
    const sb = makeSupabase(RATE_LIMIT_PER_HOUR)
    const res = await checkRateLimit('user-1', sb)
    expect(res.allowed).toBe(false)
    if (res.allowed) throw new Error('unreachable')
    expect(res.retryAfterSeconds).toBeGreaterThan(0)
  })
  it('allows when no user id (public access)', async () => {
    const sb = makeSupabase(9999)
    const res = await checkRateLimit(null, sb)
    expect(res.allowed).toBe(true)
  })
})
