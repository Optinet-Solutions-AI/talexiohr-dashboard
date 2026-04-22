import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Merges duplicate employees by full_name.
 * When duplicates are found: keeps the one WITH talexio_id (or oldest if tie),
 * reassigns all attendance_records to the keeper, deletes the rest.
 */
export async function POST() {
  const supabase = createAdminClient()

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, first_name, last_name, full_name, talexio_id, created_at')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by lowercase full_name
  const byName = new Map<string, typeof employees>()
  for (const emp of employees ?? []) {
    const key = (emp.full_name ?? '').toLowerCase().trim()
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key)!.push(emp)
  }

  let merged = 0, deleted = 0, recordsReassigned = 0

  for (const [, group] of byName) {
    if (group.length < 2) continue

    // Keeper: prefer one with talexio_id, else oldest
    group.sort((a, b) => {
      if (a.talexio_id && !b.talexio_id) return -1
      if (!a.talexio_id && b.talexio_id) return 1
      return a.created_at < b.created_at ? -1 : 1
    })
    const keeper = group[0]
    const dupes = group.slice(1)

    // Reassign attendance records from dupes to keeper
    for (const dupe of dupes) {
      const { data: recs } = await supabase
        .from('attendance_records')
        .select('id, date')
        .eq('employee_id', dupe.id)

      for (const rec of recs ?? []) {
        // Check if keeper already has a record for this date
        const { data: existing } = await supabase
          .from('attendance_records')
          .select('id')
          .eq('employee_id', keeper.id)
          .eq('date', rec.date)
          .maybeSingle()

        if (existing) {
          // Keeper has record — delete the dupe's
          await supabase.from('attendance_records').delete().eq('id', rec.id)
        } else {
          // Reassign to keeper
          await supabase.from('attendance_records').update({ employee_id: keeper.id }).eq('id', rec.id)
          recordsReassigned++
        }
      }

      // Delete the duplicate employee
      await supabase.from('employees').delete().eq('id', dupe.id)
      deleted++
    }
    merged++
  }

  return NextResponse.json({ ok: true, merged, deleted, recordsReassigned })
}
