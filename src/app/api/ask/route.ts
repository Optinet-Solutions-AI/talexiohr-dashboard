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
  let userId: string
  try {
    const authed = await createServerClient()
    const { data: { user }, error } = await authed.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    userId = user.id
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

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
