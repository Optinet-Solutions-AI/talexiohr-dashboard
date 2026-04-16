import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceMetric, AggregateRow, GroupType } from '../types'

const ALL_METRICS: AttendanceMetric[] = [
  'office_days', 'wfh_days', 'remote_days',
  'leave_days', 'sick_days', 'no_clocking_days',
  'days_worked', 'total_hours', 'avg_hours_per_day',
]

export type QueryAttendanceArgs = {
  from: string
  to: string
  groupBy: 'employee' | 'group_type' | 'unit' | 'date'
  metrics: AttendanceMetric[]
  filters?: {
    groupType?: GroupType
    unit?: string
    employeeIds?: string[]
  }
  orderBy?: { metric: string; direction: 'asc' | 'desc' }
  limit?: number
}

export type QueryAttendanceResult = {
  rows: AggregateRow[]
  rowCount: number
}

type RawRow = { group_key: string } & Record<AttendanceMetric, number>

export async function queryAttendance(
  args: QueryAttendanceArgs,
  supabase: SupabaseClient,
): Promise<QueryAttendanceResult> {
  const limit = Math.min(args.limit ?? 50, 500)

  const { data, error } = await supabase.rpc('query_attendance', {
    p_from: args.from,
    p_to: args.to,
    p_group_by: args.groupBy,
    p_group_type: args.filters?.groupType ?? null,
    p_unit: args.filters?.unit ?? null,
    p_employee_ids: args.filters?.employeeIds ?? null,
    p_limit: args.orderBy ? 500 : limit,
  })

  if (error) throw new Error(`queryAttendance failed: ${error.message}`)

  let raw = (data ?? []) as RawRow[]

  if (args.orderBy) {
    const key = args.orderBy.metric as AttendanceMetric
    if (!ALL_METRICS.includes(key)) {
      throw new Error(`Invalid orderBy metric: ${key}`)
    }
    raw = [...raw].sort((a, b) => {
      const av = Number(a[key] ?? 0), bv = Number(b[key] ?? 0)
      return args.orderBy!.direction === 'desc' ? bv - av : av - bv
    }).slice(0, limit)
  }

  const rows: AggregateRow[] = raw.map(r => {
    const out: AggregateRow = { groupKey: r.group_key }
    for (const m of args.metrics) out[m] = Number(r[m] ?? 0)
    return out
  })

  return { rows, rowCount: rows.length }
}

export const queryAttendanceDefinition = {
  type: 'function' as const,
  function: {
    name: 'query_attendance',
    description: 'Aggregate attendance records over a date range, grouped by employee/group_type/unit/date. Use for "top N", "compare groups", "who has most/least X" questions.',
    parameters: {
      type: 'object',
      required: ['from', 'to', 'groupBy', 'metrics'],
      properties: {
        from: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        to: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        groupBy: { type: 'string', enum: ['employee', 'group_type', 'unit', 'date'] },
        metrics: {
          type: 'array',
          items: {
            type: 'string',
            enum: ALL_METRICS,
          },
          minItems: 1,
        },
        filters: {
          type: 'object',
          properties: {
            groupType: { type: 'string', enum: ['office_malta', 'remote'] },
            unit: { type: 'string' },
            employeeIds: { type: 'array', items: { type: 'string' } },
          },
        },
        orderBy: {
          type: 'object',
          properties: {
            metric: { type: 'string' },
            direction: { type: 'string', enum: ['asc', 'desc'] },
          },
          required: ['metric', 'direction'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
    },
  },
}
