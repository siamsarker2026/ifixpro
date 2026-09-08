'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

export default function RepairRequestDetailPage() {
  const params = useParams()
  const router = useRouter()
  const requestId = params.id as string

  const [requestData, setRequestData] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [servicesMap, setServicesMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (requestId) {
      fetchRequestDetails()
    }
  }, [requestId])

  async function fetchRequestDetails() {
    setLoading(true)

    // 1. Fetch all active services for multi-service mapping
    const { data: servData } = await supabase.from('services').select('id, name')
    const sMap = new Map<string, string>()
    if (servData) {
      servData.forEach((s: any) => sMap.set(s.id, s.name))
    }
    setServicesMap(sMap)

    // 2. Fetch all profiles to build a reliable lookup map
    const { data: profiles } = await supabase.from('profiles').select('*')
    const profileMap: { [key: string]: string } = {}
    
    let fallbackName = 'supportlab1'
    if (profiles) {
      profiles.forEach((p: any) => {
        const name = p.full_name || p.name || p.email
        if (p.id) profileMap[p.id] = name
        if (p.email) profileMap[p.email] = name
        if (p.email === 'supportlab1@gmail.com' || p.full_name === 'supportlab1') {
          fallbackName = name
        }
      })
    }

    const { data: reqData, error: reqError } = await supabase
      .from('repair_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (reqError) {
      setErrorMsg(reqError.message)
      setLoading(false)
      return
    }

    setRequestData(reqData)

    const { data: itemData, error: itemError } = await supabase
      .from('repair_request_items')
      .select(`
        *,
        technicians_vendors (name, type)
      `)
      .eq('repair_request_id', requestId)
      .order('created_at', { ascending: true })

    if (itemError) {
      setErrorMsg(itemError.message)
    } else {
      const processedItems = (itemData || []).map((item) => {
        const rawAssigned = item.assigned_by || item.user_id
        const rawReceived = item.received_by

        const resolvedAssigned = profileMap[rawAssigned] || (rawAssigned?.includes('@') ? profileMap[rawAssigned] : null) || fallbackName
        const resolvedReceived = profileMap[rawReceived] || (rawReceived?.includes('@') ? profileMap[rawReceived] : null) || '—'

        // Resolve service IDs array exclusively using service_ids
        const ids = item.service_ids && item.service_ids.length > 0 ? item.service_ids : []
        const serviceNames = ids.map((id: string) => sMap.get(id) || 'Unknown Service')

        return {
          ...item,
          resolved_assigned_by: resolvedAssigned,
          resolved_received_by: resolvedReceived,
          service_names: serviceNames
        }
      })
      setItems(processedItems)
    }

    setLoading(false)
  }

  const techMap: { [key: string]: any } = {}
  items.forEach((item) => {
    const techName = item.technicians_vendors?.name || 'Unassigned'
    if (!techMap[techName]) {
      techMap[techName] = {
        name: techName,
        totalGiven: 0,
        repaired: 0,
        reworked: 0,
        opened: 0,
        checked: 0,
        closed: 0,
        rejected: 0,
        pending: 0
      }
    }
    techMap[techName].totalGiven += 1
    if (!item.received_at) {
      techMap[techName].pending += 1
    } else {
      const st = item.current_status
      if (st === 'Repaired') techMap[techName].repaired += 1
      else if (st === 'Reworked') techMap[techName].reworked += 1
      else if (st === 'Opened') techMap[techName].opened += 1
      else if (st === 'Checked') techMap[techName].checked += 1
      else if (st === 'Closed') techMap[techName].closed += 1
      else if (st === 'Rejected') techMap[techName].rejected += 1
      else techMap[techName].repaired += 1
    }
  })
  const techSummaryList = Object.values(techMap)

  const pivotMap: { [key: string]: any } = {}
  items.forEach((item) => {
    const model = item.model || 'Unknown Model'
    const gb = item.storage_gb ? `${item.storage_gb}GB` : 'N/A'
    const color = item.color || 'N/A'
    const key = `${model}_${gb}_${color}`

    if (!pivotMap[key]) {
      pivotMap[key] = { model, gb, color, totalQuantity: 0, repaired: 0, rejected: 0, pending: 0 }
    }
    pivotMap[key].totalQuantity += 1
    if (!item.received_at) pivotMap[key].pending += 1
    else if (item.current_status === 'Rejected') pivotMap[key].rejected += 1
    else pivotMap[key].repaired += 1
  })
  const pivotList = Object.values(pivotMap)

  const handleDownloadPivotPDF = async () => {
    const jsPDFModule = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    
    const doc = new jsPDFModule.default()
    doc.setFontSize(16)
    doc.text(`Model, GB & Color Pivot - ${requestData.reference_number}`, 14, 20)

    const tableColumns = ['Model', 'GB', 'Color', 'Total Quantity', 'Repaired', 'Rejected', 'Pending']
    const tableRows = pivotList.map((item: any) => [
      item.model,
      item.gb,
      item.color,
      item.totalQuantity,
      item.repaired,
      item.rejected,
      item.pending
    ])

    autoTable(doc, {
      startY: 28,
      head: [tableColumns],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
    })

    doc.output('dataurlnewwindow')
  }

  const handleExportExcel = () => {
    const exportData = items.map((item) => ({
      'Reference Number': requestData.reference_number,
      'IMEI': item.imei,
      'Model': item.model,
      'Storage (GB)': item.storage_gb,
      'Color': item.color,
      'Assigned By': item.resolved_assigned_by,
      'Technician / Vendor': item.technicians_vendors?.name || '',
      'Service / Job Work Bundle': item.service_names.join(', '),
      'Status': item.received_at ? item.current_status : 'Pending',
      'Assigned At': item.created_at ? new Date(item.created_at).toLocaleString() : '',
      'Received At': item.received_at ? new Date(item.received_at).toLocaleString() : '',
      'Received By': item.resolved_received_by,
      'Rejection Reason': item.rejection_reason || ''
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Repair Request Items')
    XLSX.writeFile(workbook, `${requestData.reference_number}_items.xlsx`)
  }

  const handleDownloadTechnicianPDF = async () => {
    const jsPDFModule = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    
    const doc = new jsPDFModule.default()
    doc.setFontSize(16)
    doc.text(`Technician Summary - ${requestData.reference_number}`, 14, 20)

    const tableColumns = ['Technician', 'Total Given', 'Repaired', 'Reworked', 'Opened', 'Checked', 'Closed', 'Rejected', 'Pending']
    const tableRows = techSummaryList.map((t: any) => [
      t.name,
      t.totalGiven,
      t.repaired,
      t.reworked,
      t.opened,
      t.checked,
      t.closed,
      t.rejected,
      t.pending
    ])

    autoTable(doc, {
      startY: 28,
      head: [tableColumns],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [39, 174, 96] },
    })

    doc.output('dataurlnewwindow')
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-500">Loading request details...</div>
  }

  if (errorMsg || !requestData) {
    return (
      <div className="max-w-4xl space-y-4 p-6">
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">
          {errorMsg || 'Request not found.'}
        </div>
        <button
          onClick={() => router.back()}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
        >
          ← Back to Lists
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-6 rounded-lg shadow-sm border">
        <div>
          <button
            onClick={() => router.back()}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 mb-2 inline-block cursor-pointer"
          >
            ← Back to Request Lists
          </button>
          <h2 className="text-xl font-bold text-gray-900 font-mono">
            Reference: {requestData.reference_number}
          </h2>
          <p className="text-xs text-gray-500">Detailed overview of batch session items and technician summary.</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
          requestData.status === 'OPEN' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
        }`}>
          {requestData.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl shadow-sm border">
        <button onClick={handleDownloadPivotPDF} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow text-sm cursor-pointer">
          📄 Pivot Breakdown PDF
        </button>
        <button onClick={handleExportExcel} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow text-sm cursor-pointer">
          📊 Export Full Request Excel
        </button>
        <button onClick={handleDownloadTechnicianPDF} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow text-sm cursor-pointer">
          📑 Technician Summary PDF
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h3 className="font-bold text-gray-900 text-sm">Assigned Repair Items ({items.length})</h3>
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No items found for this repair request.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-gray-100 border-b text-gray-900">
                <tr>
                  <th className="p-3 font-semibold">IMEI</th>
                  <th className="p-3 font-semibold">Model</th>
                  <th className="p-3 font-semibold">GB</th>
                  <th className="p-3 font-semibold">Color</th>
                  <th className="p-3 font-semibold">Assigned By</th>
                  <th className="p-3 font-semibold">Technician / Vendor</th>
                  <th className="p-3 font-semibold">Service / Job Work Bundle</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Assigned At</th>
                  <th className="p-3 font-semibold">Received At</th>
                  <th className="p-3 font-semibold">Received By</th>
                  <th className="p-3 font-semibold">Rejection Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="p-3 font-mono font-bold text-gray-900">{item.imei}</td>
                    <td className="p-3 text-gray-800">{item.model || '—'}</td>
                    <td className="p-3 text-gray-800">{item.storage_gb ? `${item.storage_gb}GB` : '—'}</td>
                    <td className="p-3 text-gray-800">{item.color || '—'}</td>
                    <td className="p-3 font-medium text-gray-900">{item.resolved_assigned_by}</td>
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
                    <td className="p-3 text-gray-600">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 text-gray-600">
                      {item.received_at ? new Date(item.received_at).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 font-medium text-gray-900">{item.resolved_received_by}</td>
                    <td className="p-3 text-red-600 font-medium">{item.rejection_reason || '—'}</td>
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