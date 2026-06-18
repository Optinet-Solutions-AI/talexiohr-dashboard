import { graphqlUrl } from './url'

const DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN ?? 'roosterpartners.talexiohr.com'

export interface RawPosition {
  startDate: string | null
  endDate: string | null
  isActive: boolean
  country: { name: string | null } | null
}
export interface RawEmployeeDetail {
  id: string
  isTerminated: boolean
  positions: RawPosition[]
}
export interface DetailUpdate {
  talexio_id: string
  country: string | null
  is_terminated: boolean
}

/** Active position (isActive, or endDate null); else latest by startDate; else null. */
export function resolveCountry(positions: RawPosition[]): string | null {
  if (!positions.length) return null
  const active = positions.find(p => p.isActive) ?? positions.find(p => p.endDate === null)
  const chosen = active ?? [...positions].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0]
  return chosen?.country?.name ?? null
}

export function buildDetailUpdates(details: RawEmployeeDetail[]): DetailUpdate[] {
  return details.map(d => ({
    talexio_id: d.id,
    country: resolveCountry(d.positions),
    is_terminated: d.isTerminated,
  }))
}

export async function fetchEmployeeDetails(token: string): Promise<RawEmployeeDetail[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'client-domain': DOMAIN,
    'apollographql-client-name': 'talexio-hr-frontend',
    'apollographql-client-version': '1.0',
  }
  if (token.split('.').length === 3) headers['authorization'] = `Bearer ${token}`
  else headers['talexio-api-token'] = token

  const res = await fetch(graphqlUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: `query EmployeeDetails {
        employees {
          id
          isTerminated
          positions { ... on EmployeePosition { startDate endDate isActive country { name } } }
        }
      }`,
    }),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (json.error) throw new Error(`Talexio error: ${json.error}`)
  if (json.errors?.length) throw new Error(`Talexio GraphQL error: ${json.errors.map((e: { message: string }) => e.message).join(', ')}`)
  return (json.data?.employees ?? []) as RawEmployeeDetail[]
}
