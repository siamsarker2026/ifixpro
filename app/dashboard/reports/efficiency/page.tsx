'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'

// Asia/Dubai is a fixed UTC+4 offset (no DST), same approach as the
// Repair Request Lists page, so "a day" means the same thing on both pages.
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000

function getDubaiDayRangeUTC(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number)
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

function dubaiToday() {
  return new Date(Date.now() + DUBAI_OFFSET_MS).toISOString().split('T')[0]
}

// PostgREST returns at most 1000 rows per request, so read in pages.
async function fetchAll(build: (from: number, to: number) => any) {
  const PAGE = 1000
  const rows: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) return { data: rows, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: rows, error: null }
}

const norm = (s: any) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// What the admin types in the manual efficiency box: "50", "50%" or "absent".
function parseManual(raw: string): { empty: boolean; absent: boolean; pct: number | null; valid: boolean } {
  const t = raw.trim().toLowerCase()
  if (t === '') return { empty: true, absent: false, pct: null, valid: true }
  if (t.startsWith('abs')) return { empty: false, absent: true, pct: null, valid: true }
  const n = Number(t.replace('%', '').trim())
  if (!Number.isFinite(n) || n < 0 || n > 999) return { empty: false, absent: false, pct: null, valid: false }
  return { empty: false, absent: false, pct: Math.round(n * 10) / 10, valid: true }
}

function manualToText(rec: any) {
  if (!rec) return ''
  if (rec.is_absent) return 'Absent'
  if (rec.manual_pct === null || rec.manual_pct === undefined) return ''
  return `${Number(rec.manual_pct)}%`
}

const NO_TECH = '__none'

