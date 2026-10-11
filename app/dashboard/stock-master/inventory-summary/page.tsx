'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { masterSupabase } from '@/lib/masterSupabase'
import * as XLSX from 'xlsx'

const PAGE_SIZE = 50        // rows shown per page in the table
const EXPORT_CHUNK = 1000   // rows per request while exporting

const LIST_COLUMNS = 'imei, model, gb, color, grade, battery_health, cycle_count, is_fail'
const EXPORT_COLUMNS = 'imei, model, gb, color, grade, battery_health, cycle_count, is_fail, serial, carrier'

type Filters = {
  model: string
  gb: string
  color: string
  grade: string
  status: 'ALL' | 'Pass' | 'Fail'
  batteryMin: string
  batteryMax: string
}

// Every filter is applied INSIDE Postgres (and uses the indexes created by
// inventory-scaling.sql). Nothing is filtered in the browser.
function applyFilters(query: any, f: Filters) {
  if (f.model !== 'ALL') query = query.eq('model', f.model)
  if (f.gb !== 'ALL') query = query.eq('gb', f.gb)
  if (f.color !== 'ALL') query = query.eq('color', f.color)
  if (f.grade !== 'ALL') query = query.eq('grade', f.grade)
  if (f.status === 'Fail') query = query.eq('is_fail', true)
  if (f.status === 'Pass') query = query.eq('is_fail', false)
  if (f.batteryMin.trim() !== '' && Number.isFinite(Number(f.batteryMin))) {
    query = query.gte('battery_pct', Number(f.batteryMin))
  }
  if (f.batteryMax.trim() !== '' && Number.isFinite(Number(f.batteryMax))) {
    query = query.lte('battery_pct', Number(f.batteryMax))
  }
  return query
}

