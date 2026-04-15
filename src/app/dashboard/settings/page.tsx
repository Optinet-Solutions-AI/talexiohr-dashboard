import { Settings } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Dashboard configuration</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-24 text-center">
        <Settings className="text-gray-300 mb-3" size={40} />
        <p className="text-gray-500 font-medium">Coming soon</p>
        <p className="text-gray-400 text-sm mt-1">Settings will be available here</p>
      </div>
    </div>
  )
}
