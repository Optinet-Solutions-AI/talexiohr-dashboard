import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(req: NextRequest) {
  const { id, group_type } = await req.json()
  if (!id || !['office_malta', 'remote', 'unclassified'].includes(group_type)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { error } = await supabase.from('employees').update({ group_type }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
