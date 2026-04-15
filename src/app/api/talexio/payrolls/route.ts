import { talexioQuery } from '@/lib/talexio/client'
import { NextResponse } from 'next/server'

// GET /api/talexio/payrolls
// Diagnostic route — returns available payrolls for the current and previous year
// Use this to find the payroll ID to set in TALEXIOHR_PAYROLL_ID
export async function GET() {
  const year = new Date().getFullYear()

  try {
    // Try top-level payrolls query
    const data = await talexioQuery<{
      payrolls: Array<{ id: string; name: string; status: string; dateFrom: string; dateTo: string }>
    }>({
      query: `
        query GetPayrolls($year: Int!) {
          payrolls(year: $year) {
            id
            name
            status
            dateFrom
            dateTo
          }
        }
      `,
      variables: { year },
    })

    return NextResponse.json({ year, payrolls: data.payrolls })
  } catch (err) {
    // Fallback: try payrollDetails (no args required)
    try {
      const data2 = await talexioQuery<{
        payrollDetails: Array<{ id: string; name: string }>
      }>({
        query: `
          query {
            payrollDetails {
              id
              name
            }
          }
        `,
      })

      return NextResponse.json({ payrollDetails: data2.payrollDetails })
    } catch (err2) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : String(err),
          fallbackError: err2 instanceof Error ? err2.message : String(err2),
        },
        { status: 500 },
      )
    }
  }
}
