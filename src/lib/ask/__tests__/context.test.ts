import { describe, it, expect } from 'vitest'
import { buildContextFromToolCalls } from '../context'
import type { ToolCallRecord } from '../types'

function tc(tool: string, rowCount: number | null, args: unknown = {}): ToolCallRecord {
  return { tool, args, rowCount, durationMs: 0, truncated: false }
}

describe('buildContextFromToolCalls', () => {
  it('returns empty context when no tool calls', () => {
    expect(buildContextFromToolCalls([])).toEqual({
      dateRange: { from: '', to: '' },
      employeeCount: 0,
      recordCount: 0,
    })
  })

  it('picks employeeCount from list_employees', () => {
    const out = buildContextFromToolCalls([tc('list_employees', 37)])
    expect(out.employeeCount).toBe(37)
  })

  it('picks employeeCount from check_compliance too', () => {
    const out = buildContextFromToolCalls([tc('check_compliance', 12)])
    expect(out.employeeCount).toBe(12)
  })

  it('takes the max employeeCount across tools', () => {
    const out = buildContextFromToolCalls([
      tc('list_employees', 37),
      tc('check_compliance', 12),
    ])
    expect(out.employeeCount).toBe(37)
  })

  it('picks recordCount from query_attendance', () => {
    const out = buildContextFromToolCalls([tc('query_attendance', 588)])
    expect(out.recordCount).toBe(588)
  })

  it('extracts date range from query_attendance args', () => {
    const out = buildContextFromToolCalls([
      tc('query_attendance', 10, { from: '2026-04-01', to: '2026-04-16' }),
    ])
    expect(out.dateRange).toEqual({ from: '2026-04-01', to: '2026-04-16' })
  })

  it('handles query_attendance with missing args gracefully', () => {
    const out = buildContextFromToolCalls([tc('query_attendance', 5, null)])
    expect(out.dateRange).toEqual({ from: '', to: '' })
  })

  it('treats null rowCount as 0', () => {
    const out = buildContextFromToolCalls([tc('list_employees', null)])
    expect(out.employeeCount).toBe(0)
  })
})
