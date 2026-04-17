import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
const DOMAIN = 'roosterpartners.talexiohr.com'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const typeName = req.nextUrl.searchParams.get('type') || 'WorkShift'
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  try {
    const res = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        query: `query Introspect($name: String!) {
          __type(name: $name) {
            name
            kind
            fields {
              name
              type {
                name
                kind
                ofType {
                  name
                  kind
                  ofType { name kind }
                }
              }
            }
          }
        }`,
        variables: { name: typeName },
      }),
      cache: 'no-store',
    })
    const json = await res.json()
    return NextResponse.json(json)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
