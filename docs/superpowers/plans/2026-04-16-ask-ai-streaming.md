# Ask AI Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current silent 3-4 second wait on `/api/ask` with a live Server-Sent Events stream that shows tool-call progress messages and streams the final answer token-by-token, preserving the existing non-streaming JSON response shape on the `done` event.

**Architecture:** The agent loop gains an optional `onEvent` callback and switches every OpenAI call to `stream: true`, accumulating tool-call deltas as they arrive. The route handler returns a `ReadableStream` SSE body for accepted questions (and keeps the existing JSON response for relevance-rejected ones). The client detects response type by `Content-Type`, parses the SSE stream with a small async-generator, and updates an in-progress answer card as events arrive.

**Tech Stack:** Next.js 16.2.3 route handlers, OpenAI SDK v6 (`stream: true` chat completions with tool-call delta accumulation), React 19 client component, native `ReadableStream` / `TextEncoder` / `TextDecoder`.

**Reference spec:** [docs/superpowers/specs/2026-04-16-ask-ai-streaming-design.md](../specs/2026-04-16-ask-ai-streaming-design.md)

---

## File Structure

**New:**
- `src/lib/ask/statusMessages.ts` — tool-name → user-facing string map
- `src/lib/ask/context.ts` — `buildContextFromToolCalls` helper (extracted from route)
- `src/lib/ask/client/parseSse.ts` — client-side async-generator SSE parser
- `src/lib/ask/__tests__/statusMessages.test.ts`
- `src/lib/ask/__tests__/context.test.ts`
- `src/lib/ask/__tests__/parseSse.test.ts`

**Modified:**
- `src/lib/ask/agent.ts` — add `onEvent` param, switch calls to streaming, accumulate tool-call deltas
- `src/lib/ask/__tests__/agent.test.ts` — update mocks to produce async-iterable streams, add one new streaming-event test
- `src/app/api/ask/route.ts` — add `ReadableStream` SSE response path for accepted questions
- `src/components/ask/AskSearch.tsx` — branch on Content-Type, consume SSE events, show status text

---

## Task 1: `statusMessages` tool-name → string map

Pure function plus test. No dependencies. Quickest task first.

**Files:**
- Create: `src/lib/ask/statusMessages.ts`
- Create: `src/lib/ask/__tests__/statusMessages.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/ask/__tests__/statusMessages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { statusMessageForTool } from '../statusMessages'

describe('statusMessageForTool', () => {
  it('maps each curated tool to a friendly message', () => {
    expect(statusMessageForTool('list_employees')).toBe('Looking up employees...')
    expect(statusMessageForTool('query_attendance')).toBe('Analyzing attendance...')
    expect(statusMessageForTool('list_on_status')).toBe("Checking today's status...")
    expect(statusMessageForTool('check_compliance')).toBe('Checking compliance rules...')
    expect(statusMessageForTool('run_readonly_sql')).toBe('Running custom analysis...')
  })

  it('falls back to a generic message for unknown tools', () => {
    expect(statusMessageForTool('future_unknown_tool')).toBe('Working...')
    expect(statusMessageForTool('')).toBe('Working...')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- statusMessages`
Expected: fail with module not found.

- [ ] **Step 3: Implement**

Create `src/lib/ask/statusMessages.ts`:

```ts
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

- [ ] **Step 4: Run test**

Run: `npm test -- statusMessages`
Expected: 2 passed.

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ask/statusMessages.ts src/lib/ask/__tests__/statusMessages.test.ts
git commit -m "feat(ask): add tool-name to user-facing status message map"
```

---

## Task 2: Extract `buildContextFromToolCalls` helper

The route handler today computes `context` (employeeCount, recordCount, dateRange) inline. Streaming needs this same logic in two places — the JSON refusal path and the SSE `done` event — so it moves into a helper.

