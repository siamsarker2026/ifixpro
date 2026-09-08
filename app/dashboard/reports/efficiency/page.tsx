'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function DailyWorkEfficiencyPage() {
  const [stats, setStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchEfficiency() {
      setLoading(true)
      const { data, error } = await supabase
        .from('repair_request_items')
        .select(`
          id,
          current_status,
          technicians_vendors (name)
        `)

      if (!error && data) {
        // Group by technician
        const map: { [key: string]: { name: string; total: number; repaired: number } } = {}
        data.forEach((item: any) => {
          const techName = item.technicians_vendors?.name || 'Unknown'
          if (!map[techName]) {
            map[techName] = { name: techName, total: 0, repaired: 0 }
          }
          map[techName].total += 1
          if (item.current_status === 'Repaired') {
            map[techName].repaired += 1
          }
        })
        setStats(Object.values(map))
      }
      setLoading(false)
    }

    fetchEfficiency()
  }, [])

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Daily Work Efficiency</h2>
        <p className="text-sm text-gray-600">Track technician output, completed repairs, and overall efficiency ratios.</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-sm text-gray-500">Loading efficiency metrics...</p>
        ) : stats.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No repair activity recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3 font-medium text-gray-900">Technician / Vendor</th>
                <th className="p-3 font-medium text-gray-900">Total Assigned</th>
                <th className="p-3 font-medium text-gray-900">Repaired</th>
                <th className="p-3 font-medium text-gray-900">Efficiency Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.map((st, idx) => {
                const rate = st.total > 0 ? Math.round((st.repaired / st.total) * 100) : 0
                return (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="p-3 font-medium text-gray-900">{st.name}</td>
                    <td className="p-3 text-gray-800">{st.total}</td>
                    <td className="p-3 text-green-700 font-semibold">{st.repaired}</td>
                    <td className="p-3 font-bold text-gray-900">
                      <span className="bg-slate-100 px-2 py-1 rounded text-xs">{rate}%</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}