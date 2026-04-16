import { describe, it, expect, vi } from 'vitest'
import { listOnStatus } from '../tools/listOnStatus'

function makeSupabase(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  const from = vi.fn().mockReturnValue(chain)
  return { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
}

describe('listOnStatus', () => {
  it('defaults date to today if omitted', async () => {
    const sb = makeSupabase([])
    await listOnStatus({ status: 'vacation' }, sb)
    const chain = (sb.from as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    const today = new Date().toISOString().slice(0, 10)
    expect(chain.eq).toHaveBeenCalledWith('date', today)
  })

  it('filters on the provided status', async () => {
    const sb = makeSupabase([])
    await listOnStatus({ date: '2026-04-16', status: 'sick' }, sb)
    const chain = (sb.from as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(chain.eq).toHaveBeenCalledWith('status', 'sick')
    expect(chain.eq).toHaveBeenCalledWith('date', '2026-04-16')
  })

  it('maps joined rows to employee summaries', async () => {
    const sb = makeSupabase([
      {
        hours_worked: 0, time_in: null, time_out: null,
        employees: { full_name: 'Alice', unit: 'Ops', excluded: false, group_type: 'office_malta' },
      },
    ])
    const res = await listOnStatus({ date: '2026-04-16', status: 'vacation' }, sb)
    expect(res.employees).toEqual([{ name: 'Alice', unit: 'Ops', hours: 0, timeIn: null, timeOut: null }])
  })

  it('excludes employees with excluded=true', async () => {
    const sb = makeSupabase([
      { hours_worked: 0, time_in: null, time_out: null, employees: { full_name: 'A', unit: null, excluded: false, group_type: null } },
      { hours_worked: 0, time_in: null, time_out: null, employees: { full_name: 'B', unit: null, excluded: true, group_type: null } },
    ])
    const res = await listOnStatus({ date: '2026-04-16', status: 'vacation' }, sb)
    expect(res.employees.map(e => e.name)).toEqual(['A'])
  })
})
