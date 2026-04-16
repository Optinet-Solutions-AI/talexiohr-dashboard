# Ask AI Tool-Calling Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bulk-fetch + JSON-stuffing pattern in `/api/ask` with an OpenAI tool-calling agent backed by five curated Postgres-aggregating tools and a guarded SQL escape hatch, with per-request logging and rate limiting, designed for a 1000+ employee production dataset.

**Architecture:** Five TypeScript tool functions exposed as OpenAI tools; agent loop iterates until a final answer (capped at 5 iterations / 8000 tokens). The SQL escape hatch goes through a three-layer defense: Node-side parser validation, a dedicated read-only Postgres role, and a SECURITY INVOKER wrapper function with `statement_timeout` and an injected `LIMIT 500`. Every request writes one row to `ask_ai_logs` for audit, cost tracking, and rate limiting.

**Tech Stack:** Next.js 16.2.3, React 19, TypeScript, Supabase (Postgres), OpenAI SDK, `node-sql-parser`, `pg` (for read-only role), `vitest` (new, for unit tests).

**Reference spec:** [docs/superpowers/specs/2026-04-16-ask-ai-tool-calling-design.md](../specs/2026-04-16-ask-ai-tool-calling-design.md)

---

## Schema Reference

Pulled here once so later tasks can reference it without re-reading migrations.

**`employees`** — `id uuid PK`, `talexio_id text UNIQUE`, `first_name text`, `last_name text`, `full_name text` (generated), `group_type text` (`office_malta` | `remote` | `unclassified`), `unit text`, `job_schedule text`, `position text`, `excluded boolean`, timestamps.

**`attendance_records`** — `id uuid PK`, `employee_id uuid FK`, `date date`, `location_in text`, `time_in time`, `location_out text`, `time_out time`, `hours_worked double precision`, `status text` (values in use: `office`, `wfh`, `remote`, `no_clocking`, `vacation`, `sick`, `active`, `broken`, `unknown`), `comments text`, `raw_data jsonb`, timestamps. Unique on `(employee_id, date)`.

**`auth.users`** — standard Supabase auth table. Used for `ask_ai_logs.user_id` FK.

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (dependencies and devDependencies)

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
npm install node-sql-parser pg
npm install --save-dev @types/pg
```

Expected: `package.json` gains `node-sql-parser`, `pg`, and `@types/pg`. `package-lock.json` updates.

- [ ] **Step 2: Install test dependencies**

Run:
```bash
npm install --save-dev vitest @vitest/ui
```

Expected: `vitest` and `@vitest/ui` appear under `devDependencies`.

- [ ] **Step 3: Add test script**

Edit `package.json` — add to the `scripts` object:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest, node-sql-parser, pg for Ask AI agent"
```

---

## Task 2: Set up vitest configuration

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/ask/__tests__/smoke.test.ts`

- [ ] **Step 1: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
```

- [ ] **Step 2: Write a smoke test**

Create `src/lib/ask/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Run the smoke test**

Run: `npm test`

Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts src/lib/ask/__tests__/smoke.test.ts
git commit -m "chore: add vitest config and smoke test"
```

---

## Task 3: Migration — `ask_ai_logs` table

**Files:**
- Create: `supabase/migrations/20260416_ask_ai_logs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260416_ask_ai_logs.sql`:

```sql
-- Log table for Ask AI agent requests.
-- One row per inbound /api/ask request, written in a finally block.

CREATE TABLE IF NOT EXISTS ask_ai_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  user_id           uuid REFERENCES auth.users(id),
  question          text NOT NULL,
  relevance_passed  boolean,
  rate_limited      boolean NOT NULL DEFAULT false,
  tool_calls        jsonb,
  final_answer      text,
  total_tokens      int,
  total_duration_ms int,
  error             text
);

CREATE INDEX IF NOT EXISTS ask_ai_logs_user_created
  ON ask_ai_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ask_ai_logs_created
  ON ask_ai_logs (created_at DESC);

ALTER TABLE ask_ai_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_ask_ai_logs"
  ON ask_ai_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_own_ask_ai_logs"
  ON ask_ai_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

- [ ] **Step 2: Apply migration to local Supabase**

Run (from project root, assumes `supabase` CLI is installed and `supabase start` has been run at least once):

```bash
supabase db push
```

If `supabase` CLI is not installed, paste the SQL into the Supabase dashboard SQL editor for the linked project.

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY` statements succeed.

- [ ] **Step 3: Verify table exists**

Run:
```bash
supabase db remote commit --help >/dev/null 2>&1 && supabase db query "SELECT count(*) FROM ask_ai_logs"
```

Or in the Supabase SQL editor: `SELECT count(*) FROM ask_ai_logs;` — should return `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260416_ask_ai_logs.sql
git commit -m "feat(db): add ask_ai_logs table for agent audit trail"
```

---

## Task 4: Migration — `ask_ai_readonly` role

**Files:**
- Create: `supabase/migrations/20260416_ask_ai_readonly_role.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260416_ask_ai_readonly_role.sql`:

```sql
-- Dedicated Postgres role for the Ask AI SQL escape hatch.
-- Grants SELECT on only the two tables the agent is allowed to query.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_ai_readonly') THEN
    CREATE ROLE ask_ai_readonly LOGIN PASSWORD 'CHANGE_ME_IN_SUPABASE_DASHBOARD';
  END IF;
END$$;

-- Strip everything, then grant only what is needed.
REVOKE ALL ON SCHEMA public FROM ask_ai_readonly;
GRANT USAGE ON SCHEMA public TO ask_ai_readonly;

GRANT SELECT ON employees          TO ask_ai_readonly;
GRANT SELECT ON attendance_records TO ask_ai_readonly;

-- Bypass RLS so the role can read without needing policies.
-- (Policies still apply to service_role and authenticated, not to this role.)
ALTER TABLE employees          FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;

CREATE POLICY "ask_ai_readonly_employees"
  ON employees FOR SELECT TO ask_ai_readonly
  USING (true);

CREATE POLICY "ask_ai_readonly_attendance_records"
  ON attendance_records FOR SELECT TO ask_ai_readonly
  USING (true);
```

- [ ] **Step 2: Change the role password**

After applying the migration, in the Supabase dashboard SQL editor, run:

```sql
ALTER ROLE ask_ai_readonly WITH PASSWORD '<strong-random-password>';
```

Save this password — it will go into `DATABASE_URL_READONLY` in Task 21.

- [ ] **Step 3: Apply migration**

Run: `supabase db push` (or paste in dashboard).

Expected: migration applies without error.

- [ ] **Step 4: Verify grants**

In the SQL editor:

```sql
SELECT grantee, privilege_type, table_name
FROM information_schema.role_table_grants
WHERE grantee = 'ask_ai_readonly'
ORDER BY table_name;
```

