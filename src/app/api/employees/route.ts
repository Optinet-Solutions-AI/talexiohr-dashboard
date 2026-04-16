import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH — edit employee fields
export async function PATCH(req: NextRequest) {
  const { id, first_name, last_name, talexio_id, unit, group_type, job_schedule, position } = await req.json()
  if (!id) return NextResponse.json({ error: 'Employee id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (first_name !== undefined) updates.first_name = first_name
  if (last_name !== undefined) updates.last_name = last_name
  if (talexio_id !== undefined) updates.talexio_id = talexio_id || null
  if (unit !== undefined) updates.unit = unit || null
  if (group_type !== undefined) {
    if (!['office_malta', 'remote', 'unclassified'].includes(group_type)) {
      return NextResponse.json({ error: 'Invalid group_type' }, { status: 400 })
    }
    updates.group_type = group_type
  }
  if (job_schedule !== undefined) updates.job_schedule = job_schedule || null
  if (position !== undefined) updates.position = position || null

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('employees').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — remove employee and their attendance records
export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Employee id required' }, { status: 400 })

  const supabase = createAdminClient()

  // Attendance records cascade on delete, but let's be explicit
  await supabase.from('attendance_records').delete().eq('employee_id', id)
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
