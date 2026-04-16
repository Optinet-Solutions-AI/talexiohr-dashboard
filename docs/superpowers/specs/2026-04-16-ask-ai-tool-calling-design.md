# Ask AI — Tool-Calling Agent Design

**Date:** 2026-04-16
**Status:** Approved, ready for implementation plan
**Scope:** Replace the current bulk-fetch + JSON-stuffing pattern in `/api/ask` with an OpenAI tool-calling agent backed by curated Postgres-aggregating functions and a guarded SQL escape hatch.

## 1. Motivation

### 1.1 What exists today

The current [src/app/api/ask/route.ts](../../../src/app/api/ask/route.ts) implements Ask AI as:

1. A relevance classifier (`gpt-4o-mini`) rejects non-HR questions.
2. A hardcoded fetch pulls every non-excluded employee plus up to 2000 attendance rows spanning a date range inferred by keyword sniffing (`year`/`month`/`week`).
3. Per-employee and overall aggregates are computed in JavaScript.
4. The full aggregated payload is serialized, truncated at 80KB, and placed in the user prompt for `gpt-4o-mini` to read.

### 1.2 Why it breaks at scale

The production dataset will contain 1000+ employees (current data is a 37-employee dummy set). At that scale:

- 1000 employees × 30 days yields ~30,000 attendance rows per request, exceeding the 80KB cap long before the model sees useful data.
- The keyword-based date window cannot express comparisons ("Q1 vs Q2"), trends ("week-over-week"), or arbitrary filters.
- Every request ships a large payload regardless of the question — the model is forced to search the blob for what it needs.
- Business rules (Malta office 4-day requirement, WFH Monday/Friday limit) live in the prompt, where the model can misapply them.

### 1.3 Why vector RAG is not the answer today

All current data is structured (employees, attendance rows, hours, dates, statuses). Vector similarity search is strong on unstructured text (policies, comments, emails) and weak on aggregations, filters, and temporal comparisons — which describes every real Ask AI question.

The unstructured corpus the client may add in the future (policy PDFs, free-text comments, notes) is a valid use case for vector RAG **when it exists**. Building that infrastructure now indexes nothing useful and maintains a pipeline for data that may never arrive.

The agent loop designed below treats tools as pluggable. Adding a `search_documents` vector tool later is additive — no rework of anything built now.

## 2. Architecture

```
POST /api/ask { question }
  │
  ├─▶ 1. Input validation + relevance guard (gpt-4o-mini)
  │       └─ not HR? → return canned refusal, log, exit
  │
  ├─▶ 2. Rate-limit check (per user, last hour)
  │       └─ over limit? → 429, log, exit
  │
  ├─▶ 3. Agent loop (gpt-4o-mini with tools)
  │       ├─ model selects tool + args
  │       ├─ we validate args, execute against Postgres
  │       ├─ append tool result (capped at 10KB per call) to history
  │       └─ repeat until final answer or iteration cap (5)
  │
  └─▶ 4. Response { answer, toolCalls[], context }
          └─ persist full request + tool trace to ask_ai_logs
```

### 2.1 File layout

The current single-file route mixes transport, orchestration, guards, and data access. For testability at 1000+ scale, split as follows:

- `src/app/api/ask/route.ts` — thin HTTP handler (parse body, call agent, return JSON)
- `src/lib/ask/agent.ts` — tool-call loop, iteration cap, budget enforcement
- `src/lib/ask/guards.ts` — relevance classifier, input validation, rate limit
- `src/lib/ask/logging.ts` — `ask_ai_logs` insert helpers
- `src/lib/ask/tools/index.ts` — exports the OpenAI tool definitions array
- `src/lib/ask/tools/listEmployees.ts`
- `src/lib/ask/tools/queryAttendance.ts`
- `src/lib/ask/tools/listOnStatus.ts`
- `src/lib/ask/tools/checkCompliance.ts`
- `src/lib/ask/tools/runReadonlySql.ts`

Each tool file exports: (a) the OpenAI tool definition (name, description, JSON schema for args), (b) the implementation that takes parsed args and returns a typed result.

