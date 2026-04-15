'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/dashboard/actions'
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Wallet,
  Settings,
  ClipboardList,
  LogOut,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard',  href: '/dashboard',            icon: LayoutDashboard },
  { label: 'Attendance', href: '/dashboard/attendance', icon: ClipboardList   },
  { label: 'Employees',  href: '/dashboard/employees',  icon: Users           },
  { label: 'Leave',      href: '/dashboard/leave',      icon: CalendarDays    },
  { label: 'Payroll',    href: '/dashboard/payroll',    icon: Wallet          },
  { label: 'Settings',   href: '/dashboard/settings',   icon: Settings        },
]

export default function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()

  return (
    <aside className="w-60 flex flex-col bg-white border-r border-gray-200 py-6 px-4">
      <div className="mb-8 px-2">
        <span className="text-lg font-bold text-gray-900">Talexio HR</span>
        <p className="text-xs text-gray-400 mt-0.5">Dashboard</p>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon size={16} className={active ? 'text-blue-600' : 'text-gray-400'} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-gray-200 pt-4 mt-4">
        <p className="text-xs text-gray-400 px-2 mb-3 truncate">{userEmail}</p>
        <form action={logout}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut size={16} className="text-gray-400" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
