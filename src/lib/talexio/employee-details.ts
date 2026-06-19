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
  /** Talexio employee code (e.g. "Rewh01"). This — NOT `id` (a numeric node id)
   *  — is what the local employees.talexio_id column stores, because that column
   *  is populated from pagedTimeLogs.employee.id, which returns the code. */
  employeeCode: string | null
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
  // Match on employeeCode — that is what local employees.talexio_id holds.
  // Employees without a code can't be matched to a local row, so drop them.
  return details
    .filter((d): d is RawEmployeeDetail & { employeeCode: string } => Boolean(d.employeeCode))
    .map(d => ({
      talexio_id: d.employeeCode,
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
          employeeCode
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
