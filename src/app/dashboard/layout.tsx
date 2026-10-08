import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import SyncHealthBanner from '@/components/SyncHealthBanner'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // The proxy already gates /dashboard, but Server Functions bypass matcher
  // changes silently, so the layout verifies the session as well.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (user.app_metadata?.must_change_password === true) redirect('/change-password')

  const role = user.app_metadata?.role === 'admin' ? 'admin' : 'user'

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar user={{ email: user.email ?? '', role }} />
      {/* pt-14 on mobile for the fixed top bar, lg:pt-0 on desktop */}
      <main className="flex-1 overflow-y-auto px-4 py-6 pt-20 lg:pt-6 lg:px-8">
        <SyncHealthBanner />
        {children}
      </main>
    </div>
  )
}