export default function InventorySummaryPage() {
  const [options, setOptions] = useState<{ models: string[]; gbs: string[]; colors: string[]; grades: string[] }>({
    models: [], gbs: [], colors: [], grades: []
  })
  const [totals, setTotals] = useState<{ total: number; fail: number } | null>(null)

  const [rows, setRows] = useState<any[]>([])
  const [matchCount, setMatchCount] = useState(0)
  const [page, setPage] = useState(0)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const [modelFilter, setModelFilter] = useState('ALL')
  const [gbFilter, setGbFilter] = useState('ALL')
  const [colorFilter, setColorFilter] = useState('ALL')
  const [gradeFilter, setGradeFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Pass' | 'Fail'>('ALL')
  const [batteryMin, setBatteryMin] = useState('')
  const [batteryMax, setBatteryMax] = useState('')

  // Battery inputs are debounced so typing "85" doesn't fire a query per keystroke.
  const [debouncedBatteryMin, setDebouncedBatteryMin] = useState('')
  const [debouncedBatteryMax, setDebouncedBatteryMax] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedBatteryMin(batteryMin)
      setDebouncedBatteryMax(batteryMax)
    }, 400)
    return () => clearTimeout(t)
  }, [batteryMin, batteryMax])

  const filters: Filters = {
    model: modelFilter,
    gb: gbFilter,
    color: colorFilter,
    grade: gradeFilter,
    status: statusFilter,
    batteryMin: debouncedBatteryMin,
    batteryMax: debouncedBatteryMax
  }
  const filterKey = JSON.stringify(filters)

  // Ignore responses from older requests if the user keeps changing filters.
  const requestId = useRef(0)

  // One-time: dropdown options + whole-database Pass/Fail totals (count-only, no rows).
  useEffect(() => {
    async function loadStatic() {
      const [optRes, totalRes, failRes] = await Promise.all([
        masterSupabase.rpc('inventory_filter_options'),
        masterSupabase.from('device_master').select('imei', { count: 'exact', head: true }),
        masterSupabase.from('device_master').select('imei', { count: 'exact', head: true }).eq('is_fail', true)
      ])

      const firstError = optRes.error || totalRes.error || failRes.error
      if (firstError) {
        setErrorMsg(
          `${firstError.message} — if this mentions inventory_filter_options, is_fail or battery_pct, run inventory-scaling.sql in the Master Supabase project first.`
        )
      }
      if (optRes.data) {
        const o: any = optRes.data
        setOptions({
          models: o.models || [],
          gbs: o.gbs || [],
          colors: o.colors || [],
          grades: o.grades || []
        })
      }
      setTotals({ total: totalRes.count || 0, fail: failRes.count || 0 })
      setInitialLoading(false)
    }
    loadStatic()
  }, [])

  // Whenever a filter changes, go back to page 1.
  useEffect(() => {
    setPage(0)
  }, [filterKey])

  // Fetch ONLY the current page (plus the exact match count) from Postgres.
  useEffect(() => {
    const myId = ++requestId.current
    async function loadPage() {
      setLoadingRows(true)
      const from = page * PAGE_SIZE
      const query = applyFilters(
        masterSupabase.from('device_master').select(LIST_COLUMNS, { count: 'exact' }),
        filters
      )
        .order('imei', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (myId !== requestId.current) return // a newer request superseded this one

      if (error) {
        setErrorMsg(error.message)
      } else {
        setErrorMsg('')
        setRows(data || [])
        setMatchCount(count || 0)
      }
      setLoadingRows(false)
    }
    loadPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page])

  async function exportFiltered() {
    setExporting(true)
    setExportProgress(0)
    setErrorMsg('')
    try {
      // Pull ONLY the matching rows, in chunks, with the same filters applied in Postgres.
      const all: any[] = []
      let from = 0
      while (true) {
        const { data, error } = await applyFilters(
          masterSupabase.from('device_master').select(EXPORT_COLUMNS),
          filters
        )
          .order('imei', { ascending: true })
          .range(from, from + EXPORT_CHUNK - 1)

        if (error) throw new Error(error.message)
        if (!data || data.length === 0) break
        all.push(...data)
        setExportProgress(all.length)
        if (data.length < EXPORT_CHUNK) break
        from += EXPORT_CHUNK
      }

      const sheetRows = all.map((d: any) => ({
        IMEI: d.imei,
        Model: d.model || '',
        GB: d.gb || '',
        Color: d.color || '',
        Grade: d.grade || '',
        'Battery Health': d.battery_health || '',
        'Cycle Count': d.cycle_count || '',
        Status: d.is_fail ? 'Fail' : 'Pass',
        Serial: d.serial || '',
        Carrier: d.carrier || ''
      }))
      const worksheet = XLSX.utils.json_to_sheet(sheetRows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory Summary')
      XLSX.writeFile(workbook, `Stock_Master_Inventory_Summary_${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (err: any) {
      setErrorMsg(`Export failed: ${err.message || err}`)
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(matchCount / PAGE_SIZE))
  const passCount = totals ? totals.total - totals.fail : 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex justify-between items-start gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Inventory Summary</h2>
          <p className="text-sm text-gray-600">Counts and filterable breakdown of everything in Stock Master.</p>
        </div>
        <Link
          href="/dashboard/stock-master"
          className="shrink-0 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg text-xs font-bold whitespace-nowrap"
        >
          ← Back to Stock Master
        </Link>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded-lg">{errorMsg}</div>
      )}

      {initialLoading ? (
        <div className="bg-white p-6 rounded-lg shadow-sm border text-sm text-gray-500">
          Loading Stock Master summary...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-lg shadow-sm border text-center">
              <p className="text-xs font-bold text-gray-500 uppercase">Total Phones</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{(totals?.total || 0).toLocaleString()}</p>
            </div>
            <div className="bg-white p-5 rounded-lg shadow-sm border text-center">
              <p className="text-xs font-bold text-gray-500 uppercase">Pass</p>
              <p className="text-3xl font-bold text-emerald-600 mt-1">{passCount.toLocaleString()}</p>
            </div>
            <div className="bg-white p-5 rounded-lg shadow-sm border text-center">
              <p className="text-xs font-bold text-gray-500 uppercase">Fail</p>
              <p className="text-3xl font-bold text-rose-600 mt-1">{(totals?.fail || 0).toLocaleString()}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Filters</h3>
              <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full">
                {matchCount.toLocaleString()} match{matchCount === 1 ? '' : 'es'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <select value={modelFilter} onChange={e => setModelFilter(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-xs">
                <option value="ALL">All Models</option>
                {options.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={gbFilter} onChange={e => setGbFilter(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-xs">
                <option value="ALL">All GB</option>
                {options.gbs.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={colorFilter} onChange={e => setColorFilter(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-xs">
                <option value="ALL">All Colors</option>
                {options.colors.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-xs">
                <option value="ALL">All Grades</option>
                {options.grades.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="border border-gray-300 rounded-lg p-2 text-xs">
                <option value="ALL">Pass + Fail</option>
                <option value="Pass">Pass only</option>
                <option value="Fail">Fail only</option>
              </select>
              <input
                type="number"
                value={batteryMin}
                onChange={e => setBatteryMin(e.target.value)}
                placeholder="Min Battery %"
                className="border border-gray-300 rounded-lg p-2 text-xs"
              />
              <input
                type="number"
                value={batteryMax}
                onChange={e => setBatteryMax(e.target.value)}
                placeholder="Max Battery %"
                className="border border-gray-300 rounded-lg p-2 text-xs"
              />
              <button
                onClick={exportFiltered}
                disabled={matchCount === 0 || exporting}
                className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white rounded-lg text-xs font-bold px-3 py-2"
              >
                {exporting
                  ? `Exporting... ${exportProgress.toLocaleString()} / ${matchCount.toLocaleString()}`
                  : `Export Excel (${matchCount.toLocaleString()})`}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className={`overflow-x-auto max-h-[500px] overflow-y-auto ${loadingRows ? 'opacity-60' : ''}`}>
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-900 text-white uppercase font-bold sticky top-0">
                  <tr>
                    <th className="p-3">IMEI</th>
                    <th className="p-3">Model</th>
                    <th className="p-3">GB</th>
                    <th className="p-3">Color</th>
                    <th className="p-3">Grade</th>
                    <th className="p-3">Battery Health</th>
                    <th className="p-3">Cycle Count</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-gray-400">
                      {loadingRows ? 'Loading...' : 'No devices match these filters.'}
                    </td></tr>
                  ) : (
                    rows.map(d => (
                      <tr key={d.imei} className="hover:bg-slate-50">
                        <td className="p-3 font-mono">{d.imei}</td>
                        <td className="p-3">{d.model || '—'}</td>
                        <td className="p-3">{d.gb || '—'}</td>
                        <td className="p-3">{d.color || '—'}</td>
                        <td className="p-3">{d.grade || '—'}</td>
                        <td className="p-3">{d.battery_health || '—'}</td>
                        <td className="p-3">{d.cycle_count || '—'}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${d.is_fail ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {d.is_fail ? 'Fail' : 'Pass'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 flex items-center justify-between border-t text-xs text-gray-600">
              <span>
                Page {page + 1} of {totalPages.toLocaleString()} · {PAGE_SIZE} per page · use Export Excel for the full list
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || loadingRows}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded font-bold"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || loadingRows}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded font-bold"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}