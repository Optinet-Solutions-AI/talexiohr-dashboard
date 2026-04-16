import ImportUpload from '@/components/import/ImportUpload'
import TalexioPull from '@/components/import/TalexioPull'

export default function ImportPage() {
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Import Data</h1>
        <p className="text-xs text-slate-600 mt-0.5">Pull from Talexio API or upload CSV files</p>
      </div>

      <TalexioPull />

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
        <div className="relative flex justify-center">
          <span className="bg-slate-50 px-3 text-xs text-slate-500">or upload CSV files</span>
        </div>
      </div>

      <ImportUpload
        type="clockings"
        title="Clockings / Timesheet"
        description="Upload the Talexio Clockings CSV export. Multiple sessions per employee per day are aggregated automatically."
      />

      <ImportUpload
        type="leave"
        title="Leave & Sick"
        description="Upload the Talexio Leave/Sick CSV export. Only approved entries are imported."
      />
    </div>
  )
}
