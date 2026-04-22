import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Merges duplicate employees (matched by normalized full_name).
 *
 * Keeper priority (highest wins):
 *   1. has user-configured group_type (office_malta or remote)
 *   2. excluded = true (user explicitly excluded)
 *   3. has unit/job_schedule/position set (user added metadata)
 *   4. oldest created_at
 *
 * For each duplicate:
 *   - Move attendance_records to keeper (dedupe by date)
 *   - If keeper has no talexio_id, copy it from the dupe
 *   - If keeper's group_type is unclassified and dupe has a set one, copy it
 *   - Delete the dupe
 */
export async function POST() {
  const supabase = createAdminClient()

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, first_name, last_name, full_name, talexio_id, group_type, excluded, unit, job_schedule, position, created_at')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const normalize = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[̀-ͯ]/g, '')

  type Emp = NonNullable<typeof employees>[number]
  const byName = new Map<string, Emp[]>()
  for (const emp of employees ?? []) {
    const key = normalize(emp.full_name ?? `${emp.first_name} ${emp.last_name}`)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key)!.push(emp)
  }

  function score(e: Emp): number {
    let s = 0
    if (e.group_type && e.group_type !== 'unclassified') s += 100
    if (e.excluded) s += 80
    if (e.unit) s += 10
    if (e.job_schedule) s += 10
    if (e.position) s += 10
    return s
  }

  let merged = 0, deleted = 0, recordsReassigned = 0
  const details: { name: string; keeper: string; removed: string[] }[] = []

  for (const [, group] of byName) {
    if (group.length < 2) continue

    // Sort by score desc, then oldest first
    group.sort((a, b) => {
      const diff = score(b) - score(a)
      if (diff !== 0) return diff
      return (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1
    })

    const keeper = group[0]
    const dupes = group.slice(1)

    // Copy missing fields from dupes to keeper if keeper doesn't have them
    const patch: Record<string, unknown> = {}
    if (!keeper.talexio_id) {
      const dupeWithId = dupes.find(d => d.talexio_id)
      if (dupeWithId) patch.talexio_id = dupeWithId.talexio_id
    }
    if (!keeper.unit) {
      const d = dupes.find(d => d.unit)
      if (d) patch.unit = d.unit
    }
    if (!keeper.job_schedule) {
      const d = dupes.find(d => d.job_schedule)
      if (d) patch.job_schedule = d.job_schedule
    }
    if (!keeper.position) {
      const d = dupes.find(d => d.position)
      if (d) patch.position = d.position
    }

    // Before deleting dupes, null out their talexio_id to avoid the unique
    // constraint when we copy it to the keeper
    for (const dupe of dupes) {
      if (dupe.talexio_id) {
        await supabase.from('employees').update({ talexio_id: null }).eq('id', dupe.id)
      }
    }

    if (Object.keys(patch).length > 0) {
      await supabase.from('employees').update(patch).eq('id', keeper.id)
    }

    // Migrate attendance_records from dupes to keeper
    for (const dupe of dupes) {
      const { data: recs } = await supabase
        .from('attendance_records')
        .select('id, date')
        .eq('employee_id', dupe.id)

      for (const rec of recs ?? []) {
        const { data: existing } = await supabase
          .from('attendance_records')
          .select('id')
          .eq('employee_id', keeper.id)
          .eq('date', rec.date)
          .maybeSingle()

        if (existing) {
          await supabase.from('attendance_records').delete().eq('id', rec.id)
        } else {
          await supabase.from('attendance_records').update({ employee_id: keeper.id }).eq('id', rec.id)
          recordsReassigned++
        }
      }

      await supabase.from('employees').delete().eq('id', dupe.id)
      deleted++
    }

    merged++
    details.push({
      name: keeper.full_name,
      keeper: keeper.id,
      removed: dupes.map(d => d.id),
    })
  }

  return NextResponse.json({ ok: true, merged, deleted, recordsReassigned, details: details.slice(0, 30) })
}
