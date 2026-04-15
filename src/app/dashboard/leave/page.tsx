import { CalendarDays } from 'lucide-react'

export default function LeavePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Leave</h1>
        <p className="text-sm text-gray-500 mt-0.5">Leave requests and balances</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-24 text-center">
        <CalendarDays className="text-gray-300 mb-3" size={40} />
        <p className="text-gray-500 font-medium">Coming soon</p>
        <p className="text-gray-400 text-sm mt-1">Leave management will be available here</p>
      </div>
    </div>
  )
}
