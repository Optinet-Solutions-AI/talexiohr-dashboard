'use client'

import { useState } from 'react'
import { Pencil, Trash2, Check, X, Loader2, EyeOff, Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'

const GROUPS = ['office_malta', 'remote', 'unclassified'] as const
const GROUP_LABEL: Record<string, { label: string; cls: string }> = {
  office_malta: { label: 'Malta Office', cls: 'bg-indigo-600 text-white' },
  remote:       { label: 'Remote',       cls: 'bg-indigo-100 text-indigo-700' },
  unclassified: { label: 'Unclassified', cls: 'bg-slate-100 text-slate-600' },
}

const TIMEZONES = [
  'Europe/Malta', 'Europe/Minsk', 'Europe/London', 'Europe/Berlin', 'Europe/Athens',
  'Europe/Moscow', 'Asia/Manila', 'Asia/Dubai', 'America/New_York', 'America/Los_Angeles',
]

interface Employee {
  id: string
  full_name: string
  first_name?: string
  last_name?: string
  talexio_id: string | null
  unit: string | null
  group_type: string | null
  job_schedule: string | null
  position: string | null
  excluded: boolean | null
  timezone?: string | null
}

export default function EmployeeTable({ employees }: { employees: Employee[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const router = useRouter()

  async function toggleExclude(id: string, currentlyExcluded: boolean) {
    setToggling(id)
    try {
      await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, excluded: !currentlyExcluded }),
      })
      router.refresh()
    } finally { setToggling(null) }
  }

  function startEdit(emp: Employee) {
    const names = emp.full_name.split(' ')
    setEditingId(emp.id)
    setEditData({
      first_name: names.slice(0, -1).join(' ') || names[0] || '',
      last_name: names.slice(-1)[0] || '',
      talexio_id: emp.talexio_id || '',
      unit: emp.unit || '',
      group_type: emp.group_type || 'unclassified',
      job_schedule: emp.job_schedule || '',
      position: emp.position || '',
      timezone: emp.timezone || 'Europe/Malta',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    try {
      const res = await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...editData }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error); return }
      setEditingId(null)
      router.refresh()
    } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      const res = await fetch('/api/employees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error); return }
      setConfirmDelete(null)
      router.refresh()
    } finally { setDeleting(null) }
  }

  const inputCls = 'rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-full'

  return (
    <>
      {/* Desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Name</th>
              <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Code</th>
              <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Group</th>
              <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Unit</th>
              <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Schedule</th>
              <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {employees.map(emp => {
              const isEditing = editingId === emp.id
              const g = GROUP_LABEL[emp.group_type ?? 'unclassified'] ?? GROUP_LABEL.unclassified

              if (isEditing) {
                return (
                  <tr key={emp.id} className="bg-indigo-50/30">
                    <td className="px-4 py-2 space-y-1">
                      <input value={editData.first_name} onChange={e => setEditData(d => ({ ...d, first_name: e.target.value }))} placeholder="First name" className={inputCls} />
                      <input value={editData.last_name} onChange={e => setEditData(d => ({ ...d, last_name: e.target.value }))} placeholder="Last name" className={inputCls} />
                    </td>
                    <td className="px-4 py-2">
                      <input value={editData.talexio_id} onChange={e => setEditData(d => ({ ...d, talexio_id: e.target.value }))} placeholder="Code" className={`${inputCls} font-mono`} />
                    </td>
                    <td className="px-4 py-2">
                      <select value={editData.group_type} onChange={e => setEditData(d => ({ ...d, group_type: e.target.value }))} className={inputCls}>
                        {GROUPS.map(g => <option key={g} value={g}>{GROUP_LABEL[g].label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input value={editData.unit} onChange={e => setEditData(d => ({ ...d, unit: e.target.value }))} placeholder="Unit" className={inputCls} />
                    </td>
                    <td className="px-4 py-2 space-y-1">
                      <input value={editData.job_schedule} onChange={e => setEditData(d => ({ ...d, job_schedule: e.target.value }))} placeholder="Schedule" className={inputCls} />
                      <select value={editData.timezone} onChange={e => setEditData(d => ({ ...d, timezone: e.target.value }))} className={`${inputCls} text-[10px]`}>
                        {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={saveEdit} disabled={saving} className="p-1 rounded hover:bg-indigo-100 text-indigo-600 disabled:opacity-50">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              }

              const isExcluded = !!emp.excluded
              return (
                <tr key={emp.id} className={`hover:bg-slate-50/50 transition-colors ${isExcluded ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <span className={`font-medium ${isExcluded ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{emp.full_name}</span>
                    {isExcluded && <span className="ml-1.5 text-[10px] text-red-500 font-medium">EXCLUDED</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 font-mono text-[11px]">{emp.talexio_id ?? '—'}</td>
                  <td className="px-4 py-2.5"><span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${g.cls}`}>{g.label}</span></td>
                  <td className="px-4 py-2.5 text-slate-500">{emp.unit ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    <span>{emp.job_schedule ?? '—'}</span>
                    {emp.timezone && emp.timezone !== 'Europe/Malta' && (
                      <span className="block text-[9px] text-indigo-600">{emp.timezone}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleExclude(emp.id, isExcluded)} disabled={toggling === emp.id}
                        className={`p-1 rounded ${isExcluded ? 'hover:bg-indigo-50 text-indigo-500' : 'hover:bg-amber-50 text-slate-500 hover:text-amber-600'}`}
                        title={isExcluded ? 'Include in dashboard' : 'Exclude from dashboard'}>
                        {toggling === emp.id ? <Loader2 size={13} className="animate-spin" /> : isExcluded ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button onClick={() => startEdit(emp)} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="Edit">
                        <Pencil size={13} />
                      </button>
                      {confirmDelete === emp.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDelete(emp.id)} disabled={deleting === emp.id}
                            className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-medium hover:bg-red-700 disabled:opacity-50">
                            {deleting === emp.id ? <Loader2 size={10} className="animate-spin" /> : 'Yes'}
                          </button>
                          <button onClick={() => setConfirmDelete(null)} className="px-1.5 py-0.5 rounded border border-slate-200 text-[10px] text-slate-500 hover:bg-slate-50">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(emp.id)} className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-600" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
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
          const isEditing = editingId === emp.id
          const g = GROUP_LABEL[emp.group_type ?? 'unclassified'] ?? GROUP_LABEL.unclassified

          if (isEditing) {
            return (
              <div key={emp.id} className="px-4 py-3 bg-indigo-50/30 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editData.first_name} onChange={e => setEditData(d => ({ ...d, first_name: e.target.value }))} placeholder="First name" className={inputCls} />
                  <input value={editData.last_name} onChange={e => setEditData(d => ({ ...d, last_name: e.target.value }))} placeholder="Last name" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={editData.talexio_id} onChange={e => setEditData(d => ({ ...d, talexio_id: e.target.value }))} placeholder="Code" className={`${inputCls} font-mono`} />
                  <select value={editData.group_type} onChange={e => setEditData(d => ({ ...d, group_type: e.target.value }))} className={inputCls}>
                    {GROUPS.map(g => <option key={g} value={g}>{GROUP_LABEL[g].label}</option>)}
                  </select>
                </div>
                <input value={editData.unit} onChange={e => setEditData(d => ({ ...d, unit: e.target.value }))} placeholder="Unit" className={inputCls} />
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 rounded-md bg-indigo-600 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600">Cancel</button>
                </div>
              </div>
            )
          }

          const isExcluded = !!emp.excluded
          return (
            <div key={emp.id} className={`px-4 py-3 space-y-1 ${isExcluded ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={`text-xs font-medium ${isExcluded ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{emp.full_name}</span>
                  {isExcluded && <span className="ml-1 text-[9px] text-red-500 font-medium">EXCLUDED</span>}
                </div>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${g.cls}`}>{g.label}</span>
                  <button onClick={() => toggleExclude(emp.id, isExcluded)} disabled={toggling === emp.id}
                    className={`p-1 ${isExcluded ? 'text-indigo-500' : 'text-slate-500'}`}
                    title={isExcluded ? 'Include' : 'Exclude'}>
                    {toggling === emp.id ? <Loader2 size={12} className="animate-spin" /> : isExcluded ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button onClick={() => startEdit(emp)} className="p-1 text-slate-500"><Pencil size={12} /></button>
                  {confirmDelete === emp.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDelete(emp.id)} disabled={deleting === emp.id}
                        className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-medium disabled:opacity-50">
                        {deleting === emp.id ? '...' : 'Yes'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="px-1.5 py-0.5 rounded border border-slate-200 text-[10px] text-slate-500">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(emp.id)} className="p-1 text-slate-500 hover:text-red-600"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-600">
                <span>{emp.talexio_id ?? '—'}</span>
                <span>{emp.unit ?? '—'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