**Files:**
- Create: `src/lib/ask/context.ts`
- Create: `src/lib/ask/__tests__/context.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/ask/__tests__/context.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildContextFromToolCalls } from '../context'
import type { ToolCallRecord } from '../types'

function tc(tool: string, rowCount: number | null, args: unknown = {}): ToolCallRecord {
  return { tool, args, rowCount, durationMs: 0, truncated: false }
}

describe('buildContextFromToolCalls', () => {
  it('returns empty context when no tool calls', () => {
    expect(buildContextFromToolCalls([])).toEqual({
      dateRange: { from: '', to: '' },
      employeeCount: 0,
      recordCount: 0,
    })
  })

  it('picks employeeCount from list_employees', () => {
    const out = buildContextFromToolCalls([tc('list_employees', 37)])
    expect(out.employeeCount).toBe(37)
  })

  it('picks employeeCount from check_compliance too', () => {
    const out = buildContextFromToolCalls([tc('check_compliance', 12)])
    expect(out.employeeCount).toBe(12)
  })

  it('takes the max employeeCount across tools', () => {
    const out = buildContextFromToolCalls([
      tc('list_employees', 37),
      tc('check_compliance', 12),
    ])
    expect(out.employeeCount).toBe(37)
  })

  it('picks recordCount from query_attendance', () => {
    const out = buildContextFromToolCalls([tc('query_attendance', 588)])
    expect(out.recordCount).toBe(588)
  })

  it('extracts date range from query_attendance args', () => {
    const out = buildContextFromToolCalls([
      tc('query_attendance', 10, { from: '2026-04-01', to: '2026-04-16' }),
    ])
    expect(out.dateRange).toEqual({ from: '2026-04-01', to: '2026-04-16' })
  })

  it('handles query_attendance with missing args gracefully', () => {
    const out = buildContextFromToolCalls([tc('query_attendance', 5, null)])
    expect(out.dateRange).toEqual({ from: '', to: '' })
  })

  it('treats null rowCount as 0', () => {
    const out = buildContextFromToolCalls([tc('list_employees', null)])
    expect(out.employeeCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- context`
Expected: fail with module not found.

- [ ] **Step 3: Implement**

Create `src/lib/ask/context.ts`:

```ts
import type { ToolCallRecord } from './types'

export type AskContext = {
  dateRange: { from: string; to: string }
  employeeCount: number
  recordCount: number
}

export function buildContextFromToolCalls(toolCalls: ToolCallRecord[]): AskContext {
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

- [ ] **Step 4: Run test**

Run: `npm test -- context`
Expected: 8 passed.

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ask/context.ts src/lib/ask/__tests__/context.test.ts
git commit -m "feat(ask): extract buildContextFromToolCalls helper"
```

---

## Task 3: Agent loop — switch to streaming, add `onEvent` callback

Biggest task. The agent loop currently uses non-streaming `openai.chat.completions.create({...})`. It switches to `stream: true` for every iteration. For iterations where the model responds with tool calls, the loop accumulates tool-call deltas into complete tool calls, then runs them. For iterations where the model responds with content, the loop forwards each text delta through `onEvent({ type: 'token', delta })`.

Backward compatibility: `onEvent` is optional. Callers that omit it — including the existing four agent tests — see identical behavior as before (the non-streaming path was semantically equivalent to "stream and reassemble").

**Files:**
- Modify: `src/lib/ask/agent.ts`
- Modify: `src/lib/ask/__tests__/agent.test.ts`

- [ ] **Step 1: Replace the existing agent test file**

