import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const API_URL = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL
  const API_TOKEN = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN
  const API_DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN

  if (!API_URL || !API_TOKEN || !API_DOMAIN) {
    return NextResponse.json({ error: 'Missing Talexio env vars', vars: { API_URL: !!API_URL, API_TOKEN: !!API_TOKEN, API_DOMAIN: !!API_DOMAIN } }, { status: 500 })
  }

  // Try a minimal query — just fetch today's time logs (1 page, 5 results)
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'talexio-api-token': API_TOKEN,
        'client-domain': API_DOMAIN,
      },
      body: JSON.stringify({
        query: `
          query TestTimeLogs($params: TimeLogsFilterParams, $pageNumber: Int!, $pageSize: Int!) {
            pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
              totalCount
              timeLogs {
                id
                from
                to
                label
                employee { id fullName }
                workLocationIn { name }
              }
            }
          }
        `,
        variables: {
          params: { from: date, to: date, selectedUnitIds: [], selectedRoomIds: [], selectedEmployeeIds: [] },
          pageNumber: 1,
          pageSize: 5,
        },
      }),
      cache: 'no-store',
    })

    const json = await res.json()
    return NextResponse.json({
      status: res.status,
      ok: res.ok,
      hasErrors: !!json.errors?.length,
      errors: json.errors || null,
      hasData: !!json.data,
      totalCount: json.data?.pagedTimeLogs?.totalCount ?? null,
      sampleLogs: json.data?.pagedTimeLogs?.timeLogs?.slice(0, 3) ?? [],
      rawError: json.error || null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Request failed' }, { status: 500 })
  }
}
