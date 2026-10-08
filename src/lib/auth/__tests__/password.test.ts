import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  generateTemporaryPassword,
  validatePassword,
} from '../password'

describe('validatePassword', () => {
  it('accepts a password that meets every rule', () => {
    expect(validatePassword('Correct-Horse7!')).toEqual([])
  })

  it('reports each missing rule', () => {
    expect(validatePassword('short')).toEqual(expect.arrayContaining([
      `Must be at least ${PASSWORD_MIN_LENGTH} characters`,
      'Must include an uppercase letter',
      'Must include a number',
      'Must include a symbol',
    ]))
    expect(validatePassword('ALLUPPERCASE123!')).toContain('Must include a lowercase letter')
    expect(validatePassword('no digits here!A')).toContain('Must include a number')
    expect(validatePassword('NoSymbolsHere123')).toContain('Must include a symbol')
  })

  it('rejects whitespace', () => {
    expect(validatePassword('Has A Space 123!')).toContain('Must not contain spaces')
  })
})

describe('generateTemporaryPassword', () => {
  it('defaults to the configured length', () => {
    expect(generateTemporaryPassword()).toHaveLength(TEMP_PASSWORD_LENGTH)
    expect(generateTemporaryPassword(20)).toHaveLength(20)
  })

  it('refuses lengths below the minimum', () => {
    expect(() => generateTemporaryPassword(PASSWORD_MIN_LENGTH - 1)).toThrow()
  })

  it('always satisfies the policy and only uses the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const pw = generateTemporaryPassword()
      expect(validatePassword(pw)).toEqual([])
      for (const ch of pw) expect(TEMP_PASSWORD_ALPHABET).toContain(ch)
    }
  })

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateTemporaryPassword()))
    expect(seen.size).toBe(1000)
  })
})