### 2.2 Why this structure

- The HTTP route stays ≤50 lines and only handles transport concerns.
- Tool functions are pure, synchronously testable against a test Postgres, and do not depend on OpenAI or the agent loop.
- Adding a new tool later (e.g. the future `search_documents` vector tool) is one new file in `tools/` plus a line in `tools/index.ts`. No other code changes.

## 3. Tool Functions

All five tools aggregate in Postgres. None return raw attendance rows to the model. All date parameters are ISO `YYYY-MM-DD`. All return values are JSON-serializable.

### 3.1 `list_employees`

Directory lookup with filters.

```ts
listEmployees({
  filters?: {
    groupType?: 'office_malta' | 'remote' | 'unclassified'
    unit?: string
    position?: string
    search?: string              // ILIKE match on full_name
    includeExcluded?: boolean    // default false
  }
  limit?: number                 // default 100, max 1000
}) => { employees: EmployeeSummary[], total: number }

type EmployeeSummary = {
  id: string
  name: string
  talexioId: string | null
  unit: string | null
  position: string | null
  groupType: string | null
  jobSchedule: string | null
}
```

**Example question:** "list all employees in the Ops unit"

### 3.2 `query_attendance`

Aggregation workhorse. Covers rank/top-N, group comparisons, and per-employee summaries.

```ts
queryAttendance({
  from: string
  to: string
  groupBy: 'employee' | 'group_type' | 'unit' | 'date'
  metrics: Array<
    | 'office_days' | 'wfh_days' | 'remote_days'
    | 'leave_days' | 'sick_days' | 'no_clocking_days'
    | 'days_worked' | 'total_hours' | 'avg_hours_per_day'
  >
  filters?: {
    groupType?: 'office_malta' | 'remote'
    unit?: string
    employeeIds?: string[]
  }
  orderBy?: { metric: string, direction: 'asc' | 'desc' }
  limit?: number                 // default 50, max 500
}) => { rows: AggregateRow[], rowCount: number }

type AggregateRow = {
  groupKey: string               // employee name, group_type, unit, or date
  [metric: string]: number | string
}
```

**Example questions:** "who has the most office days this month", "top 5 by attendance", "compare average hours between Unit A and Unit B last quarter"

**Implementation note:** a single parameterized SQL query with `CASE` expressions for each metric and `GROUP BY` matching the `groupBy` value. No per-row JS processing.

### 3.3 `list_on_status`

Point-in-time status lookup. Kept separate from `query_attendance` so the LLM routes "who is X right now" questions without having to reason through date ranges.

```ts
listOnStatus({
  date: string                   // default today
  status: 'vacation' | 'sick' | 'no_clocking' | 'office' | 'wfh' | 'remote'
  filters?: { groupType?: string, unit?: string }
}) => {
  date: string
  status: string
  employees: Array<{
    name: string
    unit: string | null
    hours?: number
    timeIn?: string
    timeOut?: string
  }>
}
```

**Example question:** "who is on leave today"

### 3.4 `check_compliance`

Encodes Rooster Partners business rules in code. The LLM never has to compute them.

Rules implemented:

- **`four_day_office`** — a Malta office employee must have at least 4 office days per calendar week within the range.
- **`wfh_monday_friday_limit`** — a Malta office employee may WFH at most 1 Monday and 1 Friday per calendar month within the range.

```ts
checkCompliance({
  from: string
  to: string
  rule: 'four_day_office' | 'wfh_monday_friday_limit' | 'all'
  employeeIds?: string[]         // default: all office_malta employees
}) => {
  rule: string
  violations: Array<{
    employee: { id: string, name: string, unit: string | null }
    period: string               // e.g. "2026-W14" or "2026-04"
    actualOfficeDays?: number
    wfhMondayCount?: number
    wfhFridayCount?: number
    details: string
  }>
  summary: { totalChecked: number, totalViolators: number }
}
```

**Example question:** "which Malta office employees broke the 4-day rule this month"

