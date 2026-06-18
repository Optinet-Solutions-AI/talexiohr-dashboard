'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { LocationGroup } from '@/lib/filters/employeeFilter'

const GROUPS: { value: LocationGroup; label: string }[] = [
  { value: 'malta', label: 'Malta' },
  { value: 'bulgaria', label: 'Bulgaria' },
  { value: 'other', label: 'Other' },
]

interface Props {
  selected: LocationGroup[]
  counts: Record<LocationGroup, number>
}

export default function LocationGroupFilter({ selected, counts }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  function toggle(g: LocationGroup) {
    const next = new URLSearchParams(params.toString())
    const set = selected.includes(g) ? selected.filter(x => x !== g) : [...selected, g]
    if (set.length) next.set('locations', set.join(',')); else next.delete('locations')
    next.delete('page')
    router.push(`?${next.toString()}`)
  }

  return (
    <div className="flex items-center gap-1.5">
      {GROUPS.map(g => {
        const on = selected.includes(g.value)
        return (
          <button key={g.value} onClick={() => toggle(g.value)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {g.label}
            <span className={`rounded px-1 text-[10px] ${on ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{counts[g.value]}</span>
          </button>
        )
      })}
    </div>
  )
}
