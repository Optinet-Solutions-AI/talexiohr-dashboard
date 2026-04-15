const API_URL    = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL!
const API_TOKEN  = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN!
const API_DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN!

// Set TALEXIOHR_PAYROLL_ID in .env.local once you find it in Talexio → Payroll settings
const PAYROLL_ID = process.env.TALEXIOHR_PAYROLL_ID ?? ''

export interface TalexioQueryOptions {
  query: string
  variables?: Record<string, unknown>
}

export async function talexioQuery<T = unknown>({ query, variables }: TalexioQueryOptions): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'talexio-api-token': API_TOKEN,
    'client-domain': API_DOMAIN,
  }

  if (PAYROLL_ID) {
    // Try common header names — update once confirmed with Talexio support
    headers['payroll-id'] = PAYROLL_ID
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })

  const json = await res.json()

  if (json.error) {
    throw new Error(`Talexio API error: ${json.error}`)
  }

  if (json.errors?.length) {
    throw new Error(`Talexio GraphQL error: ${json.errors.map((e: { message: string }) => e.message).join(', ')}`)
  }

  return json.data as T
}
