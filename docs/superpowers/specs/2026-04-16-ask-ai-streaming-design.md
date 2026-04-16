# Ask AI — Streaming Responses Design

**Date:** 2026-04-16
**Status:** Approved, ready for implementation plan
**Scope:** Add Server-Sent Events streaming to `/api/ask` so users see progress status messages and watch answer tokens render in real time, replacing the current 3-4 second silent wait with continuous feedback.
**Builds on:** [2026-04-16-ask-ai-tool-calling-design.md](./2026-04-16-ask-ai-tool-calling-design.md) — implements §13.2 from its follow-up work section.

## 1. Motivation

### 1.1 Current user experience

The tool-calling agent from the baseline spec answers questions correctly but makes the user wait in silence. A typical request takes ~3-4 seconds end-to-end:

- ~500ms relevance classifier call
- ~800ms first agent call (model selects a tool)
- ~200ms tool execution against Postgres
- ~500ms second agent call (model writes the answer from tool output)
- ~500ms network overhead and response assembly

The current route handler returns a single JSON response when the agent loop completes. Users see a submit action followed by 3-4 seconds of stillness, then the full answer appears at once.

### 1.2 Why this is a problem at scale

Two things make the silence more painful as the system grows:

- **Dataset size.** At the design target of 1000+ employees, tool calls individually slow down (more rows scanned, larger result sets returned even when aggregated) and complex compliance questions may need 3-4 agent iterations instead of 2.
- **Question complexity.** Comparative questions ("compare Q1 to Q2") and compliance drill-downs require multiple tool calls in series. A genuine 6-8 second wait in silence reads as "broken" to users regardless of why it actually takes that long.

### 1.3 What streaming fixes and does not fix

Streaming does not make the work faster — total wall-clock time is unchanged. It changes *perceived* latency by filling the silence with visible progress:

- **Status messages during tool calls** tell the user something is happening, which tools are running, and that the system is working on their specific question.
- **Token-by-token streaming of the final answer** means the first characters appear ~500-800ms before the full answer completes, which feels substantially faster because users begin reading while generation continues.

A future spec (§13.5 Multi-turn conversations, or a B-track "actual latency reduction" spec) could address total wall-clock time with caching and tool_choice optimization. This spec is deliberately scoped to perceived latency only.

## 2. Architecture

### 2.1 Two response modes from `/api/ask`

The route produces one of two response types depending on what the request needs:

- **Non-streaming JSON (existing shape).** Used when the relevance classifier rejects a question — there is nothing to stream because the refusal is a fixed canned message. The response preserves the current `{ answer, question, context, timestamp, filtered: true }` shape exactly. Zero client changes on this path.
- **Server-Sent Events stream.** Used for all accepted questions. `Content-Type: text/event-stream`. The client detects the mode by reading the response's `Content-Type` header.

### 2.2 Three SSE event types

```
event: status
data: {"stage":"agent_call"}

event: status
data: {"stage":"tool_call","message":"Analyzing attendance..."}

event: token
data: {"delta":"The employee "}

event: token
data: {"delta":"with the most "}

event: done
data: {
  "answer": "The employee with the most office days this month is Alice, with 12 office days.",
  "toolCalls": [...],
  "context": {...},
  "timestamp": "2026-04-16T14:30:00.000Z"
}
```

Plus one error variant emitted when the agent throws mid-stream:

```
event: error
data: {"message":"Agent iteration cap reached","stage":"agent_loop"}
```

### 2.3 Event type semantics

- **`status`** — progress signal. `stage` is an enum: `relevance_check`, `agent_call`, `tool_call`. `message` is a user-facing string, only present for `tool_call` events. The UI displays the message in a subtle status row above the answer card.
- **`token`** — delta from the final model response. The UI appends each delta to the answer text in place. Deltas are arbitrary substrings; the client must not assume token, word, or whitespace boundaries.
- **`done`** — terminal success event. Carries the full final payload in the exact shape the non-streaming response uses, so the UI reconstructs the familiar object on stream close. The Saved tab, history cards, and footer continue to consume this object unchanged.
- **`error`** — terminal failure event. Carries a short message and optional stage identifier. The UI displays the partial answer (if any streamed) plus an error note; the card is not saved.

### 2.4 Request/response flow

