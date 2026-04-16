'use client'

import { useRouter } from 'next/navigation'

export default function ComplianceFilters({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()
  return (
    <input
      type="month"
      value={currentMonth}
      onChange={e => router.push(`/dashboard/compliance?month=${e.target.value}`)}
      className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400"
    />
  )
}
