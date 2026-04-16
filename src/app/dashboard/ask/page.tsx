import AskSearch from '@/components/ask/AskSearch'

export default function AskPage() {
  return (
    <div className="py-8 sm:py-16">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-slate-800">HR Insights</h1>
        <p className="text-xs text-slate-600 mt-1">Ask questions about your attendance, compliance, and employee data</p>
      </div>
      <AskSearch />
    </div>
  )
}
