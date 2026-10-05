'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Asia/Dubai is a fixed UTC+4 offset (no DST), so the day boundary in Dubai
// local time can be computed as a constant offset from UTC without a TZ lib.
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000

function getDubaiDayRangeUTC(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number)
  // Midnight in Dubai for the given date, expressed as a UTC instant.
  const startUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - DUBAI_OFFSET_MS)
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000)
  return { startISO: startUTC.toISOString(), endISO: endUTC.toISOString() }
}

function shiftDateStr(dateStr: string, deltaDays: number) {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().split('T')[0]
}

export default function DailyTechnicianStockPage() {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [technicians, setTechnicians] = useState<any[]>([])
  const [stockRecords, setStockRecords] = useState<any[]>([])
  const [prevStockMap, setPrevStockMap] = useState<Map<string, any>>(new Map())
  const [dateItems, setDateItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // True only until the first successful fetch — after that, refetches
  // (date change, Verify, Lock Day) happen quietly in the background
  // instead of unmounting the whole page behind a blank loading screen.
  const [initialLoading, setInitialLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>('ALL')
  // Bulk Remarks/Brand tool: tick rows in the list below, type one note,
  // apply it to all ticked rows at once — for fixing/adding remarks after
  // the fact, without opening each row individually.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [bulkRemarksText, setBulkRemarksText] = useState('')
  const [savingRemarks, setSavingRemarks] = useState(false)
  // Rows shown in the Repair Request List: IMEIs assigned on the selected day
  // PLUS IMEIs carried over (still with the technician when the day started).
  // `dateItems` stays "assigned on the selected day only" because the stock
  // matrix uses it to count newly-given phones.
  const [listItems, setListItems] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [selectedDate])

  async function fetchData() {
    setLoading(true)
    setErrorMsg('')

    const prevDate = new Date(new Date(selectedDate).getTime() - 86400000).toISOString().split('T')[0]
    const { startISO, endISO } = getDubaiDayRangeUTC(selectedDate)
    const itemColumns = `*, repair_requests (user_id)`

    // None of these queries depend on each other's results, so run them all
    // as one round trip instead of six sequential ones — this is most of
    // where the "everything goes blank and takes a while" time was going.
    const [
      { data: techData, error: techError },
      { data: profilesData },
      { data: servicesData },
      { data: prevStockData },
      { data: stockData, error: stockError },
      { data: itemsData, error: itemsError },
      { data: carriedData, error: carriedError }
    ] = await Promise.all([
      supabase.from('technicians_vendors').select('id, name, type').order('name', { ascending: true }),
      supabase.from('profiles').select('*'),
      supabase.from('services').select('id, name'),
      supabase.from('daily_technician_stock').select('*').eq('stock_date', prevDate),
      supabase.from('daily_technician_stock').select('*').eq('stock_date', selectedDate),
      supabase.from('repair_request_items').select(itemColumns).gte('created_at', startISO).lt('created_at', endISO),
      // Carried over: assigned BEFORE this day and still with the technician
      // when the day started (never received, or received on/after the day
      // started).
      supabase.from('repair_request_items').select(itemColumns)
        .lt('created_at', startISO)
        .or(`received_at.is.null,received_at.gte.${startISO}`)
    ])

    if (techError) {
      setErrorMsg(techError.message)
      setLoading(false)
      setInitialLoading(false)
      return
    }
    const techs = techData || []
    setTechnicians(techs)
    const techMap = new Map(techs.map(t => [t.id, t]))

    const profileMap: { [key: string]: string } = {}
    if (profilesData) {
      profilesData.forEach((p: any) => {
        const name = p.full_name || p.name || p.email
        if (p.id) profileMap[p.id] = name
        // profiles may link to auth users via `uuid` rather than `id`
        // (see dashboard/layout.tsx) — index both defensively.
        if (p.uuid) profileMap[p.uuid] = name
        if (p.email) profileMap[p.email] = name
      })
    }

    // Service names: repair_request_items.service_ids is an array of UUIDs.
    const serviceMap = new Map((servicesData || []).map((s: any) => [s.id, s.name]))

    setPrevStockMap(new Map((prevStockData || []).map(s => [s.technician_id, s])))

    if (stockError) {
      setErrorMsg(stockError.message)
    }
    setStockRecords(stockData || [])

    const endMs = new Date(endISO).getTime()

    // Resolve one row "as of the END of the selected Dubai day". A receive that
    // happens after that moment must not change this day's list — it belongs to
    // the day it actually happened on.
    const processItem = (item: any) => {
      const rawAssigned = item.assigned_by || item.repair_requests?.user_id || item.user_id
      const rawReceived = item.received_by
      const receivedAsOf = !!item.received_at && new Date(item.received_at).getTime() < endMs

      // Never fall back to the currently logged-in user for a historical
      // audit field, and never leak a raw UUID into the UI.
      const resolvedAssigned = rawAssigned ? (profileMap[rawAssigned] || 'Unknown User') : 'Unknown User'
      const resolvedReceived = receivedAsOf
        ? (rawReceived ? (profileMap[rawReceived] || 'Unknown User') : 'Unknown User')
        : '—'

      const serviceIds: string[] = item.service_ids || []
      const resolvedServices = serviceIds.length > 0
        ? serviceIds.map((id: string) => serviceMap.get(id) || 'Unknown Service').join(' + ')
        : '—'

      return {
        ...item,
        technicians_vendors: techMap.get(item.technician_id) || { name: 'Unassigned', type: '' },
        resolved_assigned_by: resolvedAssigned,
        resolved_received_by: resolvedReceived,
        resolved_services: resolvedServices,
        display_status: receivedAsOf ? (item.current_status || 'Repaired') : 'Pending',
        received_at_asof: receivedAsOf ? item.received_at : null,
        rejection_reason_asof: receivedAsOf ? item.rejection_reason : null
      }
    }

    let assignedToday: any[] = []
    if (itemsError) {
      console.error(itemsError.message)
    } else {
      assignedToday = (itemsData || []).map(processItem)
    }
    setDateItems(assignedToday)

    if (carriedError) console.error(carriedError.message)
    const carriedOver = (carriedData || []).map(processItem)

    const combined = [...assignedToday, ...carriedOver].sort((a, b) => {
      const byTech = (a.technicians_vendors?.name || '').localeCompare(b.technicians_vendors?.name || '')
      return byTech !== 0 ? byTech : String(a.created_at).localeCompare(String(b.created_at))
    })
    setListItems(combined)

    setLoading(false)
    setInitialLoading(false)
  }

  const stockMap = new Map(stockRecords.map(s => [s.technician_id, s]))
  
  const assignedItemCounts = new Map<string, number>()
  dateItems.forEach(item => {
    if (item.technician_id) {
      assignedItemCounts.set(item.technician_id, (assignedItemCounts.get(item.technician_id) || 0) + 1)
    }
  })

  const isDayLocked = stockRecords.length > 0 && stockRecords.every(s => s.locked_at !== null)

  const rowsWithMetrics = technicians.map(tech => {
    const prevStock = prevStockMap.get(tech.id)
    const defaultOpening = prevStock ? (prevStock.closing_pending || 0) : 0

    const stock = stockMap.get(tech.id) || {
      id: null,
      opening_pending: defaultOpening,
      newly_given: 0,
      repaired: 0,
      reworked: 0,
      opened: 0,
      checked: 0,
      closed: 0,
      rejected_return: 0,
      closing_pending: 0,
      physical_verified: false,
      locked_at: null
    }

    const openingPending = stock.opening_pending > 0 ? stock.opening_pending : defaultOpening
    const completedCount = (stock.repaired || 0) + (stock.reworked || 0) + (stock.opened || 0) + (stock.checked || 0) + (stock.closed || 0) + (stock.rejected_return || 0)

    let newlyGiven = stock.newly_given > 0 ? stock.newly_given : (assignedItemCounts.get(tech.id) || 0)
    let totalGiven = openingPending + newlyGiven

    if (totalGiven < completedCount) {
      totalGiven = completedCount
      newlyGiven = totalGiven - openingPending
    }
    
    const pending = stock.closing_pending !== undefined && stock.closing_pending !== null && stock.closing_pending > 0
      ? stock.closing_pending 
      : Math.max(0, totalGiven - completedCount)

    const isRequired = totalGiven > 0 || completedCount > 0 || pending > 0

    return {
      ...tech,
      ...stock,
      id: tech.id, // must come AFTER ...stock, which carries its own `id` (or null)
      stock_record_id: stock.id, // stock record primary key, kept separately
      opening_pending: openingPending,
      newly_given: newlyGiven,
      totalGiven,
      closing_pending: pending,
      isRequired
    }
  })

  const requiredTechs = rowsWithMetrics.filter(r => r.isRequired)
  const matchedCount = requiredTechs.filter(r => r.physical_verified).length
  const allRequiredMatched = requiredTechs.length > 0 && matchedCount === requiredTechs.length

  // Single source of rows for the Repair Request List table, its totals, and
  // the Excel export — filtering never creates a second, divergent dataset.
  const filteredDateItems = selectedTechnicianId === 'ALL'
    ? listItems
    : listItems.filter(item => item.technician_id === selectedTechnicianId)

  const matrixTotals = rowsWithMetrics.reduce((acc, row) => {
    acc.opening += row.opening_pending || 0
    acc.given += row.totalGiven || 0
    acc.repaired += row.repaired || 0
    acc.reworked += row.reworked || 0
    acc.opened += row.opened || 0
    acc.checked += row.checked || 0
    acc.closed += row.closed || 0
    acc.rejected += row.rejected_return || 0
    acc.pending += row.closing_pending || 0
    return acc
  }, { opening: 0, given: 0, repaired: 0, reworked: 0, opened: 0, checked: 0, closed: 0, rejected: 0, pending: 0 })

  const listTotals = filteredDateItems.reduce((acc, item) => {
    acc.given += 1
    switch (item.display_status) {
      case 'Pending': acc.pending += 1; break
      case 'Repaired': acc.repaired += 1; break
      case 'Reworked': acc.reworked += 1; break
      case 'Opened': acc.opened += 1; break
      case 'Checked': acc.checked += 1; break
      case 'Closed': acc.closed += 1; break
      case 'Rejected': acc.rejected += 1; break
    }
    return acc
  }, { given: 0, repaired: 0, reworked: 0, opened: 0, checked: 0, closed: 0, rejected: 0, pending: 0 })

  async function toggleVerification(techId: string, stockRecordId: string | null, currentStatus: boolean, calculatedGiven: number, calculatedPending: number, calculatedOpening: number) {
    if (isDayLocked) return

    const newStatus = !currentStatus

    if (stockRecordId) {
      const { error } = await supabase
        .from('daily_technician_stock')
        .update({
          physical_verified: newStatus,
          verified_at: newStatus ? new Date().toISOString() : null,
          opening_pending: calculatedOpening,
          newly_given: calculatedGiven,
          closing_pending: calculatedPending
        })
        .eq('id', stockRecordId)

      if (error) {
        alert('Error updating verification: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('daily_technician_stock')
        .insert({
          technician_id: techId,
          stock_date: selectedDate,
          opening_pending: calculatedOpening,
          newly_given: calculatedGiven,
          closing_pending: calculatedPending,
          physical_verified: newStatus,
          verified_at: newStatus ? new Date().toISOString() : null
        })

      if (error) {
        alert('Error creating verification record: ' + error.message)
        return
      }
    }
    fetchData()
  }

  async function handleLockDay() {
    if (!allRequiredMatched) return
    if (!confirm(`Are you sure you want to permanently lock the daily stock and verification records for ${selectedDate}?`)) return

    const { error } = await supabase
      .from('daily_technician_stock')
      .update({ locked_at: new Date().toISOString() })
      .eq('stock_date', selectedDate)

    if (error) alert('Error locking day: ' + error.message)
    else {
      alert('Day successfully locked and archived as immutable.')
      fetchData()
    }
  }

  function exportToExcel() {
    // Exports exactly the rows currently visible in the Repair Request List
    // table below (same selectedDate, same technician filter) — never a
    // separately-fetched or stale dataset.
    const dataToExport = filteredDateItems.map(item => {
      return {
        'Technician / Vendor': item.technicians_vendors?.name || 'Unassigned',
        'IMEI': item.imei,
        'Model': item.model,
        'Storage (GB)': item.storage_gb,
        'Color': item.color,
        'Service': item.resolved_services || '—',
        'Assigned By': item.resolved_assigned_by,
        'Assigned At': item.created_at ? new Date(item.created_at).toLocaleString() : '',
        'Status': item.display_status,
        'Received By': item.resolved_received_by,
        'Received At': item.received_at_asof ? new Date(item.received_at_asof).toLocaleString() : '—',
        'Rejection Reason': item.rejection_reason_asof || '',
        'Remarks': item.remarks || ''
      }
    })

    const techSuffix = selectedTechnicianId === 'ALL'
      ? ''
      : `_${(technicians.find(t => t.id === selectedTechnicianId)?.name || 'Technician').replace(/\s+/g, '')}`

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `Items_${selectedDate}`)
    XLSX.writeFile(workbook, `Repair_Items_Details_${selectedDate}${techSuffix}.xlsx`)
  }

  function toggleItemSelected(id: string) {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedItemIds(prev => {
      const allVisible = filteredDateItems.map(i => i.id)
      const allSelected = allVisible.length > 0 && allVisible.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(allVisible)
    })
  }

  async function applyBulkRemarks() {
    if (selectedItemIds.size === 0) return
    setSavingRemarks(true)
    const { error } = await supabase
      .from('repair_request_items')
      .update({ remarks: bulkRemarksText.trim() || null })
      .in('id', Array.from(selectedItemIds))

    if (error) {
      alert('Error saving remarks: ' + error.message)
      setSavingRemarks(false)
      return
    }

    setSelectedItemIds(new Set())
    setBulkRemarksText('')
    setSavingRemarks(false)
    fetchData()
  }

  function downloadPDF() {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text(`Technician Daily Operational & Stock Matrix`, 14, 20)
    doc.setFontSize(10)
    doc.text(`Date: ${selectedDate} | Status: ${isDayLocked ? 'LOCKED & IMMUTABLE' : 'OPEN'}`, 14, 28)
    doc.text(`Verification Progress: ${matchedCount} / ${requiredTechs.length} Technicians Matched`, 14, 34)

    const tableColumn = ['Technician', 'Opening', 'Given', 'Repaired', 'Reworked', 'Opened', 'Checked', 'Closed', 'Rejected', 'Pending', 'Verification']
    const tableRows = rowsWithMetrics.map(r => [
      r.name,
      r.opening_pending,
      r.totalGiven,
      r.repaired,
      r.reworked,
      r.opened,
      r.checked,
      r.closed,
      r.rejected_return,
      r.closing_pending,
      r.physical_verified ? 'Matched' : 'Pending'
    ])

    const totals = matrixTotals

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      foot: [[
        'TOTAL', totals.opening, totals.given, totals.repaired, totals.reworked,
        totals.opened, totals.checked, totals.closed, totals.rejected, totals.pending,
        `${matchedCount}/${requiredTechs.length}`
      ]],
      startY: 42,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' }
    })

    doc.save(`Daily_Stock_Summary_${selectedDate}.pdf`)
  }

  if (initialLoading) return <div className="max-w-7xl mx-auto p-6 text-center text-sm text-gray-500">Loading Daily Technician Stock...</div>

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Technician Daily Operational & Stock Matrix</h2>
          <p className="text-xs text-gray-500 mt-1">
            Verify physical bench stock and lock daily summaries.
            {loading && <span className="ml-2 text-slate-500 font-semibold animate-pulse">· Updating…</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={exportToExcel}
            className="px-3 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow cursor-pointer"
          >
            Export Excel (IMEI Details)
          </button>
          <button
            onClick={downloadPDF}
            className="px-3 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow cursor-pointer"
          >
            Download PDF
          </button>
          <div className="flex items-center gap-2 border-l pl-3">
            <label className="text-xs font-bold text-gray-700">Technician:</label>
            <select
              value={selectedTechnicianId}
              onChange={(e) => setSelectedTechnicianId(e.target.value)}
              className="px-3 py-2 text-xs border rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
            >
              <option value="ALL">All Technicians</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>{tech.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 border-l pl-3">
            <label className="text-xs font-bold text-gray-700">Date:</label>
            <button
              onClick={() => setSelectedDate(shiftDateStr(selectedDate, -1))}
              className="px-2 py-2 text-xs border rounded-lg font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
              title="Previous day"
            >
              ←
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 text-xs border rounded-lg font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <button
              onClick={() => setSelectedDate(shiftDateStr(selectedDate, 1))}
              className="px-2 py-2 text-xs border rounded-lg font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
              title="Next day"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">Database Error: {errorMsg}</div>}

      <div className={`p-4 rounded-lg border flex flex-wrap justify-between items-center gap-3 text-xs font-bold ${isDayLocked ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
        <span>{isDayLocked ? `🔒 This date (${selectedDate}) is locked and immutable.` : `🔓 Active Open Day — Pending Physical Verification & Lock.`}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono">{matchedCount} / {requiredTechs.length} Required Technicians Matched</span>
          {!isDayLocked && (
            <button
              disabled={!allRequiredMatched || loading}
              onClick={handleLockDay}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                allRequiredMatched
                  ? 'bg-slate-900 hover:bg-slate-800 text-white shadow cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              LOCK DAY
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-900 text-white uppercase font-bold">
              <tr>
                <th className="p-4">Technician</th>
                <th className="p-4 text-center">Opening</th>
                <th className="p-4 text-center">Given</th>
                <th className="p-4 text-center">Repaired</th>
                <th className="p-4 text-center">Reworked</th>
                <th className="p-4 text-center">Opened</th>
                <th className="p-4 text-center">Checked</th>
                <th className="p-4 text-center">Closed</th>
                <th className="p-4 text-center">Rejected</th>
                <th className="p-4 text-center">Pending</th>
                <th className="p-4 text-center">Physical Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rowsWithMetrics.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-bold text-slate-900">
                    {row.name}
                    {!row.isRequired && <span className="ml-2 text-[10px] text-gray-400 font-normal">(Inactive)</span>}
                  </td>
                  <td className="p-4 text-center font-mono text-slate-600">{row.opening_pending}</td>
                  <td className="p-4 text-center font-mono font-bold text-slate-900">{row.totalGiven}</td>
                  <td className="p-4 text-center font-mono font-bold text-emerald-600">{row.repaired}</td>
                  <td className="p-4 text-center font-mono text-gray-600">{row.reworked}</td>
                  <td className="p-4 text-center font-mono text-gray-600">{row.opened}</td>
                  <td className="p-4 text-center font-mono text-gray-600">{row.checked}</td>
                  <td className="p-4 text-center font-mono text-gray-600">{row.closed}</td>
                  <td className="p-4 text-center font-mono font-bold text-rose-600">{row.rejected_return}</td>
                  <td className="p-4 text-center font-mono font-bold text-amber-600">{row.closing_pending}</td>
                  <td className="p-4 text-center">
                    {row.isRequired ? (
                      <button
                        disabled={isDayLocked || loading}
                        onClick={() => toggleVerification(row.id, row.stock_record_id, row.physical_verified, row.newly_given, row.closing_pending, row.opening_pending)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          row.physical_verified
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 shadow-sm'
                        } ${isDayLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        {row.physical_verified ? '✓ Matched' : '[ MATCHED ]'}
                      </button>
                    ) : (
                      <span className="text-gray-400 text-[10px]">No Stock</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                <td className="p-4 text-slate-900">TOTAL</td>
                <td className="p-4 text-center font-mono text-slate-700">{matrixTotals.opening}</td>
                <td className="p-4 text-center font-mono text-slate-900">{matrixTotals.given}</td>
                <td className="p-4 text-center font-mono text-emerald-700">{matrixTotals.repaired}</td>
                <td className="p-4 text-center font-mono text-gray-700">{matrixTotals.reworked}</td>
                <td className="p-4 text-center font-mono text-gray-700">{matrixTotals.opened}</td>
                <td className="p-4 text-center font-mono text-gray-700">{matrixTotals.checked}</td>
                <td className="p-4 text-center font-mono text-gray-700">{matrixTotals.closed}</td>
                <td className="p-4 text-center font-mono text-rose-700">{matrixTotals.rejected}</td>
                <td className="p-4 text-center font-mono text-amber-700">{matrixTotals.pending}</td>
                <td className="p-4 text-center font-mono text-slate-700">{matchedCount} / {requiredTechs.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-gray-900 text-sm">
            Repair Request List — {selectedDate}
            {selectedTechnicianId !== 'ALL' && (
              <span className="font-normal text-gray-500"> · {technicians.find(t => t.id === selectedTechnicianId)?.name || 'Technician'}</span>
            )}
          </h3>
          <span className="bg-slate-900 text-white text-xs px-3 py-1 rounded-full font-bold font-mono">{filteredDateItems.length} IMEI(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-900 text-white uppercase font-bold">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    checked={filteredDateItems.length > 0 && filteredDateItems.every(i => selectedItemIds.has(i.id))}
                    onChange={toggleSelectAllVisible}
                    className="w-4 h-4"
                  />
                </th>
                <th className="p-3">Technician</th>
                <th className="p-3">IMEI</th>
                <th className="p-3">Model</th>
                <th className="p-3">GB</th>
                <th className="p-3">Color</th>
                <th className="p-3">Service</th>
                <th className="p-3">Remarks</th>
                <th className="p-3">Assigned By</th>
                <th className="p-3">Assigned At</th>
                <th className="p-3">Status</th>
                <th className="p-3">Received By</th>
                <th className="p-3">Received At</th>
                <th className="p-3">Rejection Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredDateItems.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-6 text-center text-gray-400">No IMEIs for this date.</td>
                </tr>
              ) : (
                filteredDateItems.map((item) => (
                  <tr key={item.id} className={`hover:bg-slate-50 ${selectedItemIds.has(item.id) ? 'bg-slate-50' : ''}`}>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedItemIds.has(item.id)}
                        onChange={() => toggleItemSelected(item.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="p-3 font-medium text-slate-900">{item.technicians_vendors?.name || 'Unassigned'}</td>
                    <td className="p-3 font-mono">{item.imei}</td>
                    <td className="p-3">{item.model || '—'}</td>
                    <td className="p-3">{item.storage_gb || '—'}</td>
                    <td className="p-3">{item.color || '—'}</td>
                    <td className="p-3">{item.resolved_services}</td>
                    <td className="p-3">{item.remarks || '—'}</td>
                    <td className="p-3">{item.resolved_assigned_by}</td>
                    <td className="p-3 font-mono">{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.display_status === 'Pending' ? 'bg-amber-100 text-amber-800' :
                        item.display_status === 'Rejected' ? 'bg-rose-100 text-rose-800' :
                        'bg-emerald-100 text-emerald-800'
                      }`}>{item.display_status}</span>
                    </td>
                    <td className="p-3">{item.resolved_received_by}</td>
                    <td className="p-3 font-mono">{item.received_at_asof ? new Date(item.received_at_asof).toLocaleString() : '—'}</td>
                    <td className="p-3">{item.rejection_reason_asof || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t bg-slate-50 px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 text-xs font-bold">
          <span className="text-slate-900">Given: <span className="font-mono">{listTotals.given}</span></span>
          <span className="text-emerald-600">Repaired: <span className="font-mono">{listTotals.repaired}</span></span>
          <span className="text-gray-600">Reworked: <span className="font-mono">{listTotals.reworked}</span></span>
          <span className="text-gray-600">Opened: <span className="font-mono">{listTotals.opened}</span></span>
          <span className="text-gray-600">Checked: <span className="font-mono">{listTotals.checked}</span></span>
          <span className="text-gray-600">Closed: <span className="font-mono">{listTotals.closed}</span></span>
          <span className="text-rose-600">Rejected: <span className="font-mono">{listTotals.rejected}</span></span>
          <span className="text-amber-600">Pending: <span className="font-mono">{listTotals.pending}</span></span>
        </div>
        <div className="border-t p-4 flex flex-wrap items-center gap-3 bg-white">
          <span className="text-xs font-bold text-gray-700">
            {selectedItemIds.size > 0 ? `${selectedItemIds.size} IMEI(s) selected` : 'Tick rows above to bulk-apply a remark'}
          </span>
          <input
            type="text"
            value={bulkRemarksText}
            onChange={(e) => setBulkRemarksText(e.target.value)}
            placeholder="Remarks / Brand to apply to selected rows..."
            disabled={selectedItemIds.size === 0}
            className="flex-1 min-w-[220px] border border-gray-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-slate-900 outline-none disabled:bg-gray-50"
          />
          <button
            onClick={applyBulkRemarks}
            disabled={selectedItemIds.size === 0 || savingRemarks}
            className={`px-4 py-2 rounded-lg text-xs font-bold ${
              selectedItemIds.size === 0 || savingRemarks
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-slate-900 hover:bg-slate-800 text-white cursor-pointer'
            }`}
          >
            {savingRemarks ? 'Applying…' : `Apply to Selected`}
          </button>
        </div>
      </div>

    </div>
  )
}