Expected: two rows — `SELECT` on `employees` and `SELECT` on `attendance_records`. No other rows.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260416_ask_ai_readonly_role.sql
git commit -m "feat(db): add ask_ai_readonly role for SQL escape hatch"
```

---

## Task 5: Migration — `ask_ai_execute` function

**Files:**
- Create: `supabase/migrations/20260416_ask_ai_execute_fn.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260416_ask_ai_execute_fn.sql`:

```sql
-- SECURITY INVOKER wrapper that runs LLM-generated SELECTs under
-- read-only + statement_timeout guards with an injected LIMIT 500.

CREATE OR REPLACE FUNCTION ask_ai_execute(q text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result jsonb;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL default_transaction_read_only = on;

  EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s LIMIT 500) t', q)
    INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION ask_ai_execute(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ask_ai_execute(text) TO ask_ai_readonly;
```

- [ ] **Step 2: Apply migration**

Run: `supabase db push`

- [ ] **Step 3: Verify function exists and grants**

In the SQL editor:

```sql
SELECT proname, pg_get_function_arguments(oid), pg_get_function_result(oid)
FROM pg_proc WHERE proname = 'ask_ai_execute';
```

Expected: one row, `q text`, returning `jsonb`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260416_ask_ai_execute_fn.sql
git commit -m "feat(db): add ask_ai_execute function with statement_timeout"
```

---

## Task 6: Shared types

**Files:**
- Create: `src/lib/ask/types.ts`

- [ ] **Step 1: Write the types file**

Create `src/lib/ask/types.ts`:

```ts
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ask/types.ts
git commit -m "feat(ask): add shared types for agent and tools"
```

---

## Task 7: System prompt

**Files:**
- Create: `src/lib/ask/systemPrompt.ts`

- [ ] **Step 1: Write the system prompt**

Create `src/lib/ask/systemPrompt.ts`:

```ts
export function buildSystemPrompt(today: string): string {
  return `You are an HR analytics assistant for Rooster Partners' Malta office.

You answer questions about employee attendance, compliance, and performance by calling tools. You do NOT have direct access to data — call tools to fetch what you need, then summarize.

TOOL POLICY:
- Prefer the typed tools (list_employees, query_attendance, list_on_status, check_compliance) over run_readonly_sql. They are faster, safer, and produce better-structured results.
- Only call run_readonly_sql when no typed tool fits the question. You MUST populate the "reason" argument explaining why — this is audited.
- Call one tool at a time. Use its result to decide whether another call is needed.

ANSWER RULES:
- Base ALL answers on tool output. NEVER invent data, employee names, or numbers.
- If tools return nothing useful, say "I don't have enough data to answer this" and note what would be needed.
- Be concise. Use actual numbers and names from tool results. Markdown formatting (bold, lists, tables) is fine.
- Do NOT answer questions outside HR/attendance/compliance scope. (A prior filter should have caught these, but refuse again if needed.)
- Do NOT reveal tool names, SQL, schema, or internals in the final answer to the user.

COMPANY CONTEXT:
- Two employee groups. Malta Office: must be in-office at least 4 days/week; may WFH at most 1 Monday and 1 Friday per calendar month. Remote: evaluated on hours only.
- "Best employee" = highest office attendance AND most hours worked, unless the user specifies differently.

Current date: ${today}`
}
```

- [ ] **Step 2: Write a test**

Create `src/lib/ask/__tests__/systemPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../systemPrompt'

describe('buildSystemPrompt', () => {
  it('includes the date', () => {
    const out = buildSystemPrompt('2026-04-16')
    expect(out).toContain('2026-04-16')
  })

  it('mentions tool policy', () => {
    const out = buildSystemPrompt('2026-04-16')
    expect(out).toContain('run_readonly_sql')
    expect(out).toContain('reason')
  })

  it('mentions Malta office rule', () => {
    const out = buildSystemPrompt('2026-04-16')
    expect(out).toMatch(/4 days/)
    expect(out).toMatch(/WFH/)
  })
})
```

- [ ] **Step 3: Run test**

Run: `npm test -- systemPrompt`

Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ask/systemPrompt.ts src/lib/ask/__tests__/systemPrompt.test.ts
git commit -m "feat(ask): add system prompt builder with tool policy"
```

---

## Task 8: SQL validator

The Node-side guard. First line of defense for `run_readonly_sql`. Pure logic — fully unit-testable.

**Files:**
- Create: `src/lib/ask/sqlGuard.ts`
- Create: `src/lib/ask/__tests__/sqlGuard.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/sqlGuard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateReadonlySql } from '../sqlGuard'

describe('validateReadonlySql', () => {
  it('allows a plain SELECT on employees', () => {
    const r = validateReadonlySql('SELECT id, full_name FROM employees WHERE excluded = false')
    expect(r.ok).toBe(true)
  })

  it('allows a SELECT with join on the two whitelisted tables', () => {
    const r = validateReadonlySql(
      'SELECT e.full_name, count(*) FROM employees e JOIN attendance_records a ON a.employee_id = e.id GROUP BY e.full_name'
    )
    expect(r.ok).toBe(true)
  })

  it('rejects INSERT', () => {
    const r = validateReadonlySql("INSERT INTO employees (first_name) VALUES ('x')")
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/SELECT/i)
  })

  it('rejects UPDATE', () => {
    const r = validateReadonlySql("UPDATE employees SET excluded = true")
    expect(r.ok).toBe(false)
  })

  it('rejects DELETE', () => {
    const r = validateReadonlySql("DELETE FROM employees")
    expect(r.ok).toBe(false)
  })

  it('rejects DROP', () => {
    const r = validateReadonlySql("DROP TABLE employees")
    expect(r.ok).toBe(false)
  })

  it('rejects multiple statements', () => {
    const r = validateReadonlySql('SELECT 1; DROP TABLE employees')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/one statement|single/i)
  })

  it('rejects tables outside the whitelist', () => {
    const r = validateReadonlySql('SELECT * FROM ask_ai_logs')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/allowed|whitelist|table/i)
  })

  it('rejects pg_sleep', () => {
    const r = validateReadonlySql("SELECT pg_sleep(60)")
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/function/i)
  })

  it('rejects pg_read_file', () => {
    const r = validateReadonlySql("SELECT pg_read_file('/etc/passwd')")
    expect(r.ok).toBe(false)
  })

  it('rejects a CTE that writes', () => {
    const r = validateReadonlySql(
      "WITH x AS (INSERT INTO employees (first_name) VALUES ('x') RETURNING id) SELECT * FROM x"
    )
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sqlGuard`

Expected: all fail with `validateReadonlySql is not a function` or module resolution error.

- [ ] **Step 3: Implement `validateReadonlySql`**

Create `src/lib/ask/sqlGuard.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npm test -- sqlGuard`

Expected: 11 passed. If `collectFunctionNames` shape doesn't match what `node-sql-parser` produces for the specific functions, fix the traversal until all tests pass. Do not change the test expectations.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/sqlGuard.ts src/lib/ask/__tests__/sqlGuard.test.ts
git commit -m "feat(ask): add SQL guard with SELECT-only + whitelist validation"
```

---

## Task 9: Read-only Postgres client

**Files:**
- Create: `src/lib/ask/readonlyDb.ts`

- [ ] **Step 1: Write the client**

Create `src/lib/ask/readonlyDb.ts`:

```ts
import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const url = process.env.DATABASE_URL_READONLY
  if (!url) throw new Error('DATABASE_URL_READONLY is not set')
  pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

export type ReadonlyResult = {
  rows: unknown[]
  rowCount: number
  truncated: boolean
}

export async function executeReadonly(query: string): Promise<ReadonlyResult> {
  const client = await getPool().connect()
  try {
    const res = await client.query('SELECT ask_ai_execute($1) AS data', [query])
    const rows = (res.rows[0]?.data ?? []) as unknown[]
    return {
      rows,
      rowCount: rows.length,
      truncated: rows.length >= 500,
    }
  } finally {
    client.release()
  }
}
```

- [ ] **Step 2: No unit tests for this module**

Reason: it is a thin wrapper over `pg` + the `ask_ai_execute` function. Behavior is verified end-to-end in Task 22.

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ask/readonlyDb.ts
git commit -m "feat(ask): add read-only pg pool targeting ask_ai_execute"
```

---

## Task 10: Tool — `list_employees`

**Files:**
- Create: `src/lib/ask/tools/listEmployees.ts`
- Create: `src/lib/ask/__tests__/listEmployees.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/listEmployees.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listEmployees } from '../tools/listEmployees'

type FakeResponse = { data: unknown; error: null }

function makeSupabaseMock(rows: unknown[], count: number) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: FakeResponse) => void) => resolve({ data: rows, error: null }),
  }
  const from = vi.fn().mockReturnValue(chain)
  return {
    supabase: { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
    chain,
    count,
  }
}

