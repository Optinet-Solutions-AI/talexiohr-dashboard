// src/app/api/employees/sync-details/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStoredToken } from '@/lib/talexio/token-store'
import { fetchEmployeeDetails, buildDetailUpdates } from '@/lib/talexio/employee-details'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const { token } = await getStoredToken()
  if (!token) {
    return NextResponse.json({ error: 'No Talexio token configured. Paste a fresh token via the Talexio Token panel.' }, { status: 401 })
  }

  const supabase = createAdminClient()

  let details
  try {
    details = await fetchEmployeeDetails(token)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fetch failed' }, { status: 500 })
  }

  const updates = buildDetailUpdates(details)
  const syncedAt = new Date().toISOString()

  // Update only employees that already exist locally (matched by talexio_id).
  let updated = 0
  const byCountry: Record<string, number> = {}
  for (const u of updates) {
    const { data, error } = await supabase
      .from('employees')
      .update({ country: u.country, is_terminated: u.is_terminated, details_synced_at: syncedAt })
      .eq('talexio_id', u.talexio_id)
      .select('id')
    if (error) continue
    if (data && data.length) {
      updated += data.length
      const key = u.country ?? '(none)'
      byCountry[key] = (byCountry[key] ?? 0) + 1
    }
  }

  const terminated = updates.filter(u => u.is_terminated).length
  return NextResponse.json({ ok: true, updated, terminated, byCountry, syncedAt })
}