The existing tests mock OpenAI with non-streaming response objects. Since the agent will always call with `stream: true`, those mocks must produce async iterables instead. Replace the full content of `src/lib/ask/__tests__/agent.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../tools', () => ({
  TOOL_DEFINITIONS: [],
  getAvailableToolDefinitions: () => [],
  executeTool: vi.fn(),
}))

import { runAgent, MAX_ITERATIONS, MAX_TOOL_RESULT_BYTES, type AgentEvent } from '../agent'
import { executeTool } from '../tools'

type FakeChunk = {
  choices: Array<{
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: 'stop' | 'tool_calls' | null
  }>
  usage?: { total_tokens: number }
}

// Build a content-only streaming response as an async iterable
function contentStream(text: string, tokens?: number): AsyncIterable<FakeChunk> {
  const parts = text.match(/.{1,4}/g) ?? [text]
  const chunks: FakeChunk[] = parts.map((p, i) => ({
    choices: [{ delta: { content: p }, finish_reason: i === parts.length - 1 ? 'stop' : null }],
  }))
  // Final usage chunk
  chunks.push({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: tokens ?? 100 } })
  return (async function* () { for (const c of chunks) yield c })()
}

// Build a tool-call streaming response
function toolCallStream(calls: Array<{ id: string; name: string; args: string }>, tokens = 50): AsyncIterable<FakeChunk> {
  const chunks: FakeChunk[] = []
  // Emit each tool call's id/name on first chunk for that index, then stream the args
  for (const [i, c] of calls.entries()) {
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] }, finish_reason: null }] })
    // Split args into ~4-char fragments
    const fragments = c.args.match(/.{1,4}/g) ?? [c.args]
    for (const f of fragments) {
      chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: f } }] }, finish_reason: null }] })
    }
  }
  chunks.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { total_tokens: tokens } })
  return (async function* () { for (const c of chunks) yield c })()
}

function makeOpenAI(streams: AsyncIterable<FakeChunk>[]) {
  let i = 0
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => streams[i++]),
      },
    },
  }
}

describe('runAgent (streaming-based)', () => {
  it('returns immediately when the model responds with text only', async () => {
    const openai = makeOpenAI([contentStream('Hello world')])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Hello world')
    expect(res.toolCalls).toHaveLength(0)
  })

  it('executes tool calls and loops until a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: { rows: [{ x: 1 }] }, rowCount: 1 })
    const openai = makeOpenAI([
      toolCallStream([{ id: 't1', name: 'query_attendance', args: '{}' }]),
      contentStream('Final'),
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.answer).toBe('Final')
    expect(res.toolCalls).toHaveLength(1)
    expect(res.toolCalls[0].tool).toBe('query_attendance')
  })

  it('throws when the iteration cap is hit without a final answer', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: {}, rowCount: 0 })
    const streams = Array.from({ length: MAX_ITERATIONS + 1 }, (_, i) =>
      toolCallStream([{ id: `t${i}`, name: 'list_employees', args: '{}' }]),
    )
    const openai = makeOpenAI(streams)
    const supabase = {} as never
    await expect(runAgent({ question: 'q', openai: openai as never, supabase })).rejects.toThrow(/iteration cap/i)
  })

  it('truncates tool results larger than the cap', async () => {
    const big = { huge: 'x'.repeat(MAX_TOOL_RESULT_BYTES + 1000) }
    vi.mocked(executeTool).mockResolvedValue({ result: big, rowCount: 1 })
    const openai = makeOpenAI([
      toolCallStream([{ id: 't1', name: 'run_readonly_sql', args: '{}' }]),
      contentStream('done'),
    ])
    const supabase = {} as never
    const res = await runAgent({ question: 'q', openai: openai as never, supabase })
    expect(res.toolCalls[0].truncated).toBe(true)
  })

  it('emits onEvent status events for each iteration and tool call', async () => {
    vi.mocked(executeTool).mockResolvedValue({ result: {}, rowCount: 0 })
    const events: AgentEvent[] = []
    const openai = makeOpenAI([
      toolCallStream([{ id: 't1', name: 'query_attendance', args: '{}' }]),
      contentStream('Done'),
    ])
    await runAgent({
      question: 'q',
      openai: openai as never,
      supabase: {} as never,
      onEvent: (e) => events.push(e),
    })
    const statuses = events.filter(e => e.type === 'status')
    expect(statuses.length).toBeGreaterThanOrEqual(3) // agent_call, tool_call, agent_call
    const toolCallStatus = statuses.find(s => s.stage === 'tool_call')
    expect(toolCallStatus?.message).toBe('Analyzing attendance...')
  })

  it('emits onEvent token events as content streams', async () => {
    const events: AgentEvent[] = []
    const openai = makeOpenAI([contentStream('Hello there')])
    await runAgent({
      question: 'q',
      openai: openai as never,
      supabase: {} as never,
      onEvent: (e) => events.push(e),
    })
    const tokens = events.filter(e => e.type === 'token')
    expect(tokens.length).toBeGreaterThan(0)
    const assembled = tokens.map(t => (t as { type: 'token'; delta: string }).delta).join('')
    expect(assembled).toBe('Hello there')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- agent`
Expected: fail — module signature changes + AgentEvent not exported yet.

- [ ] **Step 3: Rewrite `src/lib/ask/agent.ts`**

Replace the file content with:

