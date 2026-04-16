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
