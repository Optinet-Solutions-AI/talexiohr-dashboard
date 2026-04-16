import { Parser } from 'node-sql-parser'

const ALLOWED_TABLES = new Set(['employees', 'attendance_records'])

const BLOCKED_FUNCTIONS = new Set([
  'pg_sleep', 'pg_read_file', 'pg_ls_dir', 'pg_read_server_files',
  'pg_terminate_backend', 'lo_import', 'lo_export', 'copy',
])

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateReadonlySql(sql: string): ValidationResult {
  const trimmed = sql.trim()
  if (!trimmed) return { ok: false, reason: 'Query is empty' }

  if (hasMultipleStatements(trimmed)) {
    return { ok: false, reason: 'Only one statement is allowed (no semicolons separating queries)' }
  }

  const parser = new Parser()
  let ast
  try {
    const parsed = parser.astify(trimmed, { database: 'Postgresql' })
    ast = Array.isArray(parsed) ? parsed[0] : parsed
  } catch (err) {
    return { ok: false, reason: `Parse error: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (!ast || ast.type !== 'select') {
    return { ok: false, reason: 'Only SELECT statements are allowed' }
  }

  const tables = parser.tableList(trimmed, { database: 'Postgresql' })
  for (const entry of tables) {
    const [access, , name] = entry.split('::')
    if (access !== 'select') {
      return { ok: false, reason: `Only SELECT access is allowed; got ${access} on ${name}` }
    }
    if (!ALLOWED_TABLES.has(name)) {
      return { ok: false, reason: `Table "${name}" is not in the allowed list` }
    }
  }

  const funcs = collectFunctionNames(ast).map(f => f.toLowerCase())
  for (const fn of funcs) {
    if (BLOCKED_FUNCTIONS.has(fn)) {
      return { ok: false, reason: `Function "${fn}" is not allowed` }
    }
  }

  return { ok: true }
}

function hasMultipleStatements(sql: string): boolean {
  const stripped = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""')
  const withoutTrailing = stripped.replace(/;\s*$/, '')
  return withoutTrailing.includes(';')
}

function collectFunctionNames(node: unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc
  const n = node as Record<string, unknown>
  if (n.type === 'function' && typeof n.name === 'string') acc.push(n.name)
  if (n.type === 'function' && n.name && typeof n.name === 'object') {
    const name = (n.name as Record<string, unknown>).name
    if (Array.isArray(name) && typeof name[0] === 'object' && name[0] !== null) {
      const v = (name[0] as Record<string, unknown>).value
      if (typeof v === 'string') acc.push(v)
    }
  }
  for (const key of Object.keys(n)) {
    const v = n[key]
    if (Array.isArray(v)) v.forEach(item => collectFunctionNames(item, acc))
    else if (v && typeof v === 'object') collectFunctionNames(v, acc)
  }
  return acc
}