```ts
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { getAvailableToolDefinitions, executeTool } from './tools'
import { buildSystemPrompt } from './systemPrompt'
import { statusMessageForTool } from './statusMessages'
import type { AskResult, ToolCallRecord } from './types'

export const MAX_ITERATIONS = 5
export const MAX_TOKENS_PER_REQUEST = 8000
export const MAX_TOOL_RESULT_BYTES = 10 * 1024

export type AgentEvent =
  | { type: 'status'; stage: 'agent_call' | 'tool_call'; message?: string }
  | { type: 'token'; delta: string }

type AccumulatedToolCall = {
  index: number
  id: string
  name: string
  argsFragments: string[]
}

export async function runAgent(params: {
  question: string
  openai: OpenAI
  supabase: SupabaseClient
  onEvent?: (e: AgentEvent) => void
}): Promise<AskResult> {
  const { question, openai, supabase, onEvent } = params
  const started = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(today) },
    { role: 'user', content: question },
  ]
  const toolCalls: ToolCallRecord[] = []
  let totalTokens = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    onEvent?.({ type: 'status', stage: 'agent_call' })

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: getAvailableToolDefinitions(),
      tool_choice: 'auto',
      temperature: 0.2,
      stream: true,
    }) as AsyncIterable<{
      choices: Array<{
        delta: {
          content?: string | null
          tool_calls?: Array<{
            index: number
            id?: string
            type?: 'function'
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: 'stop' | 'tool_calls' | 'length' | null
      }>
      usage?: { total_tokens: number }
    }>

    let content = ''
    const accToolCalls = new Map<number, AccumulatedToolCall>()
    let finishReason: string | null | undefined = null

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (!delta) {
        if (chunk.usage) totalTokens += chunk.usage.total_tokens
        if (choice?.finish_reason) finishReason = choice.finish_reason
        continue
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content
        onEvent?.({ type: 'token', delta: delta.content })
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let entry = accToolCalls.get(tc.index)
          if (!entry) {
            entry = { index: tc.index, id: tc.id ?? '', name: tc.function?.name ?? '', argsFragments: [] }
            accToolCalls.set(tc.index, entry)
          }
          if (tc.id) entry.id = tc.id
          if (tc.function?.name) entry.name = tc.function.name
          if (tc.function?.arguments) entry.argsFragments.push(tc.function.arguments)
        }
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (chunk.usage) totalTokens += chunk.usage.total_tokens
    }

    if (totalTokens > MAX_TOKENS_PER_REQUEST) {
      throw new Error('Token budget exceeded')
    }

    // If no tool calls, this is the final iteration
    if (accToolCalls.size === 0) {
      return {
        answer: content,
        toolCalls,
        totalTokens,
        totalDurationMs: Date.now() - started,
      }
    }

    // Reassemble tool calls and push an assistant message
    const reassembled = [...accToolCalls.values()].sort((a, b) => a.index - b.index).map(e => ({
      id: e.id,
      type: 'function' as const,
      function: { name: e.name, arguments: e.argsFragments.join('') },
    }))

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: reassembled,
    } as ChatCompletionMessageParam)

    // Execute each tool
    for (const call of reassembled) {
      onEvent?.({ type: 'status', stage: 'tool_call', message: statusMessageForTool(call.function.name) })

      const t0 = Date.now()
      let record: ToolCallRecord
      let toolOutput: string
      try {
        const out = await executeTool(call.function.name, call.function.arguments, supabase)
        const serialized = JSON.stringify(out.result)
        const truncated = serialized.length > MAX_TOOL_RESULT_BYTES
        toolOutput = truncated ? serialized.slice(0, MAX_TOOL_RESULT_BYTES) + '"...(truncated)"' : serialized
        record = {
          tool: call.function.name,
          args: safeJson(call.function.arguments),
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
        content: toolOutput,
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
Expected: 6 passed.

Known gotcha: OpenAI SDK v6's `create()` with `{ stream: true }` returns a `Stream<ChatCompletionChunk>` object. In tests, we mock it as a plain `AsyncIterable`. The cast `as AsyncIterable<...>` in the production code is necessary because the inferred return type of `create({ stream: true })` in v6 is a class instance that *is* async-iterable but whose type signature doesn't expose that directly at the `await` return site. If tsc complains about the cast, you can instead use a two-step await + iterate pattern that avoids the cast:

```ts
const response = await openai.chat.completions.create({ ..., stream: true })
for await (const chunk of response as AsyncIterable<unknown>) { ... }
```

Pick whichever keeps tsc clean.

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run full suite — no regressions**

Run: `npm test`
Expected: 56 passed, 5 skipped.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ask/agent.ts src/lib/ask/__tests__/agent.test.ts
git commit -m "feat(ask): stream OpenAI responses with onEvent callback"
```

---

## Task 4: Client SSE parser

Async-generator that consumes a `Response` body and yields typed SSE events.