**Future rule changes** edit this file only. The LLM prompt does not need updating.

### 3.5 `run_readonly_sql`

Escape hatch for genuinely ad-hoc questions no curated tool covers.

```ts
runReadonlySql({
  query: string                  // single SELECT statement
  reason: string                 // why no curated tool fit — logged, not executed
}) => {
  rows: unknown[]
  rowCount: number
  truncated: boolean             // true if result hit the 500-row cap
}
```

The `reason` field is a soft nudge: the system prompt instructs the model to prefer the four typed tools and only fall through to SQL when no tool fits. Logging `reason` produces a backlog of question shapes that deserve new curated tools.

Safety model in §5.

## 4. Agent Loop

```ts
// src/lib/ask/agent.ts
async function runAgent(question: string, userId: string): Promise<AskResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ]
  const toolCalls: ToolCallRecord[] = []
  let totalTokens = 0

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: ALL_TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.2,
    })

    totalTokens += response.usage?.total_tokens ?? 0
    if (totalTokens > MAX_TOKENS_PER_REQUEST) throw new Error('Token budget exceeded')

    const msg = response.choices[0].message
    messages.push(msg)

    if (!msg.tool_calls?.length) {
      return { answer: msg.content ?? '', toolCalls, totalTokens }
    }

    for (const call of msg.tool_calls) {
      const result = await executeTool(call.function.name, call.function.arguments)
      const truncated = truncateToolResult(result, MAX_TOOL_RESULT_BYTES)
      toolCalls.push({
        tool: call.function.name,
        args: call.function.arguments,
        rowCount: result.rowCount ?? null,
        durationMs: result.durationMs,
        truncated: truncated.truncated,
      })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(truncated.value),
      })
    }
  }

  throw new Error('Iteration cap reached without final answer')
}
```

### 4.1 Budget constants

| Constant | Value | Rationale |
|---|---|---|
| `MAX_ITERATIONS` | 5 | Covers most multi-tool questions; stops infinite loops |
| `MAX_TOKENS_PER_REQUEST` | 8000 | Worst-case cost ceiling |
| `MAX_TOOL_RESULT_BYTES` | 10240 | Forces aggregation; prevents raw-row leakage into the prompt |
| `QUESTION_CHAR_LIMIT` | 500 | Matches current implementation |
| `RATE_LIMIT_PER_USER_PER_HOUR` | 30 | Stops runaway scripts |

### 4.2 System prompt

Preserves the existing company context (two groups, compliance rules, "best employee" definition). Adds:

- Tool preference: prefer typed tools; only use `run_readonly_sql` when no tool fits.
- Never fabricate data — if tools return nothing, say so.
- `reason` field on SQL calls is required and audited.

## 5. Safety — SQL Escape Hatch

Three independent layers. The escape hatch is the largest attack surface; each layer independently prevents damage.

### 5.1 Layer 1 — Node-side validation