```
POST /api/ask { question }
  │
  ├─▶ relevance guard (unchanged)
  │     └─ reject? → non-streaming JSON with filtered:true, short-circuit
  │
  ├─▶ rate-limit check (unchanged)
  │     └─ over limit? → 429 JSON, short-circuit
  │
  └─▶ open SSE stream
        │
        ├─▶ emit status: relevance_check (already passed, useful marker)
        │
        ├─▶ agent loop
        │    ├─ emit status: agent_call (before OpenAI non-streaming turn)
        │    ├─ model selects tool → emit status: tool_call with friendly message
        │    ├─ run tool
        │    ├─ repeat until model produces final answer
        │    └─ final turn uses stream:true → emit token: delta per chunk
        │
        ├─▶ emit done: full payload
        │
        └─▶ write ask_ai_logs row, close stream
```

## 3. Server Implementation

### 3.1 Agent loop gains an optional event callback

The existing `runAgent(params)` function today returns `Promise<AskResult>`. The streaming version adds an optional `onEvent` callback.

```ts
// src/lib/ask/agent.ts
export type AgentEvent =
  | { type: 'status'; stage: 'relevance_check' | 'agent_call' | 'tool_call'; message?: string }
  | { type: 'token'; delta: string }

export async function runAgent(params: {
  question: string
  openai: OpenAI
  supabase: SupabaseClient
  onEvent?: (e: AgentEvent) => void
}): Promise<AskResult>
```

Key points:

- `onEvent` is optional. When omitted, `runAgent` behaves exactly as it does today — callers like existing unit tests do not need changes.
- The same function handles both cases. There is no separate `runAgentStreaming()`; the streaming decision is a runtime one, driven by whether the caller cares about progress events.
- During each agent iteration, the loop calls `onEvent` with a `status` event before invoking OpenAI and before each tool dispatch.
- On the iteration that produces the final answer (no tool calls in the model's response), the loop switches OpenAI's call to `stream: true` and forwards each delta through `onEvent({ type: 'token', delta })`.

### 3.2 Identifying the "final" iteration

The agent loop only knows an iteration is "final" retrospectively, once the model responds with content instead of tool calls. But we need to decide streaming-vs-non-streaming *before* making the call.

Two options:

- **Option A — Always stream.** Use `stream: true` on every OpenAI call. If the model's stream contains tool calls, reassemble them from the deltas and dispatch normally. If it contains content, forward deltas as `token` events live.
- **Option B — Conditional.** Use non-streaming for the first N-1 turns (where tool-call responses are expected), switch to streaming only when heuristics suggest the next turn will be the final one.

Option A is chosen. Reassembling tool calls from streaming deltas is supported by the OpenAI SDK's chat stream helpers and has minimal added complexity. Option B has ambiguous heuristics (what if the model does yet another tool call?) and introduces two code paths that must be kept in sync.

### 3.3 Tool-name to user-facing message mapping

The spec prohibits revealing tool names, SQL, or internals to users. Status events translate tool names to friendly strings via a single mapping:

```ts
// src/lib/ask/statusMessages.ts
const TOOL_STATUS_MESSAGES: Record<string, string> = {
  list_employees:    'Looking up employees...',
  query_attendance:  'Analyzing attendance...',
  list_on_status:    "Checking today's status...",
  check_compliance:  'Checking compliance rules...',
  run_readonly_sql:  'Running custom analysis...',
}

export function statusMessageForTool(tool: string): string {
  return TOOL_STATUS_MESSAGES[tool] ?? 'Working...'
}
```

Future tools (e.g. the deferred `search_documents`) add one entry to this map. No other code changes.

### 3.4 Route handler — ReadableStream-based SSE

Next.js route handlers support streaming by returning a `Response` whose body is a `ReadableStream`. The server side of the SSE protocol is simple text framing:

```ts
// src/app/api/ask/route.ts
const stream = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder()
    const send = (event: string, data: unknown) => {
      const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      controller.enqueue(encoder.encode(line))
    }

    try {
      const result = await runAgent({
        question, openai, supabase,
        onEvent: (e) => {
          if (e.type === 'status') send('status', { stage: e.stage, ...(e.message ? { message: e.message } : {}) })
          else if (e.type === 'token') send('token', { delta: e.delta })
        },
      })

      const context = buildContextFromToolCalls(result.toolCalls)
      send('done', {
        answer: result.answer,
        toolCalls: result.toolCalls,
        context,
        timestamp: new Date().toISOString(),
      })

      await writeLog(supabase, {
        userId, question, relevancePassed: true,
        toolCalls: result.toolCalls,
        finalAnswer: result.answer,
        totalTokens: result.totalTokens,
        totalDurationMs: result.totalDurationMs,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate answer'
      send('error', { message })
      await writeLog(supabase, {
        userId, question, relevancePassed: true,
        error: message, totalDurationMs: Date.now() - started,
      })
    } finally {
      controller.close()
    }
  },
})

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
})
```

`X-Accel-Buffering: no` is a defensive header for deployments behind nginx or similar reverse proxies. Vercel's edge doesn't require it but it costs nothing to include.

### 3.5 Factored context builder

The existing route handler derives the `context` field from `result.toolCalls` inline. With two response paths (JSON refusal and SSE) this logic gets reused. It moves into a small helper:

```ts
// src/lib/ask/context.ts
export function buildContextFromToolCalls(toolCalls: ToolCallRecord[]) {
  let employeeCount = 0
  let recordCount = 0
  let dateRange: { from: string; to: string } = { from: '', to: '' }
  for (const tc of toolCalls) {
    if (tc.tool === 'list_employees' || tc.tool === 'check_compliance') {
      employeeCount = Math.max(employeeCount, tc.rowCount ?? 0)
    }
    if (tc.tool === 'query_attendance') {
      recordCount = Math.max(recordCount, tc.rowCount ?? 0)
      const args = tc.args as { from?: string; to?: string } | null
      if (args?.from && args?.to) dateRange = { from: args.from, to: args.to }
    }
  }
  return { dateRange, employeeCount, recordCount }
}
```

## 4. Client Implementation

### 4.1 SSE stream parser

Browser `EventSource` only supports GET requests. The Ask AI page POSTs the question, so we use `fetch` plus a small async-generator parser for the SSE body:

```ts
// src/lib/ask/client/parseSse.ts
export type SseEvent =
  | { type: 'status'; stage: string; message?: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; payload: AskResponse }
  | { type: 'error'; message: string }

export async function* parseSseStream(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error('Response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // SSE events are separated by blank lines
    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const parsed = parseOneEvent(rawEvent)
      if (parsed) yield parsed
    }
  }
}

function parseOneEvent(raw: string): SseEvent | null {
  let event = 'message'
  let dataStr = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) dataStr += line.slice(6)
  }
  if (!dataStr) return null
  try {
    const data = JSON.parse(dataStr)
    if (event === 'status') return { type: 'status', stage: data.stage, message: data.message }
    if (event === 'token') return { type: 'token', delta: data.delta }
    if (event === 'done') return { type: 'done', payload: data }
    if (event === 'error') return { type: 'error', message: data.message }
  } catch { /* skip malformed */ }
  return null
}
```

This parser correctly handles:

- Partial chunks where a single event is split across multiple reads (the `\n\n` separator remains in the buffer until complete)
- Multiple events in a single chunk (the `while` loop drains all complete events)
- Unknown event types (returns null, skipped by caller)
- Malformed JSON (caught, event skipped)

### 4.2 Ask AI page submit handler

The existing submit flow calls `fetch('/api/ask')`, awaits JSON, and renders. The new flow branches on response type:

```ts
// src/app/dashboard/ask/page.tsx (submit handler sketch)
async function submitQuestion(question: string) {
  // Optimistic: add a pending card with empty answer
  const card = addPendingCard(question)

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })

    const contentType = res.headers.get('content-type') ?? ''

    if (!contentType.includes('text/event-stream')) {
      // Relevance refusal or rate-limit — existing JSON path
      const json = await res.json()
      finalizeCardWithJson(card, json, res.ok)
      return
    }

    for await (const event of parseSseStream(res)) {
      switch (event.type) {
        case 'status':
          setCardStatus(card, event.message ?? statusForStage(event.stage))
          break
        case 'token':
          appendToCardAnswer(card, event.delta)
          break
        case 'done':
          finalizeCard(card, event.payload)
          break
        case 'error':
          markCardError(card, event.message)
          break
      }
    }
  } catch (err) {
    markCardError(card, err instanceof Error ? err.message : 'Connection lost')
  }
}
```

### 4.3 UI state changes

The existing answer card has three visible states: idle, loading, answered. Two new states:

- **Streaming** — status row visible above the card with current stage message. Answer text fills in live.
- **Errored** — partial answer stays visible if any streamed. Error message shown below the partial answer. Save/Retry/Delete buttons enabled. Card does not go into the Saved history log automatically.

The pending card appears *immediately* on submit, before any event arrives, with status text like "Thinking...". First `status` event replaces that.

## 5. Error Handling

### 5.1 Mid-stream failures

| Failure | Where caught | User sees |
|---|---|---|
| Agent iteration cap reached | `runAgent` throws → route catches → sends `error` event | Partial answer (if any) + "Agent iteration cap reached" note |
| Token budget exceeded | `runAgent` throws → route catches → sends `error` event | Partial answer + "Token budget exceeded" note |
| Tool execution failure | Caught inside agent loop; logged in `toolCalls[].error`, execution continues. Only surfaces if it exhausts iterations. | Usually invisible; may manifest as degraded answer |
| OpenAI API error mid-stream | `runAgent` throws → route catches → sends `error` event | Partial answer + error message |
| Database connection loss | `runAgent` throws → route catches → sends `error` event | Partial answer + generic error |
| Network drops client-side | Client `fetch` reader throws | Partial answer + "Connection lost" |

### 5.2 Invariants

- The `error` event is terminal. No further events follow it.
- The `done` event is terminal on success. No further events follow it.
- Partial `token` deltas stream progressively and do not accumulate on the server — the client is the source of truth for the in-progress answer.
- The `ask_ai_logs` write happens in the route's `finally`-equivalent path regardless of success or error, mirroring the existing behavior.
- Client side: the card never auto-saves to Saved tab on error. User can manually save it via the existing Save button if they want.

### 5.3 Client abort not implemented here

A dedicated Cancel button would use `AbortController` to cut the fetch mid-stream. That is deliberately deferred — the Retry button already effectively replaces a stuck request, and no user feedback flagged cancellation as missing.

## 6. Testing

### 6.1 Unit tests

- **`agent.test.ts` (extended):** existing 4 tests stay. Add a test that passes an `onEvent` spy, uses a mock OpenAI returning a streaming-shaped response, and asserts the sequence of events (e.g. `[status agent_call, status tool_call "Analyzing attendance...", status agent_call, token "A", token "lice", ...]`).
- **`statusMessages.test.ts` (new):** verify tool name → message mapping, including unknown-tool fallback.
- **`context.test.ts` (new):** verify `buildContextFromToolCalls` correctly extracts employee/record counts and date ranges from assorted tool-call sequences.
- **`parseSse.test.ts` (new, client-side):** feed a mock `Response` with a chunked body containing split events, assert the yielded events. Include cases: partial chunk across read boundary, multiple events in one chunk, malformed data, unknown event type.
- **Route handler integration:** a test that calls the POST handler with a mock agent, reads the `ReadableStream` output, and asserts the SSE text matches expected framing.

### 6.2 Manual E2E

The five canonical questions from the baseline spec plus:

1. Every question shows at least one `status` event before any `token` event.
2. Answer tokens stream progressively (verify by watching DevTools Network → Response stream).
3. The final `done` event payload matches the previous non-streaming response shape exactly (employee count, record count, date range, toolCalls array).
4. The Donald Trump refusal still returns a non-streaming JSON response (verified via `Content-Type` header).
5. Forcing an agent failure (e.g. by temporarily lowering MAX_ITERATIONS to 1 in a dev branch) produces an `error` event and the UI preserves partial output.

## 7. Out of Scope

Deferred to later work:

- **Cancel button / AbortController wiring** — UX polish, separate task.
- **Multi-turn conversation** — §13.5 of the baseline spec.
- **Optimistic "submitted" state** with fake skeleton text before first event — pure UI polish.
- **Server-sent heartbeat comments** (`:\n\n` every 15 seconds) — only needed if connections idle behind aggressive proxies. Vercel doesn't require them.
- **Compression** — not useful on an SSE stream of small deltas; HTTP/2 already multiplexes efficiently.
- **Retrying partial streams after transient failure** — retry button re-submits fresh; no resume semantics.

## 8. Success Criteria

- For every accepted question, the UI displays status text within 500ms of submit and begins streaming answer tokens within 2 seconds of submit.
- The `done` event payload shape remains byte-identical to the current non-streaming JSON response for the same question, validated by a test that runs the agent once without `onEvent`, once with `onEvent`, and diffs the resulting payloads.
- The existing "Saved" tab, history rendering, and footer continue to work unchanged — no client code outside the ask page and the new SSE parser changes.
- Relevance refusal path remains non-streaming JSON (no regression).
- Total wall-clock latency for the five canonical questions is unchanged within ±20% (streaming should not accidentally make things slower).
- All existing 54 unit tests continue to pass; new tests add comprehensive coverage of parsing, event emission, and context builder.

## 9. Follow-Up Work

Not in this spec; called out so they do not get lost:

- Cancel button (small UX polish, 1-2 hours).
- Multi-turn conversations (§13.5, separate brainstorm required).
- True latency reduction via caching or prompt-level optimizations (the B-track from the streaming brainstorm discussion).