**Files:**
- Create: `src/lib/ask/client/parseSse.ts`
- Create: `src/lib/ask/__tests__/parseSse.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/ask/__tests__/parseSse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSseStream } from '../client/parseSse'

function makeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of iter) out.push(v)
  return out
}

describe('parseSseStream', () => {
  it('yields a single status event', async () => {
    const res = makeResponse([`event: status\ndata: {"stage":"agent_call"}\n\n`])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'status', stage: 'agent_call', message: undefined }])
  })

  it('yields multiple events from one chunk', async () => {
    const res = makeResponse([
      `event: status\ndata: {"stage":"tool_call","message":"Analyzing attendance..."}\n\n` +
      `event: token\ndata: {"delta":"Hi"}\n\n` +
      `event: done\ndata: {"answer":"Hi","toolCalls":[],"context":{"dateRange":{"from":"","to":""},"employeeCount":0,"recordCount":0},"timestamp":"t"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ type: 'status', stage: 'tool_call', message: 'Analyzing attendance...' })
    expect(events[1]).toEqual({ type: 'token', delta: 'Hi' })
    expect(events[2]).toMatchObject({ type: 'done' })
  })

  it('handles an event split across chunks', async () => {
    const res = makeResponse([
      `event: token\ndata: {"delta":`,
      `"Hello"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'token', delta: 'Hello' }])
  })

  it('skips malformed events silently', async () => {
    const res = makeResponse([
      `event: token\ndata: {not json}\n\n` +
      `event: token\ndata: {"delta":"ok"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'token', delta: 'ok' }])
  })

  it('skips unknown event types', async () => {
    const res = makeResponse([
      `event: heartbeat\ndata: {}\n\n` +
      `event: token\ndata: {"delta":"x"}\n\n`,
    ])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'token', delta: 'x' }])
  })

  it('yields an error event', async () => {
    const res = makeResponse([`event: error\ndata: {"message":"oops"}\n\n`])
    const events = await collect(parseSseStream(res))
    expect(events).toEqual([{ type: 'error', message: 'oops' }])
  })

  it('throws when response has no body', async () => {
    const res = new Response(null, { status: 500 })
    await expect(collect(parseSseStream(res))).rejects.toThrow(/body/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- parseSse`
Expected: fail with module not found.

- [ ] **Step 3: Implement**

Create `src/lib/ask/client/parseSse.ts`:

```ts
import type { ToolCallRecord } from '../types'
import type { AskContext } from '../context'

export type AskDonePayload = {
  answer: string
  toolCalls: ToolCallRecord[]
  context: AskContext
  timestamp: string
}

export type SseEvent =
  | { type: 'status'; stage: string; message?: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; payload: AskDonePayload }
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

    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const parsed = parseOneEvent(raw)
      if (parsed) yield parsed
    }
  }

  // Flush any remaining buffered event (no trailing blank line)
  if (buf.trim().length > 0) {
    const parsed = parseOneEvent(buf)
    if (parsed) yield parsed
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
    if (event === 'done')  return { type: 'done', payload: data }
    if (event === 'error') return { type: 'error', message: data.message }
  } catch { /* skip malformed */ }
  return null
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- parseSse`
Expected: 7 passed.

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ask/client/parseSse.ts src/lib/ask/__tests__/parseSse.test.ts
git commit -m "feat(ask): add client-side SSE stream parser"
```

---

## Task 5: Route handler — SSE response for accepted questions

The route now returns either a JSON response (for refusals and rate limits) or a `ReadableStream` SSE body (for accepted questions). Relevance-refusal path and rate-limit path stay JSON. Agent path becomes SSE.

**Files:**
- Modify: `src/app/api/ask/route.ts`

- [ ] **Step 1: Replace the file content**

Replace the full content of `src/app/api/ask/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { runAgent } from '@/lib/ask/agent'
import { validateInput, isRelevant, checkRateLimit } from '@/lib/ask/guards'
import { writeLog } from '@/lib/ask/logging'
import { buildContextFromToolCalls } from '@/lib/ask/context'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const started = Date.now()
  const supabase = createAdminClient()
  // TODO: re-enable the auth gate once login/signup are restored.
  // While auth is disabled project-wide, fall back to anonymous and skip the
  // per-user rate limit. Do NOT deploy to a public URL in this state.
  let userId: string | null = null
  try {
    const authed = await createServerClient()
    const { data: { user } } = await authed.auth.getUser()
    userId = user?.id ?? null
  } catch { /* anonymous ok while auth is disabled */ }

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

  // Accepted question: stream the agent's progress and answer.
  const stream = new ReadableStream<Uint8Array>({
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
            if (e.type === 'status') {
              const payload: Record<string, unknown> = { stage: e.stage }
              if (e.message) payload.message = e.message
              send('status', payload)
            } else if (e.type === 'token') {
              send('token', { delta: e.delta })
            }
          },
        })

        send('done', {
          answer: result.answer,
          toolCalls: result.toolCalls,
          context: buildContextFromToolCalls(result.toolCalls),
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
        console.error('[ask]', err)
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
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Write an integration test for SSE framing**

Spec §6.1 calls for a route-handler test that verifies SSE text framing with a mock agent. Create `src/app/api/ask/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@/lib/ask/guards', () => ({
  validateInput: () => ({ ok: true }),
  isRelevant: async () => true,
  checkRateLimit: async () => ({ allowed: true }),
  RATE_LIMIT_PER_HOUR: 30,
  QUESTION_CHAR_LIMIT: 500,
}))
vi.mock('@/lib/ask/logging', () => ({ writeLog: async () => {} }))
vi.mock('@/lib/ask/agent', () => ({
  runAgent: async ({ onEvent }: { onEvent?: (e: { type: 'status' | 'token'; stage?: string; message?: string; delta?: string }) => void }) => {
    onEvent?.({ type: 'status', stage: 'agent_call' })
    onEvent?.({ type: 'status', stage: 'tool_call', message: 'Analyzing attendance...' })
    onEvent?.({ type: 'token', delta: 'Hello ' })
    onEvent?.({ type: 'token', delta: 'world' })
    return {
      answer: 'Hello world',
      toolCalls: [{ tool: 'query_attendance', args: { from: '2026-04-01', to: '2026-04-16' }, rowCount: 5, durationMs: 100, truncated: false }],
      totalTokens: 150,
      totalDurationMs: 800,
    }
  },
}))

