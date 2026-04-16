'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

const GROUPS = [
  { value: 'office_malta', label: 'Malta Office' },
  { value: 'remote',       label: 'Remote'       },
  { value: 'unclassified', label: 'Unclassified' },
]

interface Employee {
  id: string
  full_name: string
  talexio_id: string | null
  unit: string | null
  group_type: string | null
}

export default function EmployeeGroupTable({ employees }: { employees: Employee[] }) {
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [groups, setGroups] = useState<Record<string, string>>(
    Object.fromEntries(employees.map(e => [e.id, e.group_type ?? 'unclassified']))
  )

  async function handleChange(id: string, group_type: string) {
    setGroups(g => ({ ...g, [id]: group_type }))
    setSaving(id)
    try {
      await fetch('/api/employees/group', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, group_type }) })
      setSaved(s => new Set([...s, id]))
      setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(id); return n }), 2000)
    } finally { setSaving(null) }
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden sm:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Employee</th>
              <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Code</th>
              <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider">Unit</th>
              <th className="px-4 py-2.5 font-medium text-slate-400 text-[10px] uppercase tracking-wider w-44">Group</th>
              <th className="px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {employees.map(emp => {
              const current = groups[emp.id] ?? 'unclassified'
              return (
                <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{emp.full_name}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]">{emp.talexio_id ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{emp.unit ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={current}
                      onChange={e => handleChange(emp.id, e.target.value)}
                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                    >
                      {GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2.5 text-center w-8">
                    {saving === emp.id && <Loader2 size={12} className="animate-spin text-slate-300 mx-auto" />}
                    {saved.has(emp.id) && <Check size={12} className="text-slate-500 mx-auto" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="sm:hidden divide-y divide-slate-100">
        {employees.map(emp => {
          const current = groups[emp.id] ?? 'unclassified'
          return (
            <div key={emp.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">{emp.full_name}</span>
                <div className="flex items-center gap-1.5">
                  {saving === emp.id && <Loader2 size={11} className="animate-spin text-slate-300" />}
                  {saved.has(emp.id) && <Check size={11} className="text-slate-500" />}
                </div>
              </div>
              <select
                value={current}
                onChange={e => handleChange(emp.id, e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
              >
                {GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
          )
        })}
      </div>
    </>
  )
}
