'use client'

import { useRouter } from 'next/navigation'

export default function ComplianceFilters({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()

  return (
    <input
      type="month"
      value={currentMonth}
      onChange={e => router.push(`/dashboard/compliance?month=${e.target.value}`)}
      className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}