import { POST } from '../route'

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

describe('POST /api/ask SSE framing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns text/event-stream for accepted questions', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('emits status, token, and done events in order', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)

    // Find each event's starting position and assert ordering
    const firstStatus = text.indexOf('event: status')
    const firstToken  = text.indexOf('event: token')
    const done        = text.indexOf('event: done')

    expect(firstStatus).toBeGreaterThanOrEqual(0)
    expect(firstToken).toBeGreaterThan(firstStatus)
    expect(done).toBeGreaterThan(firstToken)
  })

  it('includes the mock tool_call status message', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)
    expect(text).toContain('"message":"Analyzing attendance..."')
  })

  it('emits deltas from the mock onEvent token events', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)
    expect(text).toContain('"delta":"Hello "')
    expect(text).toContain('"delta":"world"')
  })

  it('done payload carries the full context', async () => {
    const res = await POST(makeReq({ question: 'Who is on leave today?' }) as never)
    const text = await readStream(res)
    expect(text).toContain('"answer":"Hello world"')
    expect(text).toContain('"recordCount":5')
    expect(text).toContain('"from":"2026-04-01"')
  })
})
```

- [ ] **Step 4: Run the route integration tests**

Run: `npm test -- route`
Expected: 5 passed.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: 61 passed, 5 skipped. All pre-existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ask/route.ts src/app/api/ask/__tests__/route.test.ts
git commit -m "feat(ask): stream agent responses via SSE from /api/ask"
```

---

## Task 6: Ask Search component — consume SSE stream

Modify `src/components/ask/AskSearch.tsx` to branch on `Content-Type` and consume the SSE stream. Add in-progress state so the answer card shows live status and streaming tokens.

**Files:**
- Modify: `src/components/ask/AskSearch.tsx`

- [ ] **Step 1: Read the current file in full**

Read `src/components/ask/AskSearch.tsx` from top to bottom before editing. The existing `handleAsk` function (around line 75-121) is what changes; the rest of the component (render markup, voice input, save/delete, localStorage persistence) is untouched.

- [ ] **Step 2: Update the `Answer` type and add streaming state**

In `src/components/ask/AskSearch.tsx`, the existing `Answer` interface at the top of the file:

```ts
interface Answer {
  id: string
  question: string
  answer: string
  context: { dateRange: { from: string; to: string }; employeeCount: number; recordCount: number }
  timestamp: string
  saved: boolean
}
```

Extend it with two optional streaming-state fields:

```ts
interface Answer {
  id: string
  question: string
  answer: string
  context: { dateRange: { from: string; to: string }; employeeCount: number; recordCount: number }
  timestamp: string
  saved: boolean
  status?: string       // live status message while streaming; removed on done
  streaming?: boolean   // true while events are still arriving
  errored?: boolean     // true if the stream ended with an error event
}
```

- [ ] **Step 3: Replace `handleAsk` with the streaming version**

Find the existing `async function handleAsk(question?: string) { ... }` block (starts near line 75) and replace it entirely with:

