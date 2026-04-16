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
