import Sidebar from '@/components/Sidebar'
import SyncHealthBanner from '@/components/SyncHealthBanner'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      {/* pt-14 on mobile for the fixed top bar, lg:pt-0 on desktop */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pt-20 lg:pt-6 lg:px-8">
        <SyncHealthBanner />
        {children}
      </main>
    </div>
  )
}
