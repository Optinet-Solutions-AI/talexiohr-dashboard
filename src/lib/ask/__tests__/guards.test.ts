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