```ts
  async function handleAsk(question?: string) {
    const q = (question ?? query).trim()
    if (!q) return
    if (q.length > 500) { alert('Question is too long (max 500 characters)'); return }

    const cardId = generateId()
    const nowIso = new Date().toISOString()

    // Optimistically add an in-progress card at the top of the list
    setAnswers(prev => [{
      id: cardId,
      question: q,
      answer: '',
      context: { dateRange: { from: '', to: '' }, employeeCount: 0, recordCount: 0 },
      timestamp: nowIso,
      saved: false,
      status: 'Thinking...',
      streaming: true,
    }, ...prev])
    if (!question) setQuery('')
    setLoading(true)

    const updateCard = (patch: Partial<Answer>) => {
      setAnswers(prev => prev.map(a => a.id === cardId ? { ...a, ...patch } : a))
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000) // 60s timeout for streamed answers

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      })

      const contentType = res.headers.get('content-type') ?? ''

      if (!contentType.includes('text/event-stream')) {
        // JSON path: relevance refusal, rate limit, or other error
        clearTimeout(timeout)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to get answer')
        updateCard({
          answer: data.answer,
          context: data.context,
          timestamp: data.timestamp,
          status: undefined,
          streaming: false,
        })
        return
      }

      // SSE path
      const { parseSseStream } = await import('@/lib/ask/client/parseSse')
      for await (const event of parseSseStream(res)) {
        if (event.type === 'status') {
          updateCard({ status: event.message ?? 'Thinking...' })
        } else if (event.type === 'token') {
          setAnswers(prev => prev.map(a => a.id === cardId ? { ...a, answer: a.answer + event.delta } : a))
        } else if (event.type === 'done') {
          updateCard({
            answer: event.payload.answer,
            context: event.payload.context,
            timestamp: event.payload.timestamp,
            status: undefined,
            streaming: false,
          })
        } else if (event.type === 'error') {
          updateCard({
            status: undefined,
            streaming: false,
            errored: true,
            answer: (event.message ? `Error: ${event.message}` : 'Error while generating answer'),
          })
        }
      }
      clearTimeout(timeout)
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError'
      const errMsg = isTimeout
        ? 'The query took too long (over 60 seconds). Try a simpler question — for example, ask about a specific employee or a shorter date range instead of "all employees for the whole year".'
        : `Error: ${err instanceof Error ? err.message : 'Failed to get answer'}`
      updateCard({ status: undefined, streaming: false, errored: true, answer: errMsg })
    } finally {
      setLoading(false)
    }
  }
```

Three important behaviors:
- The card is inserted optimistically at the top of the list on submit, so the UI feels instant.
- Each `token` event appends its `delta` via a functional `setAnswers` update. This is critical: using `updateCard({ answer: a.answer + delta })` inside a closure captures stale state across a fast burst of tokens.
- `parseSseStream` is dynamically imported so the client bundle only loads the parser when `handleAsk` is first called.

- [ ] **Step 4: Update card rendering to show streaming status**

Find the rendering of each answer card inside the `displayed.map(a => ...)` block. Two places need small additions:

(a) Just before the `{/* Answer */}` section, after the question/timestamp header, add a status row that only shows while streaming:

```tsx
            {a.streaming && a.status && (
              <div className="px-4 py-1.5 border-b border-slate-100 bg-indigo-50/40 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-indigo-500" />
                <span className="text-[11px] text-indigo-700">{a.status}</span>
              </div>
            )}
```

(b) Change the answer section to show a cursor-like trailing indicator while streaming. Find:

```tsx
            {/* Answer */}
            <div className="px-4 py-3">
              <div className="prose prose-sm prose-slate max-w-none text-xs leading-relaxed [&_strong]:text-slate-800 [&_li]:my-0.5 [&_p]:my-1 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:bg-slate-50 [&_th]:text-slate-600 [&_table]:border [&_th]:border [&_td]:border [&_table]:border-slate-200"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(a.answer) }} />
            </div>
```

Replace with:

```tsx
            {/* Answer */}
            <div className="px-4 py-3">
              {a.answer ? (
                <div className="prose prose-sm prose-slate max-w-none text-xs leading-relaxed [&_strong]:text-slate-800 [&_li]:my-0.5 [&_p]:my-1 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:bg-slate-50 [&_th]:text-slate-600 [&_table]:border [&_th]:border [&_td]:border [&_table]:border-slate-200"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(a.answer) }} />
              ) : (
                a.streaming && <div className="text-xs text-slate-400">Waiting for the first token...</div>
              )}
            </div>
```

(c) The existing loading indicator (the separate "Analyzing your HR data..." div at around line 225) is now redundant because each card shows its own status. Remove that block — delete:

