'use client'

import Link from 'next/link'
import { 
  Box, 
  Wrench, 
  ClipboardCheck, 
  History, 
  Database, 
  FileText, 
  Settings 
} from 'lucide-react'
import { useAllowedModules } from '@/hooks/useAllowedModules'

export default function DashboardHome() {
  const { canAccess, loading } = useAllowedModules()

  const menuItems = [
    { 
      id: 'box-builder',
      name: 'Box Builder', 
      desc: 'Scan devices into boxes, manage grades, and print labels', 
      href: '/dashboard/box-builder', 
      icon: <Box className="w-6 h-6 text-cyan-600" />, 
      color: 'bg-cyan-50' 
    },
    { 
      id: 'repair-request',
      name: 'Repair Request', 
      desc: 'Create and manage repair orders', 
      href: '/dashboard/repair-request', 
      icon: <Wrench className="w-6 h-6 text-blue-600" />, 
      color: 'bg-blue-50' 
    },
    { 
      id: 'repair-receive',
      name: 'Repair Receive', 
      desc: 'Receive and inspect incoming devices', 
      href: '/dashboard/repair-receive', 
      icon: <ClipboardCheck className="w-6 h-6 text-indigo-600" />, 
      color: 'bg-indigo-50' 
    },
    { 
      id: 'trace-history',
      name: 'Trace Repair History', 
      desc: 'Track history and scan logs', 
      href: '/dashboard/trace-history/imei-history', 
      icon: <History className="w-6 h-6 text-emerald-600" />, 
      color: 'bg-emerald-50' 
    },
    {
      id: 'stock-master',
      name: 'Stock Master',
      desc: 'Bulk-upload your device master Excel file',
      href: '/dashboard/stock-master',
      icon: <Database className="w-6 h-6 text-fuchsia-600" />,
      color: 'bg-fuchsia-50'
    },
    {
      id: 'reports',
      name: 'Reports',
      desc: 'View and download various reports',
      href: '/dashboard/reports',
      icon: <FileText className="w-6 h-6 text-violet-600" />,
      color: 'bg-violet-50'
    },
    {
      id: 'settings',
      name: 'Settings',
      desc: 'Configure your app settings',
      href: '/dashboard/settings',
      icon: <Settings className="w-6 h-6 text-gray-600" />,
      color: 'bg-gray-50'
    },
  ]

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">Loading module permissions...</div>
  }

  // Filter items based on user's assigned role permissions
  const visibleItems = menuItems.filter(item => canAccess(item.id))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">iFix Pro Dashboard</h1>
        <p className="text-sm text-gray-500">Select a module below to get started</p>
      </div>

      {visibleItems.length === 0 ? (
        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm">
          No modules have been assigned to your role. Please contact an administrator.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleItems.map((item) => (
            <Link 
              className="group bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-md hover:border-blue-500/40 transition-all duration-200 flex items-center justify-between" 
              href={item.href} 
              key={item.name}
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
      )}
    </div>
  )
}