describe('listEmployees', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns employees with default filters (excluded=false)', async () => {
    const { supabase, chain } = makeSupabaseMock(
      [{ id: '1', full_name: 'Alice', talexio_id: 'A1', unit: 'Ops', position: 'Dev', group_type: 'office_malta', job_schedule: null }],
      1,
    )
    const res = await listEmployees({}, supabase)
    expect(res.employees).toHaveLength(1)
    expect(res.employees[0].name).toBe('Alice')
    expect(chain.eq).toHaveBeenCalledWith('excluded', false)
  })

  it('applies groupType filter', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ filters: { groupType: 'remote' } }, supabase)
    expect(chain.eq).toHaveBeenCalledWith('group_type', 'remote')
  })

  it('applies search via ilike on full_name', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ filters: { search: 'youss' } }, supabase)
    expect(chain.ilike).toHaveBeenCalledWith('full_name', '%youss%')
  })

  it('caps limit at 1000', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ limit: 99999 }, supabase)
    expect(chain.limit).toHaveBeenCalledWith(1000)
  })

  it('includeExcluded=true drops the excluded filter', async () => {
    const { supabase, chain } = makeSupabaseMock([], 0)
    await listEmployees({ filters: { includeExcluded: true } }, supabase)
    expect(chain.eq).not.toHaveBeenCalledWith('excluded', false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- listEmployees`

Expected: fail with module not found.

- [ ] **Step 3: Implement the tool**

Create `src/lib/ask/tools/listEmployees.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npm test -- listEmployees`

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/tools/listEmployees.ts src/lib/ask/__tests__/listEmployees.test.ts
git commit -m "feat(ask): add list_employees tool"
```

---

## Task 11: Tool — `query_attendance`

The workhorse. Uses raw SQL via `supabase.rpc` to an inline helper, or builds metric expressions client-side and lets Postgres aggregate. Implementation here uses the Supabase client's query builder with metric expressions pre-built; for `groupBy !== 'employee'`, it uses a Postgres RPC function added in this task.

**Files:**
- Create: `supabase/migrations/20260416_query_attendance_fn.sql`
- Create: `src/lib/ask/tools/queryAttendance.ts`
- Create: `src/lib/ask/__tests__/queryAttendance.test.ts`

- [ ] **Step 1: Write the SQL aggregator migration**

Create `supabase/migrations/20260416_query_attendance_fn.sql`:

```sql
-- Parameterized aggregator for the query_attendance tool.
-- Keeps aggregation server-side so we never ship raw rows to the LLM.

CREATE OR REPLACE FUNCTION query_attendance(
  p_from         date,
  p_to           date,
  p_group_by     text,                       -- 'employee' | 'group_type' | 'unit' | 'date'
  p_group_type   text DEFAULT NULL,
  p_unit         text DEFAULT NULL,
  p_employee_ids uuid[] DEFAULT NULL,
  p_limit        int DEFAULT 50
)
RETURNS TABLE (
  group_key           text,
  office_days         int,
  wfh_days            int,
  remote_days         int,
  leave_days          int,
  sick_days           int,
  no_clocking_days    int,
  days_worked         int,
  total_hours         numeric,
  avg_hours_per_day   numeric
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_group_by NOT IN ('employee','group_type','unit','date') THEN
    RAISE EXCEPTION 'invalid group_by: %', p_group_by;
  END IF;

  RETURN QUERY EXECUTE format($q$
    SELECT
      %s AS group_key,
      count(*) FILTER (WHERE a.status = 'office')::int       AS office_days,
      count(*) FILTER (WHERE a.status = 'wfh')::int          AS wfh_days,
      count(*) FILTER (WHERE a.status = 'remote')::int       AS remote_days,
      count(*) FILTER (WHERE a.status = 'vacation')::int     AS leave_days,
      count(*) FILTER (WHERE a.status = 'sick')::int         AS sick_days,
      count(*) FILTER (WHERE a.status = 'no_clocking')::int  AS no_clocking_days,
      count(*) FILTER (WHERE a.status IN ('office','wfh','remote'))::int AS days_worked,
      COALESCE(sum(a.hours_worked), 0)::numeric                                     AS total_hours,
      CASE WHEN count(*) FILTER (WHERE a.hours_worked IS NOT NULL) > 0
           THEN ROUND((sum(a.hours_worked) / count(*) FILTER (WHERE a.hours_worked IS NOT NULL))::numeric, 2)
           ELSE 0 END                                                                AS avg_hours_per_day
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date BETWEEN $1 AND $2
      AND e.excluded = false
      AND ($3::text IS NULL OR e.group_type = $3)
      AND ($4::text IS NULL OR e.unit = $4)
      AND ($5::uuid[] IS NULL OR a.employee_id = ANY($5))
    GROUP BY %s
    ORDER BY %s
    LIMIT $6
  $q$,
    CASE p_group_by
      WHEN 'employee'   THEN 'e.full_name'
      WHEN 'group_type' THEN 'COALESCE(e.group_type, ''unclassified'')'
      WHEN 'unit'       THEN 'COALESCE(e.unit, ''(none)'')'
      WHEN 'date'       THEN 'to_char(a.date, ''YYYY-MM-DD'')'
    END,
    CASE p_group_by
      WHEN 'employee'   THEN 'e.full_name'
      WHEN 'group_type' THEN 'COALESCE(e.group_type, ''unclassified'')'
      WHEN 'unit'       THEN 'COALESCE(e.unit, ''(none)'')'
      WHEN 'date'       THEN 'to_char(a.date, ''YYYY-MM-DD'')'
    END,
    CASE p_group_by
      WHEN 'date' THEN '1 DESC'
      ELSE '1 ASC'
    END
  )
  USING p_from, p_to, p_group_type, p_unit, p_employee_ids, p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION query_attendance(date, date, text, text, text, uuid[], int) TO service_role;
```

- [ ] **Step 2: Apply migration**

Run: `supabase db push` (or paste SQL in dashboard).

Expected: function created.

- [ ] **Step 3: Write failing tests**

Create `src/lib/ask/__tests__/queryAttendance.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { queryAttendance } from '../tools/queryAttendance'

function makeSupabase(rows: unknown[]) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  return { rpc } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
}

describe('queryAttendance', () => {
  it('calls rpc with the right params', async () => {
    const sb = makeSupabase([])
    await queryAttendance({
      from: '2026-04-01', to: '2026-04-16',
      groupBy: 'employee',
      metrics: ['office_days', 'total_hours'],
    }, sb)
    const rpc = sb.rpc as unknown as ReturnType<typeof vi.fn>
    expect(rpc).toHaveBeenCalledWith('query_attendance', expect.objectContaining({
      p_from: '2026-04-01', p_to: '2026-04-16', p_group_by: 'employee',
    }))
  })

  it('returns only requested metrics in rows', async () => {
    const sb = makeSupabase([
      { group_key: 'Alice', office_days: 10, wfh_days: 2, remote_days: 0, leave_days: 0, sick_days: 0, no_clocking_days: 0, days_worked: 12, total_hours: 90, avg_hours_per_day: 7.5 },
    ])
    const res = await queryAttendance({
      from: '2026-04-01', to: '2026-04-16',
      groupBy: 'employee',
      metrics: ['office_days', 'total_hours'],
    }, sb)
    expect(res.rows[0]).toEqual({ groupKey: 'Alice', office_days: 10, total_hours: 90 })
    expect(res.rows[0]).not.toHaveProperty('wfh_days')
  })

  it('applies orderBy and limits client-side when orderBy is provided', async () => {
    const sb = makeSupabase([
      { group_key: 'A', office_days: 5, wfh_days: 0, remote_days: 0, leave_days: 0, sick_days: 0, no_clocking_days: 0, days_worked: 5, total_hours: 40, avg_hours_per_day: 8 },
      { group_key: 'B', office_days: 10, wfh_days: 0, remote_days: 0, leave_days: 0, sick_days: 0, no_clocking_days: 0, days_worked: 10, total_hours: 80, avg_hours_per_day: 8 },
    ])
    const res = await queryAttendance({
      from: '2026-04-01', to: '2026-04-16',
      groupBy: 'employee',
      metrics: ['office_days'],
      orderBy: { metric: 'office_days', direction: 'desc' },
      limit: 1,
    }, sb)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].groupKey).toBe('B')
  })
})
```

- [ ] **Step 4: Run tests (expect fail)**

Run: `npm test -- queryAttendance`

Expected: fails with module not found.

- [ ] **Step 5: Implement the tool**

Create `src/lib/ask/tools/queryAttendance.ts`:

```ts
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
```

- [ ] **Step 6: Run tests**

Run: `npm test -- queryAttendance`

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260416_query_attendance_fn.sql src/lib/ask/tools/queryAttendance.ts src/lib/ask/__tests__/queryAttendance.test.ts
git commit -m "feat(ask): add query_attendance tool with Postgres aggregator"
```

---

## Task 12: Tool — `list_on_status`

**Files:**
- Create: `src/lib/ask/tools/listOnStatus.ts`
- Create: `src/lib/ask/__tests__/listOnStatus.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/listOnStatus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { listOnStatus } from '../tools/listOnStatus'

function makeSupabase(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  const from = vi.fn().mockReturnValue(chain)
  return { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
}

describe('listOnStatus', () => {
  it('defaults date to today if omitted', async () => {
    const sb = makeSupabase([])
    await listOnStatus({ status: 'vacation' }, sb)
    const chain = (sb.from as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    const today = new Date().toISOString().slice(0, 10)
    expect(chain.eq).toHaveBeenCalledWith('date', today)
  })

  it('filters on the provided status', async () => {
    const sb = makeSupabase([])
    await listOnStatus({ date: '2026-04-16', status: 'sick' }, sb)
    const chain = (sb.from as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(chain.eq).toHaveBeenCalledWith('status', 'sick')
    expect(chain.eq).toHaveBeenCalledWith('date', '2026-04-16')
  })

  it('maps joined rows to employee summaries', async () => {
    const sb = makeSupabase([
      {
        hours_worked: 0, time_in: null, time_out: null,
        employees: { full_name: 'Alice', unit: 'Ops', excluded: false, group_type: 'office_malta' },
      },
    ])
    const res = await listOnStatus({ date: '2026-04-16', status: 'vacation' }, sb)
    expect(res.employees).toEqual([{ name: 'Alice', unit: 'Ops', hours: 0, timeIn: null, timeOut: null }])
  })

  it('excludes employees with excluded=true', async () => {
    const sb = makeSupabase([
      { hours_worked: 0, time_in: null, time_out: null, employees: { full_name: 'A', unit: null, excluded: false, group_type: null } },
      { hours_worked: 0, time_in: null, time_out: null, employees: { full_name: 'B', unit: null, excluded: true, group_type: null } },
    ])
    const res = await listOnStatus({ date: '2026-04-16', status: 'vacation' }, sb)
    expect(res.employees.map(e => e.name)).toEqual(['A'])
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- listOnStatus`

- [ ] **Step 3: Implement the tool**

Create `src/lib/ask/tools/listOnStatus.ts`:

```ts
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

  const rows = (data ?? []) as JoinedRow[]
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
```

- [ ] **Step 4: Run tests**

Run: `npm test -- listOnStatus`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/tools/listOnStatus.ts src/lib/ask/__tests__/listOnStatus.test.ts
git commit -m "feat(ask): add list_on_status tool"
```

---

## Task 13: Tool — `check_compliance`

Splits the two rules into pure date-math calculators (unit-tested) plus a thin DB-fetch wrapper (manual-verified). The rules:

- `four_day_office` — each ISO calendar week in range, an `office_malta` employee must have ≥ 4 records with status = `office`.
- `wfh_monday_friday_limit` — each calendar month in range, an `office_malta` employee must have ≤ 1 record with status = `wfh` on a Monday AND ≤ 1 record with status = `wfh` on a Friday.

**Files:**
- Create: `src/lib/ask/tools/checkCompliance.ts`
- Create: `src/lib/ask/__tests__/checkCompliance.test.ts`

- [ ] **Step 1: Write failing tests for rule calculators**

Create `src/lib/ask/__tests__/checkCompliance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  evaluateFourDayOffice,
  evaluateWfhMondayFridayLimit,
  type AttendanceRow,
} from '../tools/checkCompliance'

const emp = { id: 'e1', name: 'Alice', unit: 'Ops' }

describe('evaluateFourDayOffice', () => {
  it('flags a full week with only 3 office days', () => {
    // Mon-Fri, 3 office + 2 wfh
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'office' }, // Mon
      { date: '2026-04-07', status: 'office' }, // Tue
      { date: '2026-04-08', status: 'office' }, // Wed
      { date: '2026-04-09', status: 'wfh' },    // Thu
      { date: '2026-04-10', status: 'wfh' },    // Fri
    ]
    const violations = evaluateFourDayOffice(emp, rows, '2026-04-06', '2026-04-10')
    expect(violations).toHaveLength(1)
    expect(violations[0].period).toBe('2026-W15')
    expect(violations[0].actualOfficeDays).toBe(3)
  })

  it('passes a week with 4 office days', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'office' },
      { date: '2026-04-07', status: 'office' },
      { date: '2026-04-08', status: 'office' },
      { date: '2026-04-09', status: 'office' },
      { date: '2026-04-10', status: 'wfh' },
    ]
    expect(evaluateFourDayOffice(emp, rows, '2026-04-06', '2026-04-10')).toEqual([])
  })

  it('ignores weeks that fall partly outside the range', () => {
    // Only 2 days in range, but the full week has 4 office days elsewhere.
    // We count only records within the range window; partial weeks are flagged
    // only if the in-range office days fall short AND the partial week has ≥ 4 weekdays in range.
    const rows: AttendanceRow[] = [
      { date: '2026-04-09', status: 'office' },
      { date: '2026-04-10', status: 'office' },
    ]
    const violations = evaluateFourDayOffice(emp, rows, '2026-04-09', '2026-04-10')
    expect(violations).toEqual([]) // partial week, under 4 weekdays in range → skip
  })
})

describe('evaluateWfhMondayFridayLimit', () => {
  it('flags 2 WFH Mondays in the same month', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'wfh' },  // Mon
      { date: '2026-04-13', status: 'wfh' },  // Mon
    ]
    const violations = evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-04-30')
    expect(violations).toHaveLength(1)
    expect(violations[0].period).toBe('2026-04')
    expect(violations[0].wfhMondayCount).toBe(2)
  })

  it('flags 2 WFH Fridays in the same month', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-03', status: 'wfh' },   // Fri
      { date: '2026-04-10', status: 'wfh' },   // Fri
    ]
    const violations = evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-04-30')
    expect(violations).toHaveLength(1)
    expect(violations[0].wfhFridayCount).toBe(2)
  })

  it('passes 1 Mon + 1 Fri', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'wfh' },
      { date: '2026-04-10', status: 'wfh' },
    ]
    expect(evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-04-30')).toEqual([])
  })

  it('segments violations by month', () => {
    const rows: AttendanceRow[] = [
      { date: '2026-04-06', status: 'wfh' }, { date: '2026-04-13', status: 'wfh' }, // April: 2 Mons
      { date: '2026-05-04', status: 'wfh' }, { date: '2026-05-11', status: 'wfh' }, // May: 2 Mons
    ]
    const v = evaluateWfhMondayFridayLimit(emp, rows, '2026-04-01', '2026-05-31')
    expect(v).toHaveLength(2)
    expect(v.map(x => x.period).sort()).toEqual(['2026-04', '2026-05'])
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- checkCompliance`

- [ ] **Step 3: Implement the calculators and DB wrapper**

Create `src/lib/ask/tools/checkCompliance.ts`:

```ts
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
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
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
```

- [ ] **Step 4: Run tests**

Run: `npm test -- checkCompliance`

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/tools/checkCompliance.ts src/lib/ask/__tests__/checkCompliance.test.ts
git commit -m "feat(ask): add check_compliance tool with rule calculators"
```

---

## Task 14: Tool — `run_readonly_sql`

**Files:**
- Create: `src/lib/ask/tools/runReadonlySql.ts`
- Create: `src/lib/ask/__tests__/runReadonlySql.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/runReadonlySql.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../readonlyDb', () => ({
  executeReadonly: vi.fn(),
}))

import { runReadonlySql } from '../tools/runReadonlySql'
import { executeReadonly } from '../readonlyDb'

describe('runReadonlySql', () => {
  it('rejects non-SELECT with a validation error', async () => {
    const res = await runReadonlySql({
      query: 'DELETE FROM employees',
      reason: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error).toMatch(/SELECT/i)
    expect(executeReadonly).not.toHaveBeenCalled()
  })

  it('rejects query touching tables outside the whitelist', async () => {
    const res = await runReadonlySql({
      query: 'SELECT * FROM ask_ai_logs',
      reason: 'audit',
    })
    expect(res.error).toMatch(/allowed|whitelist|table/i)
    expect(executeReadonly).not.toHaveBeenCalled()
  })

  it('passes valid SELECTs through to executeReadonly', async () => {
    vi.mocked(executeReadonly).mockResolvedValue({
      rows: [{ count: 37 }], rowCount: 1, truncated: false,
    })
    const res = await runReadonlySql({
      query: 'SELECT count(*) FROM employees',
      reason: 'count',
    })
    expect(res.rowCount).toBe(1)
    expect(res.rows).toEqual([{ count: 37 }])
    expect(executeReadonly).toHaveBeenCalledWith('SELECT count(*) FROM employees')
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- runReadonlySql`

- [ ] **Step 3: Implement the tool**

Create `src/lib/ask/tools/runReadonlySql.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npm test -- runReadonlySql`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/tools/runReadonlySql.ts src/lib/ask/__tests__/runReadonlySql.test.ts
git commit -m "feat(ask): add run_readonly_sql tool with validation"
```

---

## Task 15: Tool registry

**Files:**
- Create: `src/lib/ask/tools/index.ts`

- [ ] **Step 1: Write the registry**

Create `src/lib/ask/tools/index.ts`:

```ts
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
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ask/tools/index.ts
git commit -m "feat(ask): add tool registry with executeTool dispatch"
```

---

## Task 16: Relevance guard (extracted)

**Files:**
- Create: `src/lib/ask/guards.ts`
- Create: `src/lib/ask/__tests__/guards.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/guards.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { validateInput, isRelevant } from '../guards'

describe('validateInput', () => {
  it('rejects empty', () => {
    expect(validateInput('   ')).toEqual({ ok: false, reason: expect.stringMatching(/required/i) })
  })
  it('rejects over 500 chars', () => {
    expect(validateInput('x'.repeat(501))).toEqual({ ok: false, reason: expect.stringMatching(/500/) })
  })
  it('accepts normal', () => {
    expect(validateInput('Who is on leave today?')).toEqual({ ok: true })
  })
})

describe('isRelevant', () => {
  function mockOpenAI(answer: string) {
    return {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: answer } }] }) } },
    }
  }

  it('returns true for yes', async () => {
    const openai = mockOpenAI('yes')
    expect(await isRelevant('hr stuff', openai as never)).toBe(true)
  })
  it('returns false for no', async () => {
    const openai = mockOpenAI('no')
    expect(await isRelevant('who is donald trump', openai as never)).toBe(false)
  })
  it('treats empty response as not relevant', async () => {
    const openai = mockOpenAI('')
    expect(await isRelevant('x', openai as never)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- guards`

- [ ] **Step 3: Implement guards**

Create `src/lib/ask/guards.ts`:

```ts
import type OpenAI from 'openai'

export type ValidationResult = { ok: true } | { ok: false; reason: string }

export const QUESTION_CHAR_LIMIT = 500

export function validateInput(question: unknown): ValidationResult {
  if (typeof question !== 'string' || !question.trim()) {
    return { ok: false, reason: 'Question is required' }
  }
  if (question.length > QUESTION_CHAR_LIMIT) {
    return { ok: false, reason: `Question is too long (max ${QUESTION_CHAR_LIMIT} characters)` }
  }
  return { ok: true }
}

export async function isRelevant(question: string, openai: OpenAI): Promise<boolean> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a classifier. Respond with ONLY "yes" or "no". Is this question related to HR, employees, attendance, office, work-from-home, leave, sick days, compliance, scheduling, hours worked, or workforce analytics? Indirect questions like "who works the most" or "any patterns" count as yes.',
      },
      { role: 'user', content: question },
    ],
    temperature: 0,
    max_tokens: 3,
  })
  const content = (res.choices[0]?.message?.content ?? '').toLowerCase().trim()
  return content.startsWith('yes')
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- guards`

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/guards.ts src/lib/ask/__tests__/guards.test.ts
git commit -m "feat(ask): extract input validation and relevance guard"
```

---

## Task 17: Rate limiter

**Files:**
- Modify: `src/lib/ask/guards.ts`
- Create: `src/lib/ask/__tests__/rateLimit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/rateLimit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { checkRateLimit, RATE_LIMIT_PER_HOUR } from '../guards'

function makeSupabase(count: number) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    then: (resolve: (v: { count: number; error: null }) => void) => resolve({ count, error: null }),
  }
  const from = vi.fn().mockReturnValue(chain)
  return { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
}

describe('checkRateLimit', () => {
  it('allows under the threshold', async () => {
    const sb = makeSupabase(RATE_LIMIT_PER_HOUR - 1)
    const res = await checkRateLimit('user-1', sb)
    expect(res.allowed).toBe(true)
  })
  it('blocks at the threshold', async () => {
    const sb = makeSupabase(RATE_LIMIT_PER_HOUR)
    const res = await checkRateLimit('user-1', sb)
    expect(res.allowed).toBe(false)
    expect(res.retryAfterSeconds).toBeGreaterThan(0)
  })
  it('allows when no user id (public access)', async () => {
    const sb = makeSupabase(9999)
    const res = await checkRateLimit(null, sb)
    expect(res.allowed).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- rateLimit`

- [ ] **Step 3: Add `checkRateLimit` to `guards.ts`**

Append to `src/lib/ask/guards.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export const RATE_LIMIT_PER_HOUR = 30

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export async function checkRateLimit(
  userId: string | null,
  supabase: SupabaseClient,
): Promise<RateLimitResult> {
  if (!userId) return { allowed: true }

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { count, error } = await supabase
    .from('ask_ai_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('created_at', oneHourAgo) as unknown as { count: number; error: null | { message: string } }

  if (error) throw new Error(`Rate limit check failed: ${error.message}`)

  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return { allowed: false, retryAfterSeconds: 3600 }
  }
  return { allowed: true }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- rateLimit`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/guards.ts src/lib/ask/__tests__/rateLimit.test.ts
git commit -m "feat(ask): add per-user hourly rate limit"
```

---

## Task 18: Logging helpers

**Files:**
- Create: `src/lib/ask/logging.ts`
- Create: `src/lib/ask/__tests__/logging.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/logging.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { writeLog } from '../logging'

function makeSupabase() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn().mockReturnValue({ insert })
  return { supabase: { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>, insert }
}

describe('writeLog', () => {
  it('inserts a row with provided fields', async () => {
    const { supabase, insert } = makeSupabase()
    await writeLog(supabase, {
      userId: 'u1',
      question: 'q',
      relevancePassed: true,
      rateLimited: false,
      toolCalls: [],
      finalAnswer: 'a',
      totalTokens: 100,
      totalDurationMs: 1234,
    })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1',
      question: 'q',
      relevance_passed: true,
      rate_limited: false,
      tool_calls: [],
      final_answer: 'a',
      total_tokens: 100,
      total_duration_ms: 1234,
      error: null,
    })
  })

  it('swallows insert errors (logging must not break the handler)', async () => {
    const from = vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'boom' } }),
    })
    const supabase = { from } as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>
    await expect(writeLog(supabase, { question: 'q' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- logging`

- [ ] **Step 3: Implement `writeLog`**

Create `src/lib/ask/logging.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolCallRecord } from './types'

export type LogInput = {
  userId?: string | null
  question: string
  relevancePassed?: boolean
  rateLimited?: boolean
  toolCalls?: ToolCallRecord[]
  finalAnswer?: string | null
  totalTokens?: number | null
  totalDurationMs?: number | null
  error?: string | null
}

export async function writeLog(supabase: SupabaseClient, input: LogInput): Promise<void> {
  try {
    const { error } = await supabase.from('ask_ai_logs').insert({
      user_id: input.userId ?? null,
      question: input.question,
      relevance_passed: input.relevancePassed ?? null,
      rate_limited: input.rateLimited ?? false,
      tool_calls: input.toolCalls ?? null,
      final_answer: input.finalAnswer ?? null,
      total_tokens: input.totalTokens ?? null,
      total_duration_ms: input.totalDurationMs ?? null,
      error: input.error ?? null,
    })
    if (error) console.error('[ask_ai_logs] insert failed', error)
  } catch (err) {
    console.error('[ask_ai_logs] insert threw', err)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- logging`

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/logging.ts src/lib/ask/__tests__/logging.test.ts
git commit -m "feat(ask): add ask_ai_logs writer that never throws"
```

---

## Task 19: Agent loop

**Files:**
- Create: `src/lib/ask/agent.ts`
- Create: `src/lib/ask/__tests__/agent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ask/__tests__/agent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../tools', () => ({
  TOOL_DEFINITIONS: [],
  executeTool: vi.fn(),
}))

import { runAgent, MAX_ITERATIONS, MAX_TOOL_RESULT_BYTES } from '../agent'
import { executeTool } from '../tools'

function makeOpenAI(responses: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: string }> }>) {
  let i = 0
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => {
          const r = responses[i++]
          return {
            choices: [{
              message: {
                content: r.content ?? null,
                tool_calls: r.toolCalls?.map(tc => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.args },
                })),
              },
            }],
            usage: { total_tokens: 100 },
          }
        }),
      },
    },
  }
}

describe('runAgent', () => {
  it('returns immediately when the model responds with no tool call', async () => {
    const openai = makeOpenAI([{ content: 'Hello world' }])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Hello world')
    expect(res.toolCalls).toHaveLength(0)
  })

  it('executes tool calls and loops until a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: { rows: [{ x: 1 }] }, rowCount: 1 })
    const openai = makeOpenAI([
      { toolCalls: [{ id: 't1', name: 'query_attendance', args: '{}' }] },
      { content: 'Final' },
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Final')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0].tool).toBe('query_attendance')
  })

  it('throws when the iteration cap is hit without a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: {}, rowCount: 0 })
    const loops = Array.from({ length: MAX_ITERATIONS + 1 }, (_, i) => ({
      toolCalls: [{ id: `t${i}`, name: 'list_employees', args: '{}' }],
    }))
    const openai = makeOpenAI(loops)
    const supabase = {} as never
    await expect(runAgent({ question: 'q', openai: openai as never, supabase })).rejects.toThrow(/iteration cap/i)
  })

  it('truncates tool results larger than the cap', async () => {
    const big = { huge: 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1000) }
    vi.mocked(executeTool).mockResolvedValue({ result: big, rowCount: 1 })
    const openai = makeOpenAI([
      { toolCalls: [{ id: 't1', name: 'run_readonly_sql', args: '{}' }] },
      { content: 'done' },
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.toolCalls[0].truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- agent`

- [ ] **Step 3: Implement the agent**

Create `src/lib/ask/agent.ts`:

```ts
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import { buildSystemPrompt } from './systemPrompt'
import type { AskResult, ToolCallRecord } from './types'

export const MAX_ITERATIONS = 5
export const MAX_TOKENS_PER_REQUEST = 8000
export const MAX_TOOL_RESULT_BYTES = 10 * 1024

export async function runAgent(params: {
  question: string
  openai: OpenAI
  supabase: SupabaseClient
}): Promise<AskResult> {
  const { question, openai, supabase } = params
  const started = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(today) },
    { role: 'user', content: question },
  ]
  const toolCalls: ToolCallRecord[] = []
  let totalTokens = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.2,
    })
    totalTokens += res.usage?.total_tokens ?? 0
    if (totalTokens > MAX_TOKENS_PER_REQUEST) {
      throw new Error('Token budget exceeded')
    }

    const msg = res.choices[0]?.message
    if (!msg) throw new Error('Empty response from OpenAI')
    messages.push(msg as ChatCompletionMessageParam)

    const calls = msg.tool_calls ?? []
    if (calls.length === 0) {
      return {
        answer: msg.content ?? '',
        toolCalls,
        totalTokens,
        totalDurationMs: Date.now() - started,
      }
    }

    for (const call of calls) {
      const t0 = Date.now()
      let record: ToolCallRecord
      let toolOutput: unknown
      try {
        const fn = call.function
        const out = await executeTool(fn.name, fn.arguments, supabase)
        const serialized = JSON.stringify(out.result)
        const truncated = serialized.length > MAX_TOOL_RESULT_BYTES
        toolOutput = truncated ? serialized.slice(0, MAX_TOOL_RESULT_BYTES) + '"...(truncated)"' : serialized
        record = {
          tool: fn.name,
          args: safeJson(fn.arguments),
          rowCount: out.rowCount,
          durationMs: Date.now() - t0,
          truncated,
        }
      } catch (err) {
        toolOutput = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        record = {
          tool: call.function.name,
          args: safeJson(call.function.arguments),
          rowCount: null,
          durationMs: Date.now() - t0,
          truncated: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
      toolCalls.push(record)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
      })
    }
  }

  throw new Error('Agent iteration cap reached without final answer')
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- agent`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ask/agent.ts src/lib/ask/__tests__/agent.test.ts
git commit -m "feat(ask): add agent loop with iteration + token + result caps"
```

---

## Task 20: Refactor `/api/ask` route

**Files:**
- Modify: `src/app/api/ask/route.ts` (full rewrite)

- [ ] **Step 1: Replace the route handler**

Replace the entire contents of `src/app/api/ask/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { runAgent } from '@/lib/ask/agent'
import { validateInput, isRelevant, checkRateLimit } from '@/lib/ask/guards'
import { writeLog } from '@/lib/ask/logging'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const started = Date.now()
  const supabase = createAdminClient()
  let userId: string | null = null

  try {
    const authed = await createServerClient()
    const { data: { user } } = await authed.auth.getUser()
    userId = user?.id ?? null
  } catch { /* anonymous ok */ }

  let question = ''
  try {
    const body = await req.json()
    question = typeof body?.question === 'string' ? body.question : ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const v = validateInput(question)
  if (!v.ok) {
    await writeLog(supabase, { userId, question, error: v.reason })
    return NextResponse.json({ error: v.reason }, { status: 400 })
  }

  const rl = await checkRateLimit(userId, supabase)
  if (!rl.allowed) {
    await writeLog(supabase, { userId, question, rateLimited: true })
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in an hour.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let relevancePassed = false
  try {
    relevancePassed = await isRelevant(question, openai)
  } catch (err) {
    await writeLog(supabase, {
      userId, question, relevancePassed: null as never,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Relevance check failed' }, { status: 500 })
  }

  if (!relevancePassed) {
    const answer = "I can only answer questions related to **HR data** in this system — employee attendance, office compliance, leave, hours worked, and workforce analytics.\n\nTry asking something like:\n- Who has the most office days this month?\n- Which employees are not compliant?\n- What's the average hours worked?"
    await writeLog(supabase, {
      userId, question, relevancePassed: false,
      finalAnswer: answer, totalDurationMs: Date.now() - started,
    })
    return NextResponse.json({
      answer, question,
      context: { dateRange: { from: '', to: '' }, employeeCount: 0, recordCount: 0 },
      timestamp: new Date().toISOString(),
      filtered: true,
    })
  }

  try {
    const result = await runAgent({ question, openai, supabase })

    await writeLog(supabase, {
      userId, question, relevancePassed: true,
      toolCalls: result.toolCalls,
      finalAnswer: result.answer,
      totalTokens: result.totalTokens,
      totalDurationMs: result.totalDurationMs,
    })

    // Surface tool-derived counts into the legacy `context` field the UI expects.
    let employeeCount = 0
    let recordCount = 0
    let dateRange: { from: string; to: string } = { from: '', to: '' }
    for (const tc of result.toolCalls) {
      if (tc.tool === 'list_employees' || tc.tool === 'check_compliance') {
        employeeCount = Math.max(employeeCount, tc.rowCount ?? 0)
      }
      if (tc.tool === 'query_attendance') {
        recordCount = Math.max(recordCount, tc.rowCount ?? 0)
        const args = tc.args as { from?: string; to?: string } | null
        if (args?.from && args?.to) dateRange = { from: args.from, to: args.to }
      }
    }

    return NextResponse.json({
      answer: result.answer,
      question,
      context: { dateRange, employeeCount, recordCount },
      timestamp: new Date().toISOString(),
      toolCalls: result.toolCalls,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate answer'
    await writeLog(supabase, {
      userId, question, relevancePassed: true,
      error: message, totalDurationMs: Date.now() - started,
    })
    console.error('[ask]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors. If any path imports (e.g., `@/lib/supabase/server`) look wrong, open the file and confirm it exports `createServerClient`; fix the import if needed.

- [ ] **Step 3: Run the whole test suite**

Run: `npm test`

Expected: all tests pass. The legacy route behavior is not unit-tested; integration verification is Task 22-23.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ask/route.ts
git commit -m "refactor(ask): wire route handler to tool-calling agent"
```

---

## Task 21: Environment variable setup

**Files:**
- Modify: `.env.local` (locally only, not committed)
- Create: `.env.example` (if absent)

- [ ] **Step 1: Get the readonly connection string**

From the Supabase dashboard:
- Project settings → Database → Connection string
- Copy the `URI` format (looks like `postgresql://postgres.<ref>:<password>@<host>:5432/postgres`)
- Replace the user and password portion with `ask_ai_readonly` and the password you set in Task 4 Step 2.
- Final form: `postgresql://ask_ai_readonly:<password>@<host>:5432/postgres`

- [ ] **Step 2: Add to local env**

Append to `.env.local`:

```
DATABASE_URL_READONLY=postgresql://ask_ai_readonly:<password>@<host>:5432/postgres
```

Do NOT commit `.env.local` — it is already gitignored.

- [ ] **Step 3: Add to `.env.example`**

If `.env.example` exists, append:
```
DATABASE_URL_READONLY=
```
If it does not exist, create it with:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
DATABASE_URL_READONLY=
```

- [ ] **Step 4: Add the var to Vercel**

On the Vercel dashboard: Project → Settings → Environment Variables → add `DATABASE_URL_READONLY` for Production + Preview with the same connection string. Redeploy after shipping.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "chore: document DATABASE_URL_READONLY env var"
```

---

## Task 22: SQL escape hatch negative tests (integration)

These tests verify the three defense layers actually block the relevant threats. They require a reachable Supabase with `DATABASE_URL_READONLY` set. They are skipped when the env var is absent.

**Files:**
- Create: `src/lib/ask/__tests__/sqlGuardIntegration.test.ts`

- [ ] **Step 1: Write the integration tests**

Create `src/lib/ask/__tests__/sqlGuardIntegration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { executeReadonly } from '../readonlyDb'

const HAS_DB = !!process.env.DATABASE_URL_READONLY
const maybe = HAS_DB ? describe : describe.skip

maybe('Readonly DB defense layers (integration)', () => {
  it('runs a plain SELECT successfully', async () => {
    const res = await executeReadonly('SELECT count(*) AS n FROM employees')
    expect(res.rows.length).toBe(1)
  })

  it('blocks INSERT at the role level', async () => {
    await expect(
      executeReadonly("INSERT INTO employees (first_name, last_name) VALUES ('x','y')"),
    ).rejects.toThrow()
  })

  it('blocks access to ask_ai_logs at the role level', async () => {
    await expect(executeReadonly('SELECT * FROM ask_ai_logs')).rejects.toThrow()
  })

  it('enforces statement_timeout on long queries', async () => {
    await expect(
      executeReadonly("SELECT pg_sleep(10)"),
    ).rejects.toThrow(/timeout|canceling statement/i)
  }, 10_000)

  it('caps results at 500 rows', async () => {
    const res = await executeReadonly('SELECT 1 AS x FROM generate_series(1, 10000)')
    expect(res.rowCount).toBeLessThanOrEqual(500)
    expect(res.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `npm test -- sqlGuardIntegration`

Expected: 5 passed (or all skipped if `DATABASE_URL_READONLY` is unset).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ask/__tests__/sqlGuardIntegration.test.ts
git commit -m "test(ask): add integration tests for SQL escape hatch defense layers"
```

---

## Task 23: End-to-end smoke test against real data

Manual verification step. No test file — run the dev server and exercise the five canonical questions through the UI.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open http://localhost:3000/dashboard/ask.

- [ ] **Step 2: Ask each canonical question and verify**

For each question below, submit it and verify:
- The answer is grounded in real data (employee names from your seed set appear).
- The UI footer shows non-zero employee/record counts where appropriate.
- The network tab response includes `toolCalls[]` with the expected tool.

Questions to verify:

1. `Who has the most office days this month?`
   - Expected tool(s): `query_attendance` with `groupBy='employee'`, `metrics` including `office_days`, `orderBy`.
2. `Who is on leave today?`
   - Expected tool: `list_on_status` with `status='vacation'`.
3. `Show me the top 5 employees by attendance`
   - Expected tool: `query_attendance` with `orderBy`, `limit=5`.
4. `Compare average hours worked between Unit A and Unit B over the last quarter`
   - Substitute real unit names. Expected tool: `query_attendance` with `groupBy='unit'`, `metrics=['avg_hours_per_day']` or `total_hours`.
5. `Which Malta office employees broke the 4-day rule this month?`
   - Expected tool: `check_compliance` with `rule='four_day_office'`.
6. Regression: `Who is Donald Trump?`
   - Expected: canned refusal, `filtered: true`, zero tool calls.

- [ ] **Step 3: Inspect the `ask_ai_logs` table**

In the Supabase SQL editor:

```sql
SELECT created_at, question, relevance_passed,
       jsonb_array_length(tool_calls) AS tool_count,
       total_tokens, total_duration_ms, error
FROM ask_ai_logs
ORDER BY created_at DESC
LIMIT 20;
```

Verify:
- Every question you asked appears exactly once.
- `tool_count` > 0 for the five HR questions, `0` for the refusal.
- `total_tokens` stays under 8000 per row.
- `error` is NULL for successful rows.

- [ ] **Step 4: No commit for this task**

Task is verification-only. If any assertion fails, open a debugging loop rather than committing a workaround.

---

## Summary

23 tasks total:
- Infra (1-2)
- Migrations (3-5)
- Core (6-9)
- Tools (10-14)
- Registry + guards + logging + agent (15-19)
- Route + env + verification (20-23)

Total new files: ~20. Total modified files: 3 (package.json, route.ts, .env.example).
