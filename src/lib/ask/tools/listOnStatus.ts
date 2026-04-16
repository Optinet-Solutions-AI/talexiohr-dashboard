import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceStatus, GroupType } from '../types'

export type ListOnStatusArgs = {
  date?: string
  status: AttendanceStatus
  filters?: { groupType?: GroupType; unit?: string }
}

export type ListOnStatusResult = {
  date: string
  status: string
  employees: Array<{
    name: string
    unit: string | null
    hours: number | null
    timeIn: string | null
    timeOut: string | null
  }>
}

type JoinedRow = {
  hours_worked: number | null
  time_in: string | null
  time_out: string | null
  employees: {
    full_name: string
    unit: string | null
    excluded: boolean
    group_type: GroupType | null
  } | null
}

export async function listOnStatus(
  args: ListOnStatusArgs,
  supabase: SupabaseClient,
): Promise<ListOnStatusResult> {
  const date = args.date ?? new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('attendance_records')
    .select('hours_worked, time_in, time_out, employees!inner(full_name, unit, excluded, group_type)')
    .eq('date', date)
    .eq('status', args.status)
    .order('employee_id', { ascending: true })

  if (error) throw new Error(`listOnStatus failed: ${error.message}`)

  const rows = (data ?? []) as unknown as JoinedRow[]
  const filtered = rows.filter(r => {
    if (!r.employees || r.employees.excluded) return false
    if (args.filters?.groupType && r.employees.group_type !== args.filters.groupType) return false
    if (args.filters?.unit && r.employees.unit !== args.filters.unit) return false
    return true
  })

  return {
    date,
    status: args.status,
    employees: filtered.map(r => ({
      name: r.employees!.full_name,
      unit: r.employees!.unit,
      hours: r.hours_worked,
      timeIn: r.time_in,
      timeOut: r.time_out,
    })),
  }
}

export const listOnStatusDefinition = {
  type: 'function' as const,
  function: {
    name: 'list_on_status',
    description: 'List employees who had a specific attendance status on a specific date. Use for "who is on leave today", "who was sick yesterday".',
    parameters: {
      type: 'object',
      required: ['status'],
      properties: {
        date: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to today.' },
        status: { type: 'string', enum: ['vacation', 'sick', 'no_clocking', 'office', 'wfh', 'remote'] },
        filters: {
          type: 'object',
          properties: {
            groupType: { type: 'string', enum: ['office_malta', 'remote'] },
            unit: { type: 'string' },
          },
        },
      },
    },
  },
}