export default function DailyWorkEfficiencyPage() {
  const [selectedDate, setSelectedDate] = useState<string>(dubaiToday())
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [manualSetupMsg, setManualSetupMsg] = useState('')

  const [technicians, setTechnicians] = useState<any[]>([])
  const [services, setServices] = useState<any[]>([])
  const [targets, setTargets] = useState<any[]>([])
  const [receivedItems, setReceivedItems] = useState<any[]>([])
  const [pendingItems, setPendingItems] = useState<any[]>([])
  const [otherWork, setOtherWork] = useState<Record<string, string>>({})
  const [efficiencyRecs, setEfficiencyRecs] = useState<Record<string, any>>({})
  const [effDraft, setEffDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    setEffDraft({})
    fetchData()
  }, [selectedDate])

  async function fetchData() {
    setLoading(true)
    setErrorMsg('')
    setManualSetupMsg('')
    const { startISO, endISO } = getDubaiDayRangeUTC(selectedDate)

    const [
      techRes,
      servicesRes,
      targetsRes,
      receivedRes,
      pendingRes,
      stockRes,
      effRes
    ] = await Promise.all([
      supabase.from('technicians_vendors').select('id, name').order('name', { ascending: true }),
      supabase.from('services').select('id, name'),
      supabase.from('daily_targets').select('*').order('created_at', { ascending: false }),
      // Output of the day: items received during the selected Dubai day.
      fetchAll((from, to) =>
        supabase.from('repair_request_items')
          .select('id, technician_id, service_ids, model, current_status')
          .gte('received_at', startISO).lt('received_at', endISO)
          .order('id').range(from, to)
      ),
      // Pending at the END of the day: assigned before the day ended and not
      // received yet (same rule as the Repair Request Lists page).
      fetchAll((from, to) =>
        supabase.from('repair_request_items')
          .select('id, technician_id')
          .lt('created_at', endISO)
          .or(`received_at.is.null,received_at.gte.${endISO}`)
          .order('id').range(from, to)
      ),
      supabase.from('daily_technician_stock').select('technician_id, other_work').eq('stock_date', selectedDate),
      supabase.from('daily_efficiency').select('*').eq('work_date', selectedDate)
    ])

    const firstError = techRes.error || servicesRes.error || receivedRes.error || pendingRes.error
    if (firstError) {
      setErrorMsg(firstError.message)
      setLoading(false)
      setInitialLoading(false)
      return
    }

    setTechnicians(techRes.data || [])
    setServices(servicesRes.data || [])
    setTargets(targetsRes.data || [])
    setReceivedItems(receivedRes.data)
    setPendingItems(pendingRes.data)

    const ow: Record<string, string> = {}
    ;(stockRes.data || []).forEach((r: any) => {
      if (r.other_work && String(r.other_work).trim()) ow[r.technician_id] = String(r.other_work).trim()
    })
    setOtherWork(ow)

    if (effRes.error) {
      setManualSetupMsg('Manual efficiency is not set up yet: run daily-efficiency-setup.sql in the main Supabase project. (' + effRes.error.message + ')')
      setEfficiencyRecs({})
    } else {
      const recs: Record<string, any> = {}
      ;(effRes.data || []).forEach((r: any) => { recs[r.technician_id] = r })
      setEfficiencyRecs(recs)
    }

    setLoading(false)
    setInitialLoading(false)
  }

  const pivot = useMemo(() => {
    const serviceName = new Map<string, string>(services.map((s: any) => [s.id, s.name]))
    const techName = new Map<string, string>(technicians.map((t: any) => [t.id, t.name]))

    // Daily Target lookup by service name (newest first, as loaded).
    const targetsByJob = new Map<string, any[]>()
    targets.forEach((t: any) => {
      const key = norm(t.job_name)
      if (!targetsByJob.has(key)) targetsByJob.set(key, [])
      targetsByJob.get(key)!.push(t)
    })

    // Pieces one unit of this job uses up of a full day: 1 / daily capacity.
    // Prefers the target for the same model (and one that lists this
    // technician); if the model has no target it averages that job's targets.
    function unitLoad(name: string, model: string, tech: string): number | null {
      const list = targetsByJob.get(norm(name))
      if (!list || list.length === 0) return null
      const sameModel = list.filter(t => norm(t.model) === norm(model))
      let pool = sameModel.length > 0 ? sameModel : list
      const withTech = pool.filter(t => norm(t.technician_names).split(/\s*,\s*/).includes(norm(tech)))
      if (withTech.length > 0) pool = withTech
      const loads = (sameModel.length > 0 ? [pool[0]] : pool)
        .map(t => Number(t.daily_capacity_pieces))
        .filter(c => c > 0)
        .map(c => 1 / c)
      if (loads.length === 0) return null
      return loads.reduce((a, b) => a + b, 0) / loads.length
    }

    type Row = { label: string; perTech: Map<string, number>; total: number }
    const rows = new Map<string, Row>()
    const outputByTech = new Map<string, number>()
    const rejectedByTech = new Map<string, number>()
    const loadByTech = new Map<string, number>()
    const uncoveredByTech = new Map<string, number>()
    const coveredByTech = new Map<string, number>()

    receivedItems.forEach((item: any) => {
      const tid = item.technician_id && techName.has(item.technician_id) ? item.technician_id : NO_TECH
      if (item.current_status === 'Rejected') {
        rejectedByTech.set(tid, (rejectedByTech.get(tid) || 0) + 1)
        return
      }
      const names: string[] = (item.service_ids || []).map((id: string) => serviceName.get(id) || 'Unknown Service')
      names.sort((a, b) => a.localeCompare(b))
      const label = names.length > 0 ? names.join(' + ') : '(No service)'
      const key = norm(label)
      if (!rows.has(key)) rows.set(key, { label, perTech: new Map(), total: 0 })
      const row = rows.get(key)!
      row.perTech.set(tid, (row.perTech.get(tid) || 0) + 1)
      row.total += 1
      outputByTech.set(tid, (outputByTech.get(tid) || 0) + 1)

      // Auto efficiency: every service in the item needs a Daily Target.
      const who = tid === NO_TECH ? '' : (techName.get(tid) || '')
      const loads = names.map(n => unitLoad(n, item.model, who))
      if (names.length > 0 && loads.every(l => l !== null)) {
        loadByTech.set(tid, (loadByTech.get(tid) || 0) + (loads as number[]).reduce((a, b) => a + b, 0))
        coveredByTech.set(tid, (coveredByTech.get(tid) || 0) + 1)
      } else {
        uncoveredByTech.set(tid, (uncoveredByTech.get(tid) || 0) + 1)
      }
    })

    const pendingByTech = new Map<string, number>()
    pendingItems.forEach((item: any) => {
      const tid = item.technician_id && techName.has(item.technician_id) ? item.technician_id : NO_TECH
      pendingByTech.set(tid, (pendingByTech.get(tid) || 0) + 1)
    })

    // Show a technician column only if they have something for this day.
    const active = (tid: string) =>
      (outputByTech.get(tid) || 0) > 0 ||
      (pendingByTech.get(tid) || 0) > 0 ||
      (rejectedByTech.get(tid) || 0) > 0 ||
      !!otherWork[tid] ||
      !!efficiencyRecs[tid]
    const cols: { id: string; name: string }[] = technicians
      .filter((t: any) => active(t.id))
      .map((t: any) => ({ id: t.id, name: t.name }))
    if (active(NO_TECH)) cols.push({ id: NO_TECH, name: 'Unassigned' })

    const sortedRows = Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label))
    const sum = (m: Map<string, number>) => cols.reduce((a, c) => a + (m.get(c.id) || 0), 0)

    return {
      cols,
      rows: sortedRows,
      outputByTech, pendingByTech, rejectedByTech,
      coveredByTech, uncoveredByTech,
      autoPct: (tid: string): number | null =>
        (coveredByTech.get(tid) || 0) > 0 ? Math.round((loadByTech.get(tid) || 0) * 100) : null,
      totalOutput: sum(outputByTech),
      totalPending: sum(pendingByTech),
      totalRejected: sum(rejectedByTech)
    }
  }, [receivedItems, pendingItems, technicians, services, targets, otherWork, efficiencyRecs])

  async function saveManual(techId: string) {
    if (techId === NO_TECH || manualSetupMsg) return
    const saved = manualToText(efficiencyRecs[techId])
    const raw = effDraft[techId] ?? saved
    const parsed = parseManual(raw)

    const clearDraft = () =>
      setEffDraft(prev => { const n = { ...prev }; delete n[techId]; return n })

    if (!parsed.valid) {
      alert('Type a number like 50 or 50%, or the word Absent.')
      return
    }
    if (raw.trim() === saved) { clearDraft(); return }

    if (parsed.empty) {
      const { error } = await supabase
        .from('daily_efficiency')
        .delete()
        .eq('technician_id', techId)
        .eq('work_date', selectedDate)
      if (error) { alert('Error saving efficiency: ' + error.message); return }
      setEfficiencyRecs(prev => { const n = { ...prev }; delete n[techId]; return n })
    } else {
      const record = {
        technician_id: techId,
        work_date: selectedDate,
        manual_pct: parsed.pct,
        is_absent: parsed.absent,
        updated_at: new Date().toISOString()
      }
      const { error } = await supabase
        .from('daily_efficiency')
        .upsert(record, { onConflict: 'technician_id,work_date' })
      if (error) { alert('Error saving efficiency: ' + error.message); return }
      setEfficiencyRecs(prev => ({ ...prev, [techId]: record }))
    }
    clearDraft()
  }

  function exportToExcel() {
    const names = pivot.cols.map(c => c.name)
    const aoa: (string | number)[][] = []
    aoa.push([`Daily Work Efficiency - ${selectedDate}`])
    aoa.push(['Job work', ...names, 'Grand Total'])
    pivot.rows.forEach(r => {
      aoa.push([r.label, ...pivot.cols.map(c => r.perTech.get(c.id) || ''), r.total])
    })
    aoa.push(['Grand Total of repaired qty', ...pivot.cols.map(c => pivot.outputByTech.get(c.id) || 0), pivot.totalOutput])
    aoa.push(['Pending', ...pivot.cols.map(c => pivot.pendingByTech.get(c.id) || 0), pivot.totalPending])
    aoa.push(['Rejected (not counted)', ...pivot.cols.map(c => pivot.rejectedByTech.get(c.id) || 0), pivot.totalRejected])
    aoa.push(['Other work', ...pivot.cols.map(c => otherWork[c.id] || ''), ''])
    aoa.push(['Efficiency', ...pivot.cols.map(c => {
      const rec = efficiencyRecs[c.id]
      if (rec) return manualToText(rec)
      const auto = pivot.autoPct(c.id)
      return auto === null ? '' : `${auto}% (auto)`
    }), ''])

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Efficiency_${selectedDate}`)
    XLSX.writeFile(wb, `Daily_Work_Efficiency_${selectedDate}.xlsx`)
  }

  if (initialLoading) {
    return <div className="max-w-7xl mx-auto p-6 text-center text-sm text-gray-500">Loading Daily Work Efficiency...</div>
  }

  const colCount = pivot.cols.length

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Daily Work Efficiency</h2>
          <p className="text-xs text-gray-500 mt-1">
            Output per job and technician for the day (items received that day), pending at the end of the day, and efficiency.
            {loading && <span className="ml-2 text-slate-500 font-semibold animate-pulse">· Updating…</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={exportToExcel}
            disabled={colCount === 0}
            className="px-3 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export Excel
          </button>
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
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
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
      {manualSetupMsg && <div className="p-4 bg-amber-50 text-amber-800 rounded-lg border border-amber-200 text-xs">{manualSetupMsg}</div>}

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        {colCount === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No repair activity recorded for {selectedDate}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-white font-bold">
                <tr>
                  <th className="p-3 sticky left-0 bg-slate-900 z-10 min-w-[260px]">Job work</th>
                  {pivot.cols.map(c => (
                    <th key={c.id} className="p-3 text-center whitespace-nowrap">{c.name}</th>
                  ))}
                  <th className="p-3 text-center whitespace-nowrap">Grand Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pivot.rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount + 2} className="p-4 text-center text-gray-500">No items were received on this day.</td>
                  </tr>
                ) : pivot.rows.map(r => (
                  <tr key={r.label} className="hover:bg-slate-50">
                    <td className="p-3 sticky left-0 bg-white font-medium text-slate-900 min-w-[260px]">{r.label}</td>
                    {pivot.cols.map(c => (
                      <td key={c.id} className="p-3 text-center font-mono text-slate-700">{r.perTech.get(c.id) || ''}</td>
                    ))}
                    <td className="p-3 text-center font-mono font-bold text-slate-900">{r.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50 font-bold border-t-2 border-slate-300">
                  <td className="p-3 sticky left-0 bg-emerald-50 text-slate-900">Grand Total of repaired qty</td>
                  {pivot.cols.map(c => (
                    <td key={c.id} className="p-3 text-center font-mono text-emerald-800">{pivot.outputByTech.get(c.id) || 0}</td>
                  ))}
                  <td className="p-3 text-center font-mono text-emerald-800">{pivot.totalOutput}</td>
                </tr>
                <tr className="bg-amber-50 font-bold">
                  <td className="p-3 sticky left-0 bg-amber-50 text-slate-900">Pending</td>
                  {pivot.cols.map(c => (
                    <td key={c.id} className="p-3 text-center font-mono text-amber-800">{pivot.pendingByTech.get(c.id) || 0}</td>
                  ))}
                  <td className="p-3 text-center font-mono text-amber-800">{pivot.totalPending}</td>
                </tr>
                <tr className="bg-white font-semibold">
                  <td className="p-3 sticky left-0 bg-white text-slate-600">Rejected (not counted above)</td>
                  {pivot.cols.map(c => (
                    <td key={c.id} className="p-3 text-center font-mono text-rose-700">{pivot.rejectedByTech.get(c.id) || ''}</td>
                  ))}
                  <td className="p-3 text-center font-mono text-rose-700">{pivot.totalRejected || ''}</td>
                </tr>
                <tr className="bg-white">
                  <td className="p-3 sticky left-0 bg-white text-slate-600 font-semibold">
                    Other work
                    <span className="block text-[10px] font-normal text-gray-400">typed in Repair Request Lists</span>
                  </td>
                  {pivot.cols.map(c => (
                    <td key={c.id} className="p-3 text-center text-slate-700 whitespace-normal min-w-[120px]">{otherWork[c.id] || ''}</td>
                  ))}
                  <td className="p-3"></td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="p-3 sticky left-0 bg-slate-50 text-slate-600 font-semibold">
                    Auto efficiency
                    <span className="block text-[10px] font-normal text-gray-400">from Daily Target</span>
                  </td>
                  {pivot.cols.map(c => {
                    const auto = pivot.autoPct(c.id)
                    const missing = pivot.uncoveredByTech.get(c.id) || 0
                    return (
                      <td key={c.id} className="p-3 text-center font-mono text-slate-500">
                        {auto === null ? '—' : `${auto}%`}
                        {missing > 0 && (
                          <span className="block text-[10px] text-gray-400 font-sans" title="Pieces with no Daily Target, not included in the auto %">
                            {missing} pcs no target
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="p-3"></td>
                </tr>
                <tr className="bg-yellow-50 border-t border-slate-200">
                  <td className="p-3 sticky left-0 bg-yellow-50 text-slate-900 font-bold">
                    Efficiency
                    <span className="block text-[10px] font-normal text-gray-500">type 50, 50% or Absent</span>
                  </td>
                  {pivot.cols.map(c => {
                    const auto = pivot.autoPct(c.id)
                    const savedText = manualToText(efficiencyRecs[c.id])
                    return (
                      <td key={c.id} className="p-2 text-center">
                        {c.id === NO_TECH ? null : (
                          <input
                            type="text"
                            value={effDraft[c.id] ?? savedText}
                            onChange={(e) => setEffDraft(prev => ({ ...prev, [c.id]: e.target.value }))}
                            onBlur={() => saveManual(c.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            disabled={!!manualSetupMsg || loading}
                            placeholder={auto === null ? '' : `${auto}% auto`}
                            className="w-20 px-2 py-1.5 text-xs text-center border rounded-md font-bold text-slate-900 placeholder:text-gray-300 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-gray-50"
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className="p-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-500 space-y-1 px-1">
        <p>Output = items received on this day (Dubai time), all statuses except Rejected. Pending = assigned and still not received at the end of the day.</p>
        <p>
          Auto efficiency = share of a full day's capacity used, from the Daily Target of each job and model
          (if a model has no target, the average of that job's targets is used). The faded text inside the Efficiency box shows the auto value as a hint;
          what you type there is the saved figure.
        </p>
      </div>
    </div>
  )
}