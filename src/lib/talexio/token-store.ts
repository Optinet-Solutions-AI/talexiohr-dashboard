import { createAdminClient } from '@/lib/supabase/admin'

export interface TokenStatus {
  /** "valid" | "expired" | "missing" | "unverified" */
  state: 'valid' | 'expired' | 'missing' | 'unverified'
  /** Source of the token currently in use */
  source: 'db' | 'env' | 'none'
  /** ISO timestamp when token expires (decoded from JWT exp) */
  expiresAt: string | null
  /** Minutes remaining until expiry (negative if expired) */
  minutesRemaining: number | null
  /** Last time a user pasted a token via the UI */
  updatedAt: string | null
  /** Email of the user who last updated the token */
  updatedBy: string | null
  /** True if a live API check confirmed the token works (only set after verifyToken) */
  liveCheck?: { ok: boolean; error?: string; httpStatus?: number }
}

/**
 * Decode the expiry from a JWT payload. Talexio uses a non-standard
 * `expiryDate` (ISO string) instead of the RFC 7519 `exp` (Unix seconds), so
 * we check both. Returns null for non-JWT tokens or malformed payloads.
 */
export function decodeJwtExpiry(token: string): Date | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    const payload = JSON.parse(decoded) as { exp?: number; expiryDate?: string }
    if (typeof payload.expiryDate === 'string') {
      const d = new Date(payload.expiryDate)
      if (!isNaN(d.getTime())) return d
    }
    if (typeof payload.exp === 'number') return new Date(payload.exp * 1000)
    return null
  } catch {
    return null
  }
}

/**
 * Read the stored token. Prefers the DB row (set via the UI); falls back to
 * the legacy NEXT_PUBLIC_TALEXIOHR_TOKEN env var so existing deployments keep
 * working until a token is pasted.
 */
export async function getStoredToken(): Promise<{ token: string | null; source: 'db' | 'env' | 'none'; updatedAt: string | null; updatedBy: string | null }> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('talexio_auth').select('token, updated_at, updated_by').eq('id', 1).maybeSingle()
  if (data?.token) {
    return { token: data.token, source: 'db', updatedAt: data.updated_at, updatedBy: data.updated_by ?? null }
  }
  const envToken = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN
  if (envToken) return { token: envToken, source: 'env', updatedAt: null, updatedBy: null }
  return { token: null, source: 'none', updatedAt: null, updatedBy: null }
}

/**
 * Save a new token. Decodes the expiry from the JWT payload (best-effort).
 */
export async function saveStoredToken(token: string, updatedBy: string | null): Promise<{ expiresAt: string | null }> {
  const supabase = createAdminClient()
  const exp = decodeJwtExpiry(token)
  const expiresAt = exp ? exp.toISOString() : null
  await supabase.from('talexio_auth').upsert({
    id: 1,
    token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  }, { onConflict: 'id' })
  return { expiresAt }
}

/**
 * Inspect the stored token without making a network call. Cheap; safe to
 * call from anywhere. Use verifyToken() for a live API ping.
 */
export async function getTokenStatus(): Promise<TokenStatus> {
  const stored = await getStoredToken()
  if (!stored.token) {
    return {
      state: 'missing', source: 'none',
      expiresAt: null, minutesRemaining: null,
      updatedAt: null, updatedBy: null,
    }
  }

  const exp = decodeJwtExpiry(stored.token)
  if (!exp) {
    return {
      state: 'unverified', source: stored.source,
      expiresAt: null, minutesRemaining: null,
      updatedAt: stored.updatedAt, updatedBy: stored.updatedBy,
    }
  }

  const minutesRemaining = Math.floor((exp.getTime() - Date.now()) / 60_000)
  return {
    state: minutesRemaining > 0 ? 'valid' : 'expired',
    source: stored.source,
    expiresAt: exp.toISOString(),
    minutesRemaining,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  }
}

const GQL_URL = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL ?? 'https://api.talexiohr.com/graphql'
const DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN ?? 'roosterpartners.talexiohr.com'

/**
 * Live ping: hit Talexio with a tiny query and report whether the token
 * actually works right now. Useful for the UI status indicator.
 */
export async function verifyToken(token: string): Promise<{ ok: boolean; error?: string; httpStatus: number }> {
  const isJwt = token.split('.').length === 3
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'client-domain': DOMAIN,
    'apollographql-client-name': 'talexio-hr-frontend',
    'apollographql-client-version': '1.0',
  }
  if (isJwt) headers['authorization'] = `Bearer ${token}`
  else headers['talexio-api-token'] = token

  // Use the `me` query — returns the current user without needing a payroll
  // context (which `employees` and even `pagedTimeLogs` can require). A 401
  // here means the token is genuinely expired/invalid; anything else is some
  // other domain error and we should surface it.
  try {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `query TokenPing { me { id } }`,
      }),
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({}))
    if (json.error) return { ok: false, error: String(json.error), httpStatus: res.status }
    if (json.errors?.length) return { ok: false, error: json.errors.map((e: { message: string }) => e.message).join(', '), httpStatus: res.status }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, httpStatus: res.status }
    if (!json.data) return { ok: false, error: 'No data in response', httpStatus: res.status }
    return { ok: true, httpStatus: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error', httpStatus: 0 }
  }
}
