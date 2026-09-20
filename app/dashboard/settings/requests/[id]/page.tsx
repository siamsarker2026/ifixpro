'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function TechnicianRepairItemsDetailPage() {
  const params = useParams()
  const router = useRouter()
  const technicianId = params.id as string

  const [technicianData, setTechnicianData] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [servicesMap, setServicesMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (technicianId) {
      fetchTechnicianDetails()
    }
  }, [technicianId])

  async function fetchTechnicianDetails() {
    setLoading(true)

    // 1. Fetch all active services for multi-service mapping
    const { data: servData } = await supabase.from('services').select('id, name')
    const sMap = new Map<string, string>()
    if (servData) {
      servData.forEach((s: any) => sMap.set(s.id, s.name))
    }
    setServicesMap(sMap)

    // 2. Fetch technician details
    const { data: techData, error: techError } = await supabase
      .from('technicians_vendors')
      .select('*')
      .eq('id', technicianId)
      .single()

    if (techError) {
      setErrorMsg(techError.message)
      setLoading(false)
      return
    }

    setTechnicianData(techData)

    // 3. Fetch items grouped by technician_id
    const { data: itemData, error: itemError } = await supabase
      .from('repair_request_items')
      .select(`
        *,
        technicians_vendors (name, type)
      `)
      .eq('technician_id', technicianId)
      .order('created_at', { ascending: false })

    if (itemError) {
      setErrorMsg(itemError.message)
    } else {
      const processedItems = (itemData || []).map((item) => {
        const ids = item.service_ids || []
        const serviceNames = ids.map((id: string) => sMap.get(id) || 'Unknown Service')
        return {
          ...item,
          serviceNames
        }
      })
      setItems(processedItems)
    }

    setLoading(false)
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-500">Loading technician items...</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex justify-between items-center">
        <div>
          <button
            onClick={() => router.back()}
            className="text-xs text-slate-600 hover:text-slate-900 underline font-medium cursor-pointer mb-2 block"
          >
            ← Back
          </button>
          <h2 className="text-xl font-bold text-gray-800">
            Technician: <span className="text-slate-900">{technicianData?.name}</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Type: {technicianData?.type}</p>
        </div>
        <span className="bg-slate-900 text-white text-xs px-3 py-1 rounded-full font-bold">
          Total Assigned: {items.length}
        </span>
      </div>

      {errorMsg && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg border text-sm">
          Error: {errorMsg}
        </div>
      )}

      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-gray-900 text-sm">Assigned Items & Service Bundles</h3>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No scanned items found for this technician.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3 font-medium text-gray-600">IMEI</th>
                <th className="p-3 font-medium text-gray-600">Model / Specs</th>
                <th className="p-3 font-medium text-gray-600">Services</th>
                <th className="p-3 font-medium text-gray-600">Status</th>
                <th className="p-3 font-medium text-gray-600">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono text-xs">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="p-3 font-bold text-gray-900">{item.imei}</td>
                  <td className="p-3 font-sans text-gray-700">
                    {item.model} ({item.storage_gb}GB, {item.color})
                  </td>
                  <td className="p-3 font-sans">
                    <div className="flex flex-wrap gap-1">
                      {item.serviceNames.map((s: string, i: number) => (
                        <span key={i} className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-[11px] font-semibold">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-sans font-semibold">
                      {item.current_status}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500 font-sans">
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}