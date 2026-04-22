import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DOMAIN = 'roosterpartners.talexiohr.com'

/**
 * Clean slate for attendance data while preserving employees.
 *
 * 1. Fetches all employees from Talexio API (authoritative source of talexio_id)
 * 2. Matches local employees by full_name and sets/updates their talexio_id
 * 3. Preserves group_type, excluded flag, unit, job_schedule, position
 * 4. Wipes all attendance_records
 *
 * After this: future API pulls match employees by talexio_id → no more duplicates.
 */
export async function POST() {
  const apiToken = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN
  const apiUrl = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL ?? 'https://api.talexiohr.com/graphql'
  if (!apiToken) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_TALEXIOHR_TOKEN not set' }, { status: 500 })
  }

  const supabase = createAdminClient()

  // 1. Fetch all employees from Talexio
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'talexio-api-token': apiToken,
      'client-domain': DOMAIN,
    },
    body: JSON.stringify({
      query: `query AllEmployees { employees { id fullName firstName lastName } }`,
    }),
    cache: 'no-store',
  })
  const json = await res.json()

  if (json.errors?.length) {
    return NextResponse.json({ error: `Talexio API: ${json.errors.map((e: { message: string }) => e.message).join(', ')}` }, { status: 500 })
  }

  const talexioEmps: { id: string; fullName: string; firstName: string; lastName: string }[] = json.data?.employees ?? []

  // 2. Fetch local employees
  const { data: localEmps } = await supabase.from('employees').select('id, full_name, first_name, last_name, talexio_id')
  const localList = localEmps ?? []

  // 3. Match and backfill talexio_id
  let matched = 0, updated = 0, alreadySet = 0, unmatched: string[] = []

  for (const local of localList) {
    const localName = (local.full_name ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
    const tmatch = talexioEmps.find(t => (t.fullName ?? '').toLowerCase().trim().replace(/\s+/g, ' ') === localName)

    if (!tmatch) {
      unmatched.push(local.full_name)
      continue
    }
    matched++

    if (local.talexio_id === tmatch.id) {
      alreadySet++
      continue
    }

    // Update talexio_id to match Talexio's authoritative ID
    const { error } = await supabase
      .from('employees')
      .update({ talexio_id: tmatch.id })
      .eq('id', local.id)

    if (!error) updated++
  }

  // 4. Wipe all attendance_records
  const { error: delError, count: deletedCount } = await supabase
    .from('attendance_records')
    .delete({ count: 'exact' })
    .gte('date', '1900-01-01')

  if (delError) {
    return NextResponse.json({ error: `Delete failed: ${delError.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    employees: {
      total: localList.length,
      matched,
      idUpdated: updated,
      alreadyCorrect: alreadySet,
      unmatched: unmatched.slice(0, 20),
      unmatchedCount: unmatched.length,
    },
    attendanceRecordsDeleted: deletedCount ?? 0,
    talexioEmployeeCount: talexioEmps.length,
  })
}
