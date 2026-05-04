import { NextRequest, NextResponse } from 'next/server'
import { getStoredToken } from '@/lib/talexio/token-store'

export const dynamic = 'force-dynamic'

const API_URL = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL!
const API_DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN!

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  const stored = await getStoredToken()
  const token = stored.token
  if (!token) {
    return NextResponse.json({
      error: 'No Talexio token configured. Paste a fresh token via the Talexio Token panel above.',
      tokenSource: stored.source,
    }, { status: 500 })
  }

  // Auto-detect JWT vs legacy token format
  const isJwt = token.split('.').length === 3
  const authHeaders: Record<string, string> = isJwt
    ? { 'authorization': `Bearer ${token}` }
    : { 'talexio-api-token': token }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        'client-domain': API_DOMAIN,
      },
      body: JSON.stringify({
        query: `query TestApiToken($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
          pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
            totalCount
            timeLogs {
              id from to label
              employee { id fullName }
              workLocationIn { name }
            }
          }
        }`,
        variables: { params: { dateFrom: date, dateTo: date }, pageNumber: 1, pageSize: 5 },
      }),
      cache: 'no-store',
    })

    const json = await res.json()
    const hasGqlErrors = !!json.errors?.length
    const hasAuthError = !!json.error // Talexio auth failures return { error: "..." }
    const ok = res.ok && !hasGqlErrors && !hasAuthError && !!json.data

    return NextResponse.json({
      tokenSource: stored.source,
      authType: isJwt ? 'Bearer JWT' : 'talexio-api-token (legacy)',
      httpStatus: res.status,
      ok,
      authError: hasAuthError ? json.error : null,
      gqlErrors: hasGqlErrors ? json.errors : null,
      totalCount: json.data?.pagedTimeLogs?.totalCount ?? null,
      uniqueEmployees: [...new Set((json.data?.pagedTimeLogs?.timeLogs ?? []).map((l: { employee?: { id: string } }) => l.employee?.id).filter(Boolean))].length,
      sample: json.data?.pagedTimeLogs?.timeLogs?.slice(0, 3).map((l: { from: string; employee?: { fullName: string } }) => ({
        name: l.employee?.fullName,
        from: l.from,
      })) ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
