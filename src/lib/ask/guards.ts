import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  const res = await supabase
    .from('ask_ai_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('created_at', oneHourAgo)

  if (res.error) throw new Error(`Rate limit check failed: ${res.error.message}`)
  if (res.count === null) throw new Error('Rate limit check returned null count')

  if (res.count >= RATE_LIMIT_PER_HOUR) {
    return { allowed: false, retryAfterSeconds: 3600 }
  }
  return { allowed: true }
}