```tsx
      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 text-center">
          <Loader2 size={20} className="animate-spin text-indigo-500 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Analyzing your HR data...</p>
        </div>
      )}
```

- [ ] **Step 5: Verify `loading` state still controls the input button**

The search-input button uses `loading` to disable itself and show a spinner. That stays — `loading` is still set to `true` during the streaming phase (line `setLoading(true)` above the try/catch) and reset to `false` in the `finally` block. No change needed to the button markup.

- [ ] **Step 6: Ensure `persistSaved` still works**

Saved cards are written to localStorage via `persistSaved(updated)` whenever a card is toggled. The new streaming-state fields (`status`, `streaming`, `errored`) are optional and are reset to `undefined` once streaming ends, so saved cards don't carry orphaned status text. Verify no change needed — `persistSaved` filters by `a.saved` and writes the whole object, which includes the unset optional fields as undefined (they're stripped by `JSON.stringify`). No edit needed.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no new errors introduced by this change.

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: 56 passed, 5 skipped. (No new unit tests for this component — manual E2E in Task 7 is the verification path.)

- [ ] **Step 10: Commit**

```bash
git add src/components/ask/AskSearch.tsx
git commit -m "feat(ask): consume SSE stream in AskSearch component"
```

---

## Task 7: Manual E2E verification

Not automated. Run through the streaming flow in a browser and confirm each expected behavior.

- [ ] **Step 1: Start the dev server fresh**

Stop the previous `npm run dev` (if running), then:
```bash
npm run dev
```

Open http://localhost:3000/dashboard/ask.

- [ ] **Step 2: Verify the five canonical questions**

For each of these, confirm:

1. Within ~500ms of submitting, a card appears with a status indicator (spinner + text).
2. The status text changes at least once (e.g. "Thinking..." → "Analyzing attendance..." → streaming answer).
3. Answer tokens arrive progressively, not as a single dump.
4. When streaming completes, the status row disappears and the footer shows real counts.

Questions:

- `Who has the most office days this month?`
- `Who is on leave today?`
- `Show me the top 5 employees by attendance`
- `Compare average hours worked between Unit A and Unit B over the last quarter` (substitute real unit names from the DB)
- `Which Malta office employees broke the 4-day rule this month?`

- [ ] **Step 3: Verify the refusal path is still non-streamed**

Ask: `Who is Donald Trump?`

Open DevTools → Network → click the `/api/ask` request. Confirm:
- Response `Content-Type` is `application/json` (NOT `text/event-stream`).
- The response shows the canned refusal immediately, without any status row.

- [ ] **Step 4: Verify error handling**

Temporarily force an agent error by editing `src/lib/ask/agent.ts` and setting `export const MAX_ITERATIONS = 1`. Restart dev server. Ask any question that requires a tool call (e.g. `Who has the most office days this month?`).

Confirm:
- Status events still appear.
- After a brief moment, the card shows an error message (`Error: Agent iteration cap reached without final answer`).
- Save/Retry/Delete buttons on the card still work.

**Restore MAX_ITERATIONS to 5** when done. Commit nothing.

- [ ] **Step 5: Verify the Saved tab still works**

Ask a question, let it complete, click the bookmark icon on the card. Switch to the `Saved` tab. The card should appear there with the correct answer, context, and timestamp — no leftover streaming artifacts.

Reload the page. The Saved tab should still contain the card (persisted via localStorage).

- [ ] **Step 6: Check `ask_ai_logs`**

In Supabase SQL editor:

```sql
SELECT created_at, question, relevance_passed,
       jsonb_array_length(tool_calls) AS tool_count,
       total_tokens, total_duration_ms, error
FROM ask_ai_logs
ORDER BY created_at DESC
LIMIT 10;
```

Confirm:
- Every question you asked appears exactly once.
- `tool_count` > 0 for the HR questions, `NULL` or `0` for the Donald Trump refusal row.
- `total_tokens` is populated for streamed successes.
- `error` is NULL for successful rows.

- [ ] **Step 7: No commit for this task**

Task is verification-only. If any assertion fails, open a focused debug loop rather than committing a workaround.

---

## Summary

Seven tasks:
- 1-2: Small helper modules (status map, context helper) with TDD
- 3: Agent loop streaming rewrite (biggest task)
- 4: Client-side SSE parser with TDD
- 5: Route handler SSE response path
- 6: Ask Search component updates to consume the stream
- 7: Manual E2E verification

Total new files: 6 (3 impl + 3 tests). Total modified files: 3 (agent, route, AskSearch).
