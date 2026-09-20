'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function DailyTechnicianStockPage() {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [technicians, setTechnicians] = useState<any[]>([])
  const [stockRecords, setStockRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    fetchData()
  }, [selectedDate])

  async function fetchData() {
    setLoading(true)
    setErrorMsg('')

    const { data: techData, error: techError } = await supabase
      .from('technicians_vendors')
      .select('id, name')
      .order('name', { ascending: true })

    if (techError) {
      setErrorMsg(techError.message)
      setLoading(false)
      return
    }
    setTechnicians(techData || [])

    const { data: stockData, error: stockError } = await supabase
      .from('daily_technician_stock')
      .select('*')
      .eq('stock_date', selectedDate)

    if (stockError) {
      setErrorMsg(stockError.message)
    }

    setStockRecords(stockData || [])
    setLoading(false)
  }

  const stockMap = new Map(stockRecords.map(s => [s.technician_id, s]))
  const isDayLocked = stockRecords.length > 0 && stockRecords.every(s => s.locked_at !== null)

  const rowsWithMetrics = technicians.map(tech => {
    const stock = stockMap.get(tech.id) || {
      opening_pending: 0,
      newly_given: 0,
      received_back: 0,
      rejected_return: 0,
      transferred: 0,
      repaired: 0,
      reworked: 0,
      opened: 0,
      checked: 0,
      closed: 0,
      closing_pending: 0,
      physical_verified: false,
      locked_at: null
    }

    const isRequired = (stock.opening_pending > 0 || stock.newly_given > 0 || stock.repaired > 0 || stock.closed > 0 || stock.closing_pending > 0)

    return {
      ...tech,
      ...stock,
      isRequired
    }
  })

  const requiredTechs = rowsWithMetrics.filter(r => r.isRequired)
  const matchedCount = requiredTechs.filter(r => r.physical_verified).length
  const allRequiredMatched = requiredTechs.length > 0 && matchedCount === requiredTechs.length

  async function toggleVerification(techId: string, currentStatus: boolean) {
    if (isDayLocked) return

    const existing = stockMap.get(techId)
    const newStatus = !currentStatus

    if (existing) {
      const { error } = await supabase
        .from('daily_technician_stock')
        .update({
          physical_verified: newStatus,
          verified_at: newStatus ? new Date().toISOString() : null
        })
        .eq('id', existing.id)

      if (error) alert('Error updating verification: ' + error.message)
      else fetchData()
    } else {
      const { error } = await supabase
        .from('daily_technician_stock')
        .insert({
          technician_id: techId,
          stock_date: selectedDate,
          physical_verified: newStatus,
          verified_at: newStatus ? new Date().toISOString() : null
        })

      if (error) alert('Error creating verification record: ' + error.message)
      else fetchData()
    }
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

  // Export to Excel
  function exportToExcel() {
    const dataToExport = rowsWithMetrics.map(r => ({
      'Technician': r.name,
      'Required': r.isRequired ? 'Yes' : 'No',
      'Given': r.newly_given,
      'Repaired': r.repaired,
      'Reworked': r.reworked,
      'Opened': r.opened,
      'Checked': r.checked,
      'Closed': r.closed,
      'Rejected': r.rejected_return,
      'Pending': r.closing_pending,
      'Physical Verified': r.physical_verified ? 'Matched' : 'Pending'
    }))

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `Stock_${selectedDate}`)
    XLSX.writeFile(workbook, `Technician_Stock_Matrix_${selectedDate}.xlsx`)
  }

  // Download PDF Summary
  function downloadPDF() {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text(`Technician Daily Operational & Stock Matrix`, 14, 20)
    doc.setFontSize(10)
    doc.text(`Date: ${selectedDate} | Status: ${isDayLocked ? 'LOCKED & IMMUTABLE' : 'OPEN'}`, 14, 28)
    doc.text(`Verification Progress: ${matchedCount} / ${requiredTechs.length} Technicians Matched`, 14, 34)

    const tableColumn = ['Technician', 'Given', 'Repaired', 'Reworked', 'Opened', 'Checked', 'Closed', 'Rejected', 'Pending', 'Verification']
    const tableRows = rowsWithMetrics.map(r => [
      r.name,
      r.newly_given,
      r.repaired,
      r.reworked,
      r.opened,
      r.checked,
      r.closed,
      r.rejected_return,
      r.closing_pending,
      r.physical_verified ? 'Matched' : 'Pending'
    ])

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 42,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] }
    })

    doc.save(`Daily_Stock_Summary_${selectedDate}.pdf`)
  }

  if (loading) return <div className="max-w-7xl mx-auto p-6 text-center text-sm text-gray-500">Loading Daily Technician Stock...</div>

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      {/* Header & Date Selector & Exports */}
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Technician Daily Operational & Stock Matrix</h2>
          <p className="text-xs text-gray-500 mt-1">Verify physical bench stock and lock daily summaries.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={exportToExcel}
            className="px-3 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow cursor-pointer"
          >
            Export Excel
          </button>
          <button
            onClick={downloadPDF}
            className="px-3 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow cursor-pointer"
          >
            Download PDF
          </button>
          <div className="flex items-center gap-2 border-l pl-3">
            <label className="text-xs font-bold text-gray-700">Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 text-xs border rounded-lg font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>
      </div>

      {errorMsg && <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">Database Error: {errorMsg}</div>}

      {/* Global Status Banner */}
      <div className={`p-4 rounded-lg border flex justify-between items-center text-xs font-bold ${isDayLocked ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
        <span>{isDayLocked ? `🔒 This date (${selectedDate}) is locked and immutable.` : `🔓 Active Open Day — Pending Physical Verification & Lock.`}</span>
        <span className="font-mono">{matchedCount} / {requiredTechs.length} Required Technicians Matched</span>
      </div>

      {/* Performance Matrix Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-900 text-white uppercase font-bold">
              <tr>
                <th className="p-4">Technician</th>
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
                  <td className="p-4 text-center font-mono font-bold text-slate-900">{row.newly_given}</td>
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
                        disabled={isDayLocked}
                        onClick={() => toggleVerification(row.id, row.physical_verified)}
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
          </table>
        </div>
      </div>

      {/* Footer Action Bar */}
      {!isDayLocked && (
        <div className="bg-white p-6 rounded-lg shadow-sm border flex justify-between items-center">
          <span className="text-xs font-bold text-gray-700">
            {matchedCount} / {requiredTechs.length} Technicians Matched
          </span>
          <button
            disabled={!allRequiredMatched}
            onClick={handleLockDay}
            className={`px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
              allRequiredMatched
                ? 'bg-slate-900 hover:bg-slate-800 text-white shadow cursor-pointer'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            LOCK DAY
          </button>
        </div>
      )}
    </div>
  )
}