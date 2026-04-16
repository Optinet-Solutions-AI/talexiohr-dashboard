import { validateReadonlySql } from '../sqlGuard'
import { executeReadonly } from '../readonlyDb'

export type RunReadonlySqlArgs = {
  query: string
  reason: string
}

export type RunReadonlySqlResult = {
  rows: unknown[]
  rowCount: number
  truncated: boolean
  error?: string
}

export async function runReadonlySql(args: RunReadonlySqlArgs): Promise<RunReadonlySqlResult> {
  const v = validateReadonlySql(args.query)
  if (!v.ok) {
    return { rows: [], rowCount: 0, truncated: false, error: v.reason }
  }
  try {
    const res = await executeReadonly(args.query)
    return res
  } catch (err) {
    return {
      rows: [], rowCount: 0, truncated: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export const runReadonlySqlDefinition = {
  type: 'function' as const,
  function: {
    name: 'run_readonly_sql',
    description: 'Fallback for questions that no typed tool can answer. Runs a read-only SELECT against the `employees` and `attendance_records` tables. Prefer typed tools when possible. ALWAYS populate the "reason" argument.',
    parameters: {
      type: 'object',
      required: ['query', 'reason'],
      properties: {
        query: { type: 'string', description: 'A single SELECT statement. Only `employees` and `attendance_records` may be referenced. Results are capped at 500 rows and must complete in 3s.' },
        reason: { type: 'string', description: 'Why no typed tool fits this question. Logged for audit.' },
      },
    },
  },
}
