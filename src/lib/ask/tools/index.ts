import type { SupabaseClient } from '@supabase/supabase-js'

import { listEmployees, listEmployeesDefinition } from './listEmployees'
import { queryAttendance, queryAttendanceDefinition } from './queryAttendance'
import { listOnStatus, listOnStatusDefinition } from './listOnStatus'
import { checkCompliance, checkComplianceDefinition } from './checkCompliance'
import { runReadonlySql, runReadonlySqlDefinition } from './runReadonlySql'

export const TOOL_DEFINITIONS = [
  listEmployeesDefinition,
  queryAttendanceDefinition,
  listOnStatusDefinition,
  checkComplianceDefinition,
  runReadonlySqlDefinition,
]

export function getAvailableToolDefinitions() {
  const hasReadonly = !!process.env.DATABASE_URL_READONLY
  return hasReadonly
    ? TOOL_DEFINITIONS
    : TOOL_DEFINITIONS.filter(d => d.function.name !== 'run_readonly_sql')
}

export async function executeTool(
  name: string,
  argsJson: string,
  supabase: SupabaseClient,
): Promise<{ result: unknown; rowCount: number | null }> {
  let args: Record<string, unknown>
  try { args = JSON.parse(argsJson) } catch {
    throw new Error(`Tool "${name}" received invalid JSON arguments`)
  }

  switch (name) {
    case 'list_employees': {
      const r = await listEmployees(args as Parameters<typeof listEmployees>[0], supabase)
      return { result: r, rowCount: r.employees.length }
    }
    case 'query_attendance': {
      const r = await queryAttendance(args as Parameters<typeof queryAttendance>[0], supabase)
      return { result: r, rowCount: r.rowCount }
    }
    case 'list_on_status': {
      const r = await listOnStatus(args as Parameters<typeof listOnStatus>[0], supabase)
      return { result: r, rowCount: r.employees.length }
    }
    case 'check_compliance': {
      const r = await checkCompliance(args as Parameters<typeof checkCompliance>[0], supabase)
      return { result: r, rowCount: r.violations.length }
    }
    case 'run_readonly_sql': {
      const r = await runReadonlySql(args as Parameters<typeof runReadonlySql>[0])
      return { result: r, rowCount: r.rowCount }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