Before the query leaves Node, parse it with [node-sql-parser](https://www.npmjs.com/package/node-sql-parser). Reject if:

- AST type ≠ `select` (blocks INSERT/UPDATE/DELETE/DDL/DCL/TCL)
- More than one statement (blocks `; DROP TABLE…`)
- References any table other than `employees`, `attendance_records` (whitelist)
- References any function in: `pg_sleep`, `pg_read_file`, `pg_ls_dir`, `pg_read_server_files`, `pg_terminate_backend`, `lo_import`, `lo_export`, `copy`
- References any schema other than `public`

Validation errors return a structured response to the LLM so it can retry with a corrected query, not a hard 500 to the user.

### 5.2 Layer 2 — Dedicated Postgres role

```sql
CREATE ROLE ask_ai_readonly NOLOGIN;
REVOKE ALL ON SCHEMA public FROM ask_ai_readonly;
GRANT USAGE ON SCHEMA public TO ask_ai_readonly;
GRANT SELECT ON employees, attendance_records TO ask_ai_readonly;
```

Layer 2 enforces the same whitelist at the database level — even if Node validation is bypassed, the role cannot touch other tables or perform writes.

A new env var `DATABASE_URL_READONLY` points to this role. Only the `run_readonly_sql` tool uses this connection. All four other tools continue using the existing Supabase admin client.

### 5.3 Layer 3 — Runtime limits via Supabase RPC

```sql
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
  EXECUTE format('SELECT jsonb_agg(t) FROM (%s LIMIT 500) t', q) INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION ask_ai_execute(text) TO ask_ai_readonly;
```

- **3-second statement timeout** — runaway queries die automatically.
- **Read-only transaction** — defense in depth even if role grants ever leak.
- **Implicit `LIMIT 500`** — injected by the wrapper; the LLM cannot remove it.

### 5.4 Threat coverage

| Threat | Layer(s) that catch it |
|---|---|
| DELETE / DROP / UPDATE via LLM | 1, 2, 3 |
| Access to a table outside the whitelist | 1, 2 |
| Long-running query / DoS | 3 |
| Unbounded result set | 3 |
| Multi-statement injection (`; DROP…`) | 1 |
| Reading arbitrary files via `pg_read_file` | 1, 2 |

## 6. Observability

### 6.1 `ask_ai_logs` table

```sql
CREATE TABLE ask_ai_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id),
  question text NOT NULL,
  relevance_passed boolean,
  rate_limited boolean DEFAULT false,
  tool_calls jsonb,              -- [{ tool, args, rowCount, durationMs, truncated, error? }]
  final_answer text,
  total_tokens int,
  total_duration_ms int,
  error text
);

CREATE INDEX ask_ai_logs_user_created ON ask_ai_logs(user_id, created_at DESC);
CREATE INDEX ask_ai_logs_created ON ask_ai_logs(created_at DESC);
```

Every request writes exactly one row. Writes happen in a `finally` block so errors do not suppress logs.

### 6.2 What the logs unlock

- **Cost tracking:** `SELECT date_trunc('day', created_at), sum(total_tokens), count(*) FROM ask_ai_logs GROUP BY 1`
- **Escape-hatch audit:** filter `tool_calls @> '[{"tool":"run_readonly_sql"}]'` and review the `reason` fields weekly — each is a candidate for a new curated tool.
- **User patterns:** rate-limit check queries this same table (count where `user_id = $1 AND created_at > now() - interval '1 hour'`).
- **Error hotspots:** `WHERE error IS NOT NULL` shows failures by tool and question pattern.

### 6.3 UI surfacing

The Ask AI page already displays a footer like `37 employees · 588 records · 2026-03-17 → 2026-04-16`. Today that comes from the ad-hoc context object. After this change it derives from the `tool_calls` array — showing actual counts from the tools that ran, not the full dataset size.

## 7. Rate Limiting

Implemented via a single Postgres query against `ask_ai_logs`:

```sql
SELECT count(*)
FROM ask_ai_logs
WHERE user_id = $1
  AND created_at > now() - interval '1 hour'
  AND rate_limited = false
```

If count ≥ 30, return HTTP 429 with a human-readable message, log the attempt with `rate_limited = true`, and skip the OpenAI call. No Redis required at the scale in scope (≤50 concurrent users).

## 8. Environment Variables

| Variable | Purpose | Existing? |
|---|---|---|
| `OPENAI_API_KEY` | All LLM calls | yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client for curated tools | yes |
| `DATABASE_URL_READONLY` | `run_readonly_sql` only | **new** |

## 9. Migrations

Three new Supabase migrations:

1. `20260416_ask_ai_logs.sql` — creates `ask_ai_logs` table + indexes.
2. `20260416_ask_ai_readonly_role.sql` — creates `ask_ai_readonly` role and grants.
3. `20260416_ask_ai_execute_fn.sql` — creates the `ask_ai_execute` function.

## 10. Out of Scope

Deferred to later work, explicitly *not* part of this design:

- Vector RAG / embeddings / `search_documents` tool — added when unstructured data actually arrives.
- Streaming the final answer via SSE — the agent loop supports it but the UI change is separate.
- Multi-turn conversations (the current page shows one answer per question; no history replay to the model).
- Auto-send on speech-to-text silence detection — separate UX task the user flagged.
- Savable / shareable questions — the "Saved (0)" tab in the UI is an existing surface; no backend changes planned here.

## 11. Open Questions

None blocking implementation. Items to validate during implementation:

- Whether `gpt-4o-mini` routes tools accurately enough, or whether `gpt-4o` is needed for the tool-selection step only. Measure: percentage of questions answered correctly across a held-out evaluation set. Swap model if needed.
- Exact SQL shape for `check_compliance` rule logic — needs review against edge cases (partial weeks at range boundaries, holidays, leave days).

## 12. Success Criteria

- `/api/ask` handles the five example questions from brainstorming, plus 5-10 additional HR-analytics questions, correctly against the production 1000-employee dataset.
- No request ships more than 10KB of data to the model per tool result.
- No request uses more than 8000 total OpenAI tokens.
- Every request is logged to `ask_ai_logs` with tool trace.
- The SQL escape hatch cannot write, cannot read unauthorized tables, cannot DoS the database, and cannot execute multi-statement queries — verified by negative tests.
- Relevance guard still rejects non-HR questions (regression check against current behavior).

## 13. Follow-up Work

Each item is deferred from §10, not discarded. Listed roughly in recommended sequence, each a candidate for its own brainstorm → spec → plan cycle.

### 13.1 STT auto-send on silence detection

- **Trigger:** as soon as client UX feedback warrants it (user already flagged this).
- **Scope:** frontend-only tweak to [src/app/dashboard/ask/page.tsx](../../../src/app/dashboard/ask/page.tsx). Detect silence in the Web Speech API stream (or fixed timeout after last transcript update) and auto-submit.
- **Dependencies:** none. Does not touch `/api/ask`.
- **Rough effort:** 1-2 hours.

### 13.2 Answer streaming (Server-Sent Events)

- **Trigger:** when users notice latency (multi-tool questions can take 3-8s with a visible spinner only).
- **Scope:** change `/api/ask` route handler to return a streaming response; update the client to render tokens as they arrive. The agent loop in [src/lib/ask/agent.ts](../../../src/lib/ask/agent.ts) is already compatible.
- **Dependencies:** this spec shipped.
- **Rough effort:** half a day.

### 13.3 Savable / shareable questions

- **Trigger:** when clients start asking for this — the "Saved (0)" tab already exists in the UI.
- **Scope:** new table `ask_ai_saved_questions`, CRUD endpoints, UI wiring. Should share the `ask_ai_logs` row as its source so saving is just "pin this log row."
- **Dependencies:** this spec shipped (needs `ask_ai_logs` table to exist).
- **Rough effort:** 1 day.

### 13.4 Vector RAG / `search_documents` tool

- **Trigger:** when the client actually starts providing unstructured data (policy PDFs, free-text comments in attendance records, HR notes, emails). Do not build on speculation.
- **Scope:** new migration for a pgvector-backed `documents` table, an ingestion pipeline (PDF/text → chunks → embeddings), a new `search_documents` tool file in [src/lib/ask/tools/](../../../src/lib/ask/tools/), and one line in `tools/index.ts` to register it.
- **Dependencies:** this spec shipped. Requires deciding on embedding model (`text-embedding-3-small` is the current default choice), chunk strategy, and ingestion triggers.
- **Rough effort:** 3-5 days for the minimum viable version.
- **Note:** the agent loop deliberately makes this additive — no existing tool, the loop itself, or the safety model needs to change.

### 13.5 Multi-turn conversations

- **Trigger:** when users request follow-up questions ("drill into that", "what about last quarter instead").
- **Scope:** significant. Requires decisions on: how much history to replay to the model (token cost grows), how to detect topic switches, whether to persist conversations in the DB, whether the UI surfaces past turns or starts fresh each time.
- **Dependencies:** this spec shipped.
- **Rough effort:** 3-5 days including UX work. Deserves its own full brainstorm — the design decisions above are non-trivial.
