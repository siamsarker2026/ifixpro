'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isHome = pathname === '/dashboard'

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
          .eq('uuid', user.id)
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

        {/* Existing Sidebar Links / Menu */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 text-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3">Repair</div>
          <Link href="/dashboard/repair-request" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Repair Request</Link>
          <Link href="/dashboard/repair-receive" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Repair Receive</Link>
          <Link href="/dashboard/trace-history" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Trace Repair History</Link>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-6 mb-2 px-3">Reports</div>
          <Link href="/dashboard/reports/efficiency" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Daily Work Efficiency</Link>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-6 mb-2 px-3">Settings</div>
          <Link href="/dashboard/settings/technicians" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Technicians / Vendors</Link>
          <Link href="/dashboard/settings/services" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Services</Link>
          <Link href="/dashboard/settings/requests" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Repair Request Lists</Link>
          <Link href="/dashboard/settings/targets" className="block py-2 px-3 rounded-lg hover:bg-slate-800 text-slate-300">Daily Target</Link>
        </div>

        {/* User Profile Footer Widget & Logout */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate">{userName}</p>
              <p className="text-[10px] text-slate-400 truncate">{userEmail}</p>
            </div>
          </div>
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
        {children}
      </main>
    </div>
  )
}