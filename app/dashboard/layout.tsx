'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAllowedModules } from '@/hooks/useAllowedModules'
import { moduleForPath } from '@/lib/modules'
import CrackedScreenIcon from '@/components/CrackedScreenIcon'

// module: null = every signed-in user sees it
type NavItem = { href: string; module: string | null; label: React.ReactNode }
type NavSection = { title: string; items: NavItem[] }

const linkClass = 'block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300'

const NAV: NavSection[] = [
  {
    title: 'Inventory & Boxes',
    items: [
      { href: '/dashboard/box-builder', module: 'box-builder', label: <><span>📦</span> Box Builder</> },
      { href: '/dashboard/parts', module: 'parts', label: <><span>⚙️</span> Parts Inventory</> },
    ],
  },
  {
    title: 'Repair',
    items: [
      { href: '/dashboard/repair-request', module: 'repair-request', label: 'Repair Request' },
      { href: '/dashboard/repair-receive', module: 'repair-receive', label: 'Repair Receive' },
      { href: '/dashboard/trace-history', module: 'trace-history', label: 'Trace Repair History' },
      { href: '/dashboard/stock-master', module: 'stock-master', label: 'Stock Master' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { href: '/dashboard/reports/efficiency', module: 'reports/efficiency', label: 'Daily Work Efficiency' },
      { href: '/dashboard/reports/diagnostics-report', module: 'reports/diagnostics-report', label: 'Diagnostics Report' },
      { href: '/dashboard/reports/damage-parts', module: 'reports/damage-parts', label: <><CrackedScreenIcon className="w-4 h-4 text-red-400 shrink-0" /> Damage Parts</> },
      { href: '/dashboard/reports/requests', module: 'reports/requests', label: 'Repair Request Lists' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { href: '/dashboard/settings/technicians', module: 'settings/technicians', label: 'Technicians / Vendors' },
      { href: '/dashboard/settings/services', module: 'settings/services', label: 'Services' },
      { href: '/dashboard/settings/targets', module: 'settings/targets', label: 'Daily Target' },
      { href: '/dashboard/settings/users', module: 'settings/users', label: 'User Access Management' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/dashboard/account', module: null, label: <><span>👤</span> My Account</> },
    ],
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isHome = pathname === '/dashboard'
  const { canAccess, loading: accessLoading } = useAllowedModules()
  const pageModule = moduleForPath(pathname)
  const pageAllowed = pageModule === null || canAccess(pageModule)

  const [userName, setUserName] = useState('Loading...')
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    async function fetchUserProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email || '')
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single()

        if (profile?.full_name) {
          setUserName(profile.full_name)
        } else {
          setUserName(user.email?.split('@')[0] || 'User')
        }
      }
    }
    fetchUserProfile()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Left Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col border-r border-slate-800">
        <div className="p-5 border-b border-slate-800">
          <h1 className="font-bold text-lg tracking-tight">iFix Pro</h1>
          <p className="text-xs text-slate-400">Repair Management System</p>
        </div>

        {/* Navigation Controls: Back & Home Buttons */}
        <div className="p-4 border-b border-slate-800 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            title="Go Back"
          >
            ← Back
          </button>
          {!isHome && (
            <Link
              href="/dashboard"
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white py-2 px-3 rounded-lg text-xs font-medium transition-colors"
              title="Dashboard Home"
            >
              🏠 Home
            </Link>
          )}
        </div>

        {/* Sidebar links: only modules this user's role may open */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 text-sm">
          {!accessLoading && NAV.map((section, i) => {
            const items = section.items.filter(item => item.module === null || canAccess(item.module))
            if (items.length === 0) return null
            return (
              <div key={section.title}>
                <div className={`text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3 ${i > 0 ? 'mt-6' : ''}`}>
                  {section.title}
                </div>
                {items.map(item => (
                  <Link key={item.href} href={item.href} className={`${linkClass} font-medium flex items-center gap-2`}>
                    {item.label}
                  </Link>
                ))}
              </div>
            )
          })}
        </div>

        {/* User Profile Footer Widget & Logout */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
          <Link href="/dashboard/account" title="My Account" className="flex items-center space-x-3 overflow-hidden rounded-lg hover:opacity-80">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate">{userName}</p>
              <p className="text-[10px] text-slate-400 truncate">{userEmail}</p>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Logout"
          >
            ⎋
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-8">
        {accessLoading ? (
          <div className="text-sm text-gray-500">Checking permissions...</div>
        ) : pageAllowed ? (
          children
        ) : (
          <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-semibold max-w-2xl mx-auto mt-8">
            Access Denied: your role does not have access to this page. Please contact an administrator.
          </div>
        )}
      </main>
    </div>
  )
}