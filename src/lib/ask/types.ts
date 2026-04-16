// Shared types for the Ask AI agent. No runtime code.

export type GroupType = 'office_malta' | 'remote' | 'unclassified'

export type AttendanceStatus =
  | 'office' | 'wfh' | 'remote'
  | 'vacation' | 'sick' | 'no_clocking'
  | 'active' | 'broken' | 'unknown'

export type AttendanceMetric =
  | 'office_days' | 'wfh_days' | 'remote_days'
  | 'leave_days' | 'sick_days' | 'no_clocking_days'
  | 'days_worked' | 'total_hours' | 'avg_hours_per_day'

export type EmployeeSummary = {
  id: string
  name: string
  talexioId: string | null
  unit: string | null
  position: string | null
  groupType: GroupType | null
  jobSchedule: string | null
}

export type AggregateRow = {
  groupKey: string
  [metric: string]: number | string
}

export type ComplianceViolation = {
  employee: { id: string; name: string; unit: string | null }
  period: string
  actualOfficeDays?: number
  wfhMondayCount?: number
  wfhFridayCount?: number
  details: string
}

export type ToolCallRecord = {
  tool: string
  args: unknown
  rowCount: number | null
  durationMs: number
  truncated: boolean
  error?: string
}

export type AskResult = {
  answer: string
  toolCalls: ToolCallRecord[]
  totalTokens: number
  totalDurationMs: number
}
