import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComplianceViolation } from '../types'

export type AttendanceRow = { date: string; status: string }

export type CheckComplianceArgs = {
  from: string
  to: string
  rule: 'four_day_office' | 'wfh_monday_friday_limit' | 'all'
  employeeIds?: string[]
}

export type CheckComplianceResult = {
  rule: string
  violations: ComplianceViolation[]
  summary: { totalChecked: number; totalViolators: number }
}

type EmployeeInfo = { id: string; name: string; unit: string | null }

export function isoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function parseUtcDate(s: string): Date {
  return new Date(s + 'T00:00:00Z')
}

function weekdaysInRange(from: string, to: string): Map<string, number> {
  const out = new Map<string, number>()
  const d = parseUtcDate(from)
  const end = parseUtcDate(to)
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay()
    if (dow >= 1 && dow <= 5) {
      const k = isoWeekKey(d)
      out.set(k, (out.get(k) ?? 0) + 1)
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export function evaluateFourDayOffice(
  employee: EmployeeInfo,
  rows: AttendanceRow[],
  from: string,
  to: string,
): ComplianceViolation[] {
  const officeByWeek = new Map<string, number>()
  for (const r of rows) {
    if (r.status !== 'office') continue
    const d = parseUtcDate(r.date)
    if (d < parseUtcDate(from) || d > parseUtcDate(to)) continue
    const k = isoWeekKey(d)
    officeByWeek.set(k, (officeByWeek.get(k) ?? 0) + 1)
  }
  const weekdayCounts = weekdaysInRange(from, to)
  const violations: ComplianceViolation[] = []
  for (const [week, weekdayCount] of weekdayCounts) {
    if (weekdayCount < 4) continue // partial week in range
    const actual = officeByWeek.get(week) ?? 0
    if (actual < 4) {
      violations.push({
        employee, period: week, actualOfficeDays: actual,
        details: `Only ${actual} office day(s) in ${week} (required: 4).`,
      })
    }
  }
  return violations
}

export function evaluateWfhMondayFridayLimit(
  employee: EmployeeInfo,
  rows: AttendanceRow[],
  from: string,
  to: string,
): ComplianceViolation[] {
  const monByMonth = new Map<string, number>()
  const friByMonth = new Map<string, number>()
  for (const r of rows) {
    if (r.status !== 'wfh') continue
    const d = parseUtcDate(r.date)
    if (d < parseUtcDate(from) || d > parseUtcDate(to)) continue
    const dow = d.getUTCDay()
    const m = monthKey(d)
    if (dow === 1) monByMonth.set(m, (monByMonth.get(m) ?? 0) + 1)
    else if (dow === 5) friByMonth.set(m, (friByMonth.get(m) ?? 0) + 1)
  }
  const months = new Set<string>([...monByMonth.keys(), ...friByMonth.keys()])
  const violations: ComplianceViolation[] = []
  for (const m of months) {
    const mon = monByMonth.get(m) ?? 0
    const fri = friByMonth.get(m) ?? 0
    if (mon > 1 || fri > 1) {
      const parts: string[] = []
      if (mon > 1) parts.push(`${mon} WFH Mondays`)
      if (fri > 1) parts.push(`${fri} WFH Fridays`)
      violations.push({
        employee, period: m,
        wfhMondayCount: mon, wfhFridayCount: fri,
        details: `${parts.join(' and ')} in ${m} (limit: 1 each).`,
      })
    }
  }
  return violations
}

export async function checkCompliance(
  args: CheckComplianceArgs,
  supabase: SupabaseClient,
): Promise<CheckComplianceResult> {
  // Fetch candidate employees
  let eq = supabase
    .from('employees')
    .select('id, full_name, unit')
    .eq('excluded', false)
    .eq('group_type', 'office_malta')
  if (args.employeeIds?.length) eq = eq.in('id', args.employeeIds)
  const { data: emps, error: e1 } = await eq
  if (e1) throw new Error(`checkCompliance: ${e1.message}`)
  const employees = (emps ?? []) as Array<{ id: string; full_name: string; unit: string | null }>

  if (employees.length === 0) {
    return { rule: args.rule, violations: [], summary: { totalChecked: 0, totalViolators: 0 } }
  }

  const { data: recs, error: e2 } = await supabase
    .from('attendance_records')
    .select('employee_id, date, status')
    .in('employee_id', employees.map(e => e.id))
    .gte('date', args.from)
    .lte('date', args.to)
  if (e2) throw new Error(`checkCompliance: ${e2.message}`)

  const byEmp = new Map<string, AttendanceRow[]>()
  for (const r of (recs ?? []) as Array<{ employee_id: string; date: string; status: string }>) {
    const arr = byEmp.get(r.employee_id) ?? []
    arr.push({ date: r.date, status: r.status })
    byEmp.set(r.employee_id, arr)
  }

  const allViolations: ComplianceViolation[] = []
  const violators = new Set<string>()
  for (const emp of employees) {
    const info: EmployeeInfo = { id: emp.id, name: emp.full_name, unit: emp.unit }
    const rows = byEmp.get(emp.id) ?? []
    const vs: ComplianceViolation[] = []
    if (args.rule === 'four_day_office' || args.rule === 'all') {
      vs.push(...evaluateFourDayOffice(info, rows, args.from, args.to))
    }
    if (args.rule === 'wfh_monday_friday_limit' || args.rule === 'all') {
      vs.push(...evaluateWfhMondayFridayLimit(info, rows, args.from, args.to))
    }
    if (vs.length) violators.add(emp.id)
    allViolations.push(...vs)
  }

  return {
    rule: args.rule,
    violations: allViolations,
    summary: { totalChecked: employees.length, totalViolators: violators.size },
  }
}

export const checkComplianceDefinition = {
  type: 'function' as const,
  function: {
    name: 'check_compliance',
    description: 'Identify Malta office employees who violated attendance rules. Rules: four_day_office (≥4 office days per ISO week), wfh_monday_friday_limit (≤1 WFH Monday and ≤1 WFH Friday per calendar month).',
    parameters: {
      type: 'object',
      required: ['from', 'to', 'rule'],
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        rule: { type: 'string', enum: ['four_day_office', 'wfh_monday_friday_limit', 'all'] },
        employeeIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}
