import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listEmployees } from '../tools/listEmployees'

type FakeResponse = { data: unknown; error: null }

function makeSupabaseMock(rows: unknown[], count: number) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: FakeResponse) => void) => resolve({ data: rows, error: null }),
  }
  const from = vi.fn().mockReturnValue(chain)
  return {
    supabase: { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
    chain,
    count,
  }
}

describe('listEmployees', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns employees with default filters (excluded=false)', async () => {
    const { supabase, chain } = makeSupabaseMock(
      [{ id: '1', full_name: 'Alice', talexio_id: 'A1', unit: 'Ops', position: 'Dev', group_type: 'office_malta', job_schedule: null }],
      1,
    )
    const res = await listEmployees({}, supabase)
    expect(res.employees).toHaveLength(1)
    expect(res.employees[0].name).toBe('Alice')
    expect(chain.eq).toHaveBeenCalledWith('excluded', false)
  })

  it('applies groupType filter', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ filters: { groupType: 'remote' } }, supabase)
    expect(chain.eq).toHaveBeenCalledWith('group_type', 'remote')
  })

  it('applies search via ilike on full_name', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ filters: { search: 'youss' } }, supabase)
    expect(chain.ilike).toHaveBeenCalledWith('full_name', '%youss%')
  })

  it('caps limit at 1000', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ limit: 99999 }, supabase)
    expect(chain.limit).toHaveBeenCalledWith(1000)
  })

  it('includeExcluded=true drops the excluded filter', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ filters: { includeExcluded: true } }, supabase)
    expect(chain.eq).not.toHaveBeenCalledWith('excluded', false)
  })
})
