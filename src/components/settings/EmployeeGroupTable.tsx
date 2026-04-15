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
  const [saved,  setSaved]  = useState<Set<string>>(new Set())
  const [groups, setGroups] = useState<Record<string, string>>(
    Object.fromEntries(employees.map(e => [e.id, e.group_type ?? 'unclassified']))
  )

  async function handleChange(id: string, group_type: string) {
    setGroups(g => ({ ...g, [id]: group_type }))
    setSaving(id)
    try {
      await fetch('/api/employees/group', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, group_type }),
      })
      setSaved(s => new Set([...s, id]))
      setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(id); return n }), 2000)
    } finally {
      setSaving(null)
    }
  }

  const GROUP_COLOR: Record<string, string> = {
    office_malta: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    remote:       'text-blue-700 bg-blue-50 border-blue-200',
    unclassified: 'text-gray-500 bg-gray-50 border-gray-200',
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 text-left">
          <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Employee</th>
          <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Code</th>
          <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Unit</th>
          <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider w-48">Group</th>
          <th className="px-4 py-3 w-8"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {employees.map(emp => {
          const current = groups[emp.id] ?? 'unclassified'
          return (
            <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-2.5 font-medium text-gray-900">{emp.full_name}</td>
              <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{emp.talexio_id ?? '—'}</td>
              <td className="px-4 py-2.5 text-gray-500 text-xs">{emp.unit ?? '—'}</td>
              <td className="px-4 py-2.5">
                <select
                  value={current}
                  onChange={e => handleChange(emp.id, e.target.value)}
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${GROUP_COLOR[current]}`}
                >
                  {GROUPS.map(g => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-2.5 text-center w-8">
                {saving === emp.id && <Loader2 size={13} className="animate-spin text-gray-400 mx-auto" />}
                {saved.has(emp.id) && <Check size={13} className="text-emerald-500 mx-auto" />}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
