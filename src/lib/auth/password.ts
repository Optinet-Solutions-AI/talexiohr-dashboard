/**
 * Password policy shared by the change-password form (validation) and the
 * provisioning script (temporary password generation).
 *
 * Keep this file free of path aliases and non-erasable TS syntax: it is
 * imported directly by `scripts/provision-users.mjs` under Node's type
 * stripping.
 */

export const PASSWORD_MIN_LENGTH = 12
export const TEMP_PASSWORD_LENGTH = 16

export const PASSWORD_RULES: readonly string[] = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  'An uppercase letter',
  'A lowercase letter',
  'A number',
  'A symbol (for example ! @ # $ % & *)',
  'No spaces',
]

/** Returns a list of human-readable problems; empty when the password is acceptable. */
export function validatePassword(password: string): string[] {
  const problems: string[] = []
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Must be at least ${PASSWORD_MIN_LENGTH} characters`)
  if (!/[A-Z]/.test(password)) problems.push('Must include an uppercase letter')
  if (!/[a-z]/.test(password)) problems.push('Must include a lowercase letter')
  if (!/[0-9]/.test(password)) problems.push('Must include a number')
  if (!/[^A-Za-z0-9\s]/.test(password)) problems.push('Must include a symbol')
  if (/\s/.test(password)) problems.push('Must not contain spaces')
  return problems
}

// Ambiguous glyphs (0/O, 1/l/I) are left out so a password read from a
// screen or printout types correctly first time.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGIT = '23456789'
const SYMBOL = '!@#$%&*+-=?'
export const TEMP_PASSWORD_ALPHABET = UPPER + LOWER + DIGIT + SYMBOL

function randomInt(maxExclusive: number): number {
  // Rejection sampling keeps the distribution uniform.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % maxExclusive
  }
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]
}

/**
 * Cryptographically random temporary password that always satisfies
 * `validatePassword`: one character from each class is guaranteed, the rest
 * are drawn from the full alphabet, then the order is shuffled.
 */
export function generateTemporaryPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  if (length < PASSWORD_MIN_LENGTH) throw new Error(`length must be >= ${PASSWORD_MIN_LENGTH}`)
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)]
  while (chars.length < length) chars.push(pick(TEMP_PASSWORD_ALPHABET))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
