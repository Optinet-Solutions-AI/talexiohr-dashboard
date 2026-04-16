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
        try {
          const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(line))
        } catch {
          // Controller is already closed (client disconnected or finally-close
          // already ran). Drop the event silently — nothing is listening.
        }
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
