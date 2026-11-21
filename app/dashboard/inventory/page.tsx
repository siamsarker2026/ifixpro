'use client'

import Link from 'next/link'
import { Box, Cpu } from 'lucide-react'
import { useAllowedModules } from '@/hooks/useAllowedModules'
import { moduleForPath } from '@/lib/modules'

// Hub for the Inventory & Boxes modules. Each card keeps its own module
// permission (box-builder, parts), so a role only sees what it was granted.
const inventoryModules = [
  {
    title: 'Box Builder',
    description: 'Scan devices into boxes, manage grades, and print labels',
    href: '/dashboard/box-builder',
    icon: Box,
    iconBg: 'bg-cyan-100 text-cyan-600',
  },
  {
    title: 'Parts Inventory',
    description: 'Track spare parts stock, usage and balances',
    href: '/dashboard/parts',
    icon: Cpu,
    iconBg: 'bg-orange-100 text-orange-600',
  },
]

export default function InventoryPage() {
  const { canAccess, loading } = useAllowedModules()
  if (loading) return <div className="p-8 text-sm text-gray-500">Loading...</div>

  const visible = inventoryModules.filter(item => {
    const mod = moduleForPath(item.href)
    return mod === null || canAccess(mod)
  })

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory &amp; Boxes</h1>
        <p className="text-sm text-gray-500 mt-1">Select a module below</p>
      </div>

      {visible.length === 0 ? (
        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm">
          No inventory modules have been assigned to your role. Please contact an administrator.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visible.map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between p-6 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 group"
              >
                <div className="flex items-center space-x-4">
                  <div className={`p-3 rounded-lg ${item.iconBg}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
                  </div>
                </div>
                <span className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all">›</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
