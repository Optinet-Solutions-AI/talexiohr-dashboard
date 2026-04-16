import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmployeeSummary, GroupType } from '../types'

export type ListEmployeesArgs = {
  filters?: {
    groupType?: GroupType
    unit?: string
    position?: string
    search?: string
    includeExcluded?: boolean
  }
  limit?: number
}

export type ListEmployeesResult = {
  employees: EmployeeSummary[]
  total: number
}

export async function listEmployees(
  args: ListEmployeesArgs,
  supabase: SupabaseClient,
): Promise<ListEmployeesResult> {
  const limit = Math.min(args.limit ?? 100, 1000)
  let q = supabase
    .from('employees')
    .select('id, full_name, talexio_id, unit, position, group_type, job_schedule')

  if (!args.filters?.includeExcluded) q = q.eq('excluded', false)
  if (args.filters?.groupType) q = q.eq('group_type', args.filters.groupType)
  if (args.filters?.unit)      q = q.eq('unit', args.filters.unit)
  if (args.filters?.position)  q = q.eq('position', args.filters.position)
  if (args.filters?.search)    q = q.ilike('full_name', `%${args.filters.search}%`)

  q = q.order('last_name', { ascending: true }).limit(limit)

  const { data, error } = await q
  if (error) throw new Error(`listEmployees failed: ${error.message}`)
  const rows = (data ?? []) as Array<{
    id: string
    full_name: string
    talexio_id: string | null
    unit: string | null
    position: string | null
    group_type: GroupType | null
    job_schedule: string | null
  }>

  return {
    employees: rows.map(r => ({
      id: r.id,
      name: r.full_name,
      talexioId: r.talexio_id,
      unit: r.unit,
      position: r.position,
      groupType: r.group_type,
      jobSchedule: r.job_schedule,
    })),
    total: rows.length,
  }
}

export const listEmployeesDefinition = {
  type: 'function' as const,
  function: {
    name: 'list_employees',
    description: 'List employees with optional filters by group, unit, position, or name search. Returns basic directory info.',
    parameters: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          properties: {
            groupType: { type: 'string', enum: ['office_malta', 'remote', 'unclassified'] },
            unit: { type: 'string' },
            position: { type: 'string' },
            search: { type: 'string', description: 'Case-insensitive substring match on full name' },
            includeExcluded: { type: 'boolean', description: 'Defaults to false' },
          },
        },
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      },
    },
  },
}
