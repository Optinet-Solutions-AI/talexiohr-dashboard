import type { ToolCallRecord } from './types'

export type AskContext = {
  dateRange: { from: string; to: string }
  employeeCount: number
  recordCount: number
}

export function buildContextFromToolCalls(toolCalls: ToolCallRecord[]): AskContext {
  let employeeCount = 0
  let recordCount = 0
  let dateRange: { from: string; to: string } = { from: '', to: '' }

  for (const tc of toolCalls) {
    if (tc.tool === 'list_employees' || tc.tool === 'check_compliance') {
      employeeCount = Math.max(employeeCount, tc.rowCount ?? 0)
    }
    if (tc.tool === 'query_attendance') {
      recordCount = Math.max(recordCount, tc.rowCount ?? 0)
      const args = tc.args as { from?: string; to?: string } | null
      if (args?.from && args?.to) dateRange = { from: args.from, to: args.to }
    }
  }

  return { dateRange, employeeCount, recordCount }
}
