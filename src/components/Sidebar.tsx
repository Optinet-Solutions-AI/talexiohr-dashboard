'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Settings,
  ClipboardList,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard',  href: '/dashboard',            icon: LayoutDashboard },
  { label: 'Attendance', href: '/dashboard/attendance',  icon: ClipboardList   },
  { label: 'Compliance', href: '/dashboard/compliance',  icon: ShieldCheck     },
  { label: 'Employees',  href: '/dashboard/employees',   icon: Users           },
  { label: 'Leave',      href: '/dashboard/leave',       icon: CalendarDays    },
  { label: 'Settings',   href: '/dashboard/settings',    icon: Settings        },
]

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="mb-8 px-3">
        <span className="text-base font-bold text-white tracking-tight">HR Dashboard</span>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/15 text-white'
                  : 'text-indigo-200 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={16} className={active ? 'text-white' : 'text-indigo-300'} />
              {label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-indigo-950 flex items-center px-4">
        <button onClick={() => setOpen(true)} className="p-1.5 -ml-1.5 text-indigo-200">
          <Menu size={20} />
        </button>
        <span className="ml-3 text-sm font-bold text-white tracking-tight">HR Dashboard</span>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="relative w-64 h-full bg-indigo-950 py-6 px-4 flex flex-col">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-indigo-300 hover:text-white"
            >
              <X size={18} />
            </button>
            <NavContent pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col bg-indigo-950 py-6 px-4 shrink-0">
        <NavContent pathname={pathname} />
      </aside>
    </>
  )
}
