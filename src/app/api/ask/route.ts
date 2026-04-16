import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function gatherContext(question: string) {
  const supabase = createAdminClient()
  const q = question.toLowerCase()

  // Always fetch employee summary
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, talexio_id, unit, group_type, job_schedule, position, excluded')
    .eq('excluded', false)
    .order('last_name')

  const emps = employees ?? []

  const context: Record<string, unknown> = {
    totalEmployees: emps.length,
    employeesByGroup: {
      office_malta: emps.filter(e => e.group_type === 'office_malta').length,
      remote: emps.filter(e => e.group_type === 'remote').length,
      unclassified: emps.filter(e => !e.group_type || e.group_type === 'unclassified').length,
    },
    employees: emps.map(e => ({
      name: e.full_name,
      code: e.talexio_id,
      group: e.group_type,
      unit: e.unit,
      position: e.position,
      schedule: e.job_schedule,
    })),
  }

  // Fetch attendance data (last 30 days by default, more if question implies)
  const days = q.includes('year') ? 365 : q.includes('month') ? 30 : q.includes('week') ? 7 : 30
  const dateTo = new Date().toISOString().slice(0, 10)
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  const { data: attendance } = await supabase
    .from('attendance_records')
    .select('employee_id, date, status, hours_worked, time_in, time_out, location_in, comments')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: false })
    .limit(2000)

  const recs = attendance ?? []
  context.dateRange = { from: dateFrom, to: dateTo }

  // Per-employee attendance summary
  const empStats = new Map<string, { name: string; office: number; wfh: number; remote: number; leave: number; sick: number; noClocking: number; totalHours: number; daysWorked: number }>()
  for (const emp of emps) {
    empStats.set(emp.id, { name: emp.full_name, office: 0, wfh: 0, remote: 0, leave: 0, sick: 0, noClocking: 0, totalHours: 0, daysWorked: 0 })
  }

  for (const r of recs) {
    const s = empStats.get(r.employee_id)
    if (!s) continue
    if (r.status === 'office') { s.office++; s.daysWorked++ }
    else if (r.status === 'wfh') { s.wfh++; s.daysWorked++ }
    else if (r.status === 'remote') { s.remote++; s.daysWorked++ }
    else if (r.status === 'vacation') s.leave++
    else if (r.status === 'sick') s.sick++
    else if (r.status === 'no_clocking') s.noClocking++
    else s.daysWorked++
    if (r.hours_worked) s.totalHours += r.hours_worked
  }

  context.employeeAttendance = [...empStats.values()].map(s => ({
    ...s,
    totalHours: Math.round(s.totalHours * 100) / 100,
    avgHoursPerDay: s.daysWorked > 0 ? Math.round((s.totalHours / s.daysWorked) * 100) / 100 : 0,
  }))

  // Overall stats
  context.overallStats = {
    totalRecords: recs.length,
    byStatus: {
      office: recs.filter(r => r.status === 'office').length,
      wfh: recs.filter(r => r.status === 'wfh').length,
      remote: recs.filter(r => r.status === 'remote').length,
      vacation: recs.filter(r => r.status === 'vacation').length,
      sick: recs.filter(r => r.status === 'sick').length,
      noClocking: recs.filter(r => r.status === 'no_clocking').length,
    },
  }

  // If asking about specific employee, include their daily records
  const nameMatch = emps.find(e => q.includes(e.full_name.toLowerCase()))
  if (nameMatch) {
    const empRecs = recs.filter(r => r.employee_id === nameMatch.id)
    context.focusedEmployee = {
      ...nameMatch,
      records: empRecs.slice(0, 60).map(r => ({
        date: r.date, status: r.status, hours: r.hours_worked,
        timeIn: r.time_in, timeOut: r.time_out, location: r.location_in,
      })),
    }
  }

  return context
}

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json()
    if (!question?.trim()) return NextResponse.json({ error: 'Question is required' }, { status: 400 })

    const context = await gatherContext(question)

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an HR analytics assistant for Rooster Partners' Malta office. You answer questions about employee attendance, compliance, and performance based on real data from the company's HR dashboard.

Rules:
- Base ALL answers on the provided data context. Never make up data.
- Be concise and specific. Use numbers and names.
- Format answers with markdown when helpful (bold, lists, tables).
- If the data doesn't contain enough info to answer, say so clearly.
- The company has two employee groups: Malta Office (must attend 4 days/week, max 1 WFH Monday and 1 WFH Friday per month) and Remote (evaluated on hours only).
- "Best employee" means highest office attendance + most hours worked unless the user specifies differently.
- Current date: ${new Date().toISOString().slice(0, 10)}`
        },
        {
          role: 'user',
          content: `Data context:\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}`
        }
      ],
      temperature: 0.3,
      max_tokens: 1500,
    })

    const answer = completion.choices[0]?.message?.content ?? 'No response generated.'

    return NextResponse.json({
      answer,
      question,
      context: {
        dateRange: context.dateRange,
        employeeCount: context.totalEmployees,
        recordCount: (context.overallStats as Record<string, unknown>)?.totalRecords,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[ask]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to generate answer' }, { status: 500 })
  }
}
