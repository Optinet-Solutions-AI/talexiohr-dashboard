import { describe, it, expect, vi } from 'vitest'
import { queryAttendance } from '../tools/queryAttendance'

function makeSupabase(rows: unknown[]) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  return { rpc } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
}

describe('queryAttendance', () => {
  it('calls rpc with the right params', async () => {
    const sb = makeSupabase([])
    await queryAttendance({
      from: '2026-04-01', to: '2026-04-16',
      groupBy: 'employee',
      metrics: ['office_days', 'total_hours'],
    }, sb)
    const rpc = sb.rpc as unknown as ReturnType<typeof vi.fn>
    expect(rpc).toHaveBeenCalledWith('query_attendance', expect.objectContaining({
      p_from: '2026-04-01', p_to: '2026-04-16', p_group_by: 'employee',
    }))
  })

  it('returns only requested metrics in rows', async () => {
    const sb = makeSupabase([
      { group_key: 'Alice', office_days: 10, wfh_days: 2, remote_days: 0, leave_days: 0, sick_days: 0, no_clocking_days: 0, days_worked: 12, total_hours: 90, avg_hours_per_day: 7.5 },
    ])
    const res = await queryAttendance({
      from: '2026-04-01', to: '2026-04-16',
      groupBy: 'employee',
      metrics: ['office_days', 'total_hours'],
    }, sb)
    expect(res.rows[0]).toEqual({ groupKey: 'Alice', office_days: 10, total_hours: 90 })
    expect(res.rows[0]).not.toHaveProperty('wfh_days')
  })

  it('applies orderBy and limits client-side when orderBy is provided', async () => {
    const sb = makeSupabase([
      { group_key: 'A', office_days: 5, wfh_days: 0, remote_days: 0, leave_days: 0, sick_days: 0, no_clocking_days: 0, days_worked: 5, total_hours: 40, avg_hours_per_day: 8 },
      { group_key: 'B', office_days: 10, wfh_days: 0, remote_days: 0, leave_days: 0, sick_days: 0, no_clocking_days: 0, days_worked: 10, total_hours: 80, avg_hours_per_day: 8 },
    ])
    const res = await queryAttendance({
      from: '2026-04-01', to: '2026-04-16',
      groupBy: 'employee',
      metrics: ['office_days'],
      orderBy: { metric: 'office_days', direction: 'desc' },
      limit: 1,
    }, sb)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].groupKey).toBe('B')
  })
})
