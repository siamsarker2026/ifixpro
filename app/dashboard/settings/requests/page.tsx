'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function RepairRequestListPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    fetchRequests()
  }, [])

  async function fetchRequests() {
    setLoading(true)
    setErrorMsg('')

    // 1. Fetch all repair requests with their items joined safely
    const { data: reqs, error: reqError } = await supabase
      .from('repair_requests')
      .select(`
        *,
        repair_request_items (
          id,
          received_at,
          current_status,
          imei
        )
      `)
      .order('created_at', { ascending: false })

    if (reqError) {
      console.error('Error fetching repair requests:', reqError)
      setErrorMsg(reqError.message)
      setLoading(false)
      return
    }

    if (!reqs || reqs.length === 0) {
      setRequests([])
      setLoading(false)
      return
    }

    // 2. Resolve user full names from profiles table where id matches user_id
    const userIds = Array.from(new Set(reqs.map(r => r.user_id).filter(Boolean)))
    const profileMap = new Map<string, string>()

    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)

      profilesData?.forEach(p => {
        const name = p.full_name || (p.email ? p.email.split('@')[0] : 'User')
        profileMap.set(p.id, name)
      })
    }

    // 3. Map precise metrics: Assigned, Repaired, Rejection, Pending
    const formatted = reqs.map(r => {
      const items = r.repair_request_items || []
      let repairedCount = 0
      let rejectionCount = 0
      let pendingCount = 0

      items.forEach((item: any) => {
        const status = (item.current_status || '').trim().toLowerCase()
        if (status === 'repaired') {
          repairedCount += 1
        } else if (status === 'rejected' || status === 'rejection') {
          rejectionCount += 1
        } else {
          pendingCount += 1
        }
      })

      const creatorName = profileMap.get(r.user_id) || 'System User'

      return {
        ...r,
        total_assigned: items.length,
        total_repaired: repairedCount,
        total_rejection: rejectionCount,
        total_pending: pendingCount,
        creator_name: creatorName
      }
    })

    setRequests(formatted)
    setLoading(false)
  }

  // Filter and search logic (supports reference no, creator name, or item IMEI)
  const filteredRequests = requests.filter(req => {
    const query = searchQuery.toLowerCase().trim()
    
    const matchesMain = req.reference_number.toLowerCase().includes(query) ||
                        req.creator_name.toLowerCase().includes(query)
                        
    const matchesItem = req.repair_request_items?.some((item: any) => 
      item.imei && item.imei.toLowerCase().includes(query)
    )

    const matchesSearch = !query || matchesMain || matchesItem
    
    if (statusFilter === 'ALL') return matchesSearch
    return matchesSearch && req.status.toUpperCase() === statusFilter.toUpperCase()
  })

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6 text-center text-sm text-gray-500">
        Loading Repair Requests List...
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6">
      {/* Header Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Repair Request Lists</h2>
          <p className="text-xs text-gray-500 mt-1">
            View and manage all submitted repair orders (Open & Closed).
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">
          Database Error: {errorMsg}
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-wrap gap-4 items-center justify-between">
        <div className="flex-1 min-w-[260px]">
          <input
            type="text"
            placeholder="Search by Reference No, Creator, or Device IMEI..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600">Filter Status:</span>
          {['ALL', 'OPEN', 'CLOSED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
          <h3 className="font-bold text-gray-900 text-sm">All Batches Record</h3>
          <span className="bg-slate-900 text-white text-xs px-2.5 py-0.5 rounded-full font-semibold">
            {filteredRequests.length} Requests Found
          </span>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No matching repair requests found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-gray-100 border-b text-gray-700 uppercase font-semibold">
                <tr>
                  <th className="p-4">Reference No</th>
                  <th className="p-4">Created By</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Total Assigned</th>
                  <th className="p-4 text-center">Total Repaired</th>
                  <th className="p-4 text-center">Total Rejection</th>
                  <th className="p-4 text-center">Total Pending</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRequests.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/dashboard/settings/requests/${req.id}`)}
                  >
                    <td className="p-4 font-mono font-bold text-slate-900 text-sm">
                      {req.reference_number}
                    </td>
                    <td className="p-4 font-medium text-gray-900">
                      {req.creator_name}
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        req.status === 'OPEN'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="p-4 text-center font-bold text-slate-900 font-mono">
                      {req.total_assigned}
                    </td>
                    <td className="p-4 text-center font-bold text-emerald-700 font-mono">
                      {req.total_repaired}
                    </td>
                    <td className="p-4 text-center font-bold text-rose-600 font-mono">
                      {req.total_rejection}
                    </td>
                    <td className="p-4 text-center font-bold text-amber-600 font-mono">
                      {req.total_pending}
                    </td>
                    <td className="p-4 text-right">
                      <span className="text-xs text-slate-900 font-semibold hover:underline">
                        View Details →
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}