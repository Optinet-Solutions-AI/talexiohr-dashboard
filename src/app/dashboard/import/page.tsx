import ImportUpload from '@/components/import/ImportUpload'
import TalexioPull from '@/components/import/TalexioPull'
import TalexioTokenStatus from '@/components/import/TalexioTokenStatus'
import Reclassify from '@/components/import/Reclassify'
import Dedupe from '@/components/import/Dedupe'
import Cleanup from '@/components/import/Cleanup'
import RunSyncNow from '@/components/import/RunSyncNow'

export default function ImportPage() {
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Import Data</h1>
        <p className="text-xs text-slate-600 mt-0.5">Upload CSV/XLSX files from Talexio reports</p>
      </div>

      <TalexioTokenStatus />

      <ImportUpload
        type="clockings"
        title="Clockings / Timesheet"
        description="Upload the Talexio Clockings export (.csv or .xlsx). Multiple sessions per employee per day are aggregated automatically. Malta Office employees not at office → WFH."
      />

      <ImportUpload
        type="leave"
        title="Leave & Sick"
        description="Upload the Talexio Leave/Sick export (.csv or .xlsx). Only approved entries are imported."
      />

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
        <div className="relative flex justify-center">
          <span className="bg-slate-50 px-3 text-xs text-slate-600">Tools</span>
        </div>
      </div>

      <Dedupe />

      <Reclassify />

      <TalexioPull />

      <RunSyncNow />

      <Cleanup />
    </div>
  )
}
