import ImportUpload from '@/components/import/ImportUpload'

export default function ImportPage() {
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Import Data</h1>
        <p className="text-xs text-slate-600 mt-0.5">Upload CSV files from Talexio reports</p>
      </div>

      <ImportUpload
        type="clockings"
        title="Clockings / Timesheet"
        description="Upload the Talexio Clockings CSV export. Multiple sessions per employee per day are aggregated automatically."
      />

      <ImportUpload
        type="leave"
        title="Leave & Sick"
        description="Upload the Talexio Leave/Sick CSV export. Only approved entries are imported. Existing attendance records will be updated with leave status."
      />
    </div>
  )
}
