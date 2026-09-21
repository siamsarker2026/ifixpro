'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function TraceRepairHistoryPage() {
  const [imeiInput, setImeiInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [servicesMap, setServicesMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    fetchServices()
  }, [])

  async function fetchServices() {
    const { data } = await supabase.from('services').select('id, name')
    if (data) {
      setServicesMap(new Map(data.map(s => [s.id, s.name])))
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!imeiInput.trim()) return

    setLoading(true)
    setErrorMsg('')
    setHistoryItems([])

    const { data: { user } } = await supabase.auth.getUser()
    const activeUserName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'supportlab1'

    const { data: profilesData } = await supabase.from('profiles').select('*')
    const profileMap: { [key: string]: string } = {}
    if (profilesData) {
      profilesData.forEach((p: any) => {
        const name = p.full_name || p.name || p.email
        if (p.id) profileMap[p.id] = name
        if (p.email) profileMap[p.email] = name
      })
    }

    // Explicit foreign key constraint specified here to fix the multiple relationship error
    const { data, error } = await supabase
      .from('repair_request_items')
      .select(`
        *,
        technicians_vendors!repair_request_items_technician_id_fkey (name, type),
        repair_requests (reference_number, status, created_at, user_id)
      `)
      .eq('imei', imeiInput.trim())
      .order('created_at', { ascending: false })

    if (error) {
      setErrorMsg(error.message)
    } else if (!data || data.length === 0) {
      setErrorMsg('No history found for this IMEI.')
    } else {
      const processed = data.map((item) => {
        const rawAssigned = item.assigned_by || item.repair_requests?.user_id || item.user_id
        const rawReceived = item.received_by

        const resolvedAssigned = profileMap[rawAssigned] || rawAssigned || activeUserName
        const resolvedReceived = profileMap[rawReceived] || rawReceived || '—'

        // Resolve all service IDs from the array or fallback to legacy scalar
        const ids = item.service_ids && item.service_ids.length > 0
          ? item.service_ids
          : (item.service_id ? [item.service_id] : [])

        const serviceNames = ids.map((id: string) => servicesMap.get(id) || 'Unknown Service')

        return {
          ...item,
          resolved_assigned_by: resolvedAssigned,
          resolved_received_by: resolvedReceived,
          service_names: serviceNames
        }
      })
      setHistoryItems(processed)
    }
    setLoading(false)
  }

  const latestItem = historyItems.length > 0 ? historyItems[0] : null

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Trace Repair History</h2>
        <p className="text-sm text-gray-600">Look up complete historical repair logs and event audit trails by IMEI.</p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">
          {errorMsg}
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <form onSubmit={handleSearch} className="flex gap-4">
          <input 
            type="text"
            placeholder="Enter IMEI to trace history..."
            value={imeiInput}
            onChange={(e) => setImeiInput(e.target.value)}
            className="flex-1 bg-white text-gray-900 placeholder:text-gray-400 border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none font-mono text-sm"
          />
          <button 
            type="submit"
            disabled={loading}
            className="bg-slate-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-slate-800 transition text-sm cursor-pointer"
          >
            {loading ? 'Searching...' : 'Trace IMEI'}
          </button>
        </form>
      </div>

      {/* Device Information — Shown Once */}
      {latestItem && (
        <div className="bg-slate-50 border border-slate-200 p-6 rounded-lg shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Device Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
            <div>
              <span className="text-gray-500 block">IMEI</span>
              <span className="font-mono font-bold text-gray-900 text-sm">{latestItem.imei}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Model</span>
              <span className="font-medium text-gray-900 text-sm">{latestItem.model || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Storage</span>
              <span className="font-medium text-gray-900 text-sm">{latestItem.storage_gb ? `${latestItem.storage_gb} GB` : '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Color</span>
              <span className="font-medium text-gray-900 text-sm">{latestItem.color || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Current Status</span>
              <span className="inline-block mt-0.5 px-2.5 py-0.5 rounded-full font-bold text-[11px] bg-slate-200 text-slate-800">
                {latestItem.received_at ? latestItem.current_status : 'Pending'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Repair History Table */}
      {historyItems.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="p-4 border-b bg-gray-50 font-semibold text-sm text-gray-900">
            Repair History Logs ({historyItems.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="border-b bg-gray-50/50 text-gray-900">
                <tr>
                  <th className="p-3 font-semibold">Reference No.</th>
                  <th className="p-3 font-semibold">Technician</th>
                  <th className="p-3 font-semibold">Service / Job Work Bundle</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Rejection Reason</th>
                  <th className="p-3 font-semibold">Assigned By</th>
                  <th className="p-3 font-semibold">Assigned At</th>
                  <th className="p-3 font-semibold">Received By</th>
                  <th className="p-3 font-semibold">Received At</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {historyItems.map((item) => {
                  const actionUser = item.resolved_received_by
                  const actionTime = item.received_at ? new Date(item.received_at).toLocaleString() : '—'

                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="p-3 font-mono font-bold text-gray-900">{item.repair_requests?.reference_number || '—'}</td>
                      <td className="p-3 text-gray-800">{item.technicians_vendors?.name || '—'}</td>
                      <td className="p-3 text-gray-800">
                        <div className="flex flex-wrap gap-1">
                          {item.service_names.map((sName: string, idx: number) => (
                            <span key={idx} className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-[11px] font-semibold">
                              {sName}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          !item.received_at ? 'bg-amber-100 text-amber-800' :
                          item.current_status === 'Repaired' ? 'bg-green-100 text-green-800' :
                          item.current_status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {item.received_at ? item.current_status : 'Pending'}
                        </span>
                      </td>
                      <td className="p-3 text-red-600 font-medium">{item.rejection_reason || '—'}</td>
                      <td className="p-3 font-medium text-gray-900">{item.resolved_assigned_by}</td>
                      <td className="p-3 text-gray-600">
                        {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="p-3 font-medium text-gray-900">{actionUser}</td>
                      <td className="p-3 text-gray-600">{actionTime}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}