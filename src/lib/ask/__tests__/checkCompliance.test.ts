import { describe, it, expect } from 'vitest'
import {
  evaluateFourDayOffice,
  evaluateWfhMondayFridayLimit,
  type AttendanceRow,
} from '../tools/checkCompliance'

const emp = { id: 'e1', name: 'Alice', unit: 'Ops' }

describe('evaluateFourDayOffice', () => {
  it('flags a full week with only 3 office days', () => {
    // Mon-Fri, 3 office + 2 wfh
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'office' }, // Mon
      { date: '2026-04-07', status: 'office' }, // Tue
      { date: '2026-04-08', status: 'office' }, // Wed
      { date: '2026-04-09', status: 'wfh' },    // Thu
      { date: '2026-04-10', status: 'wfh' },    // Fri
    ]
    const violations = evaluateFourDayOffice(emp, rows, '2026-04-06', '2026-04-10')
    expect(violations).toHaveLength(1)
    expect(violations[0].period).toBe('2026-W15')
    expect(violations[0].actualOfficeDays).toBe(3)
  })

  it('passes a week with 4 office days', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'office' },
      { date: '2026-04-07', status: 'office' },
      { date: '2026-04-08', status: 'office' },
      { date: '2026-04-09', status: 'office' },
      { date: '2026-04-10', status: 'wfh' },
    ]
    expect(evaluateFourDayOffice(emp, rows, '2026-04-06', '2026-04-10')).toEqual([])
  })

  it('ignores weeks that fall partly outside the range', () => {
    // Only 2 days in range, but the full week has 4 office days elsewhere.
    // We count only records within the range window; partial weeks are flagged
    // only if the in-range office days fall short AND the partial week has ≥ 4 weekdays in range.
    const rows: AttendanceRow[] = [
      { date: '2026-04-09', status: 'office' },
      { date: '2026-04-10', status: 'office' },
    ]
    const violations = evaluateFourDayOffice(emp, rows, '2026-04-09', '2026-04-10')
    expect(violations).toEqual([]) // partial week, under 4 weekdays in range → skip
  })
})

describe('evaluateWfhMondayFridayLimit', () => {
  it('flags 2 WFH Mondays in the same month', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'wfh' },  // Mon
      { date: '2026-04-13', status: 'wfh' },  // Mon
    ]
    const violations = evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-04-30')
    expect(violations).toHaveLength(1)
    expect(violations[0].period).toBe('2026-04')
    expect(violations[0].wfhMondayCount).toBe(2)
  })

  it('flags 2 WFH Fridays in the same month', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-03', status: 'wfh' },   // Fri
      { date: '2026-04-10', status: 'wfh' },   // Fri
    ]
    const violations = evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-04-30')
    expect(violations).toHaveLength(1)
    expect(violations[0].wfhFridayCount).toBe(2)
  })

  it('passes 1 Mon + 1 Fri', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'wfh' },
      { date: '2026-04-10', status: 'wfh' },
    ]
    expect(evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-04-30')).toEqual([])
  })

  it('segments violations by month', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'wfh' }, { date: '2026-04-13', status: 'wfh' }, // April: 2 Mons
      { date: '2026-05-04', status: 'wfh' }, { date: '2026-05-11', status: 'wfh' }, // May: 2 Mons
    ]
    const v = evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-05-31')
    expect(v).toHaveLength(2)
    expect(v.map(x => x.period).sort()).toEqual(['2026-04', '2026-05'])
  })
})
