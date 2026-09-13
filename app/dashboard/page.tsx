'use client'

import Link from 'next/link'

export default function DashboardHome() {
  const menuItems = [
    { 
      name: 'Box Builder', 
      desc: 'Scan devices into boxes, manage grades, and print labels', 
      href: '/dashboard/box-builder', 
      icon: (
        <svg className="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
      ), 
      color: 'bg-cyan-50' 
    },
    { 
      name: 'Repair Request', 
      desc: 'Create and manage repair orders', 
      href: '/dashboard/repair-request', 
      icon: (
        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
      ), 
      color: 'bg-blue-50' 
    },
    { 
      name: 'Repair Receive', 
      desc: 'Receive and inspect incoming devices', 
      href: '/dashboard/repair-receive', 
      icon: (
        <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
      ), 
      color: 'bg-indigo-50' 
    },
    { 
      name: 'Trace Repair History', 
      desc: 'Track history and scan logs', 
      href: '/dashboard/trace-history', 
      icon: (
        <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      ), 
      color: 'bg-emerald-50' 
    },
    { 
      name: 'Daily Work Efficiency', 
      desc: 'Monitor daily output and performance', 
      href: '/dashboard/reports/efficiency', 
      icon: (
        <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
      ), 
      color: 'bg-amber-50' 
    },
    { 
      name: 'Technicians / Vendors', 
      desc: 'Manage staff and teams', 
      href: '/dashboard/settings/technicians', 
      icon: (
        <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
      ), 
      color: 'bg-purple-50' 
    },
    { 
      name: 'Services', 
      desc: 'Configure repair services list', 
      href: '/dashboard/settings/services', 
      icon: (
        <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
      ), 
      color: 'bg-rose-50' 
    },
    { 
      name: 'Repair Request Lists', 
      desc: 'View all submitted requests', 
      href: '/dashboard/settings/requests', 
      icon: (
        <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
      ), 
      color: 'bg-sky-50' 
    },
    { 
      name: 'Daily Target', 
      desc: 'Configure work hours and targets', 
      href: '/dashboard/settings/targets', 
      icon: (
        <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      ), 
      color: 'bg-teal-50' 
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">iFix Pro Dashboard</h1>
        <p className="text-sm text-gray-500">Select a module below to get started</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {menuItems.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className="group bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-md hover:border-blue-500/40 transition-all duration-200 flex items-center justify-between"
          >
            <div className="flex items-center space-x-4">
              <div className={`p-3 rounded-xl ${item.color} group-hover:scale-105 transition-transform`}>
                {item.icon}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-base group-hover:text-blue-600 transition-colors">
                  {item.name}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </div>
            <span className="text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all text-lg font-light pr-1">
              ›
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}