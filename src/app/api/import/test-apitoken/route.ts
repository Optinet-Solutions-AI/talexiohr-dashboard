import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const API_URL = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL!
const API_TOKEN = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN!
const API_DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN!

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  if (!API_TOKEN) return NextResponse.json({ error: 'NEXT_PUBLIC_TALEXIOHR_TOKEN not set' }, { status: 500 })

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'talexio-api-token': API_TOKEN,
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
      authType: 'talexio-api-token (persistent)',
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
