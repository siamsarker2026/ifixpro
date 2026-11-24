'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'

// Dr.Fone Pushes: what Dr.Fone sent to /api/drfone/push, per Dubai day.

type Summary = { devices: number; tests: number; calls: number; failed: number }
type Log = {
  id: number; created_at: string; status: number; dry_run: boolean; received: number
  inserted: number; updated: number; skipped_older: number; rejected: number
  imeis: string[]; error: string | null; source_ip: string | null
}
type Device = {
  imei: string; model: string | null; gb: string | null; color: string | null; carrier: string | null
  grade: string | null; tester_name: string | null; test_time: string | null
  battery_health: string | null; fail: string | null; created_at: string; pushed_at: string
  is_new: boolean; is_test: boolean
}
type Data = {
  date: string; today: string; lastPushAt: string | null
  stats: { today: Summary; yesterday: Summary; week: Summary; day: Summary }
  logs: Log[]; devices: Device[]
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function Stat({ label, s, active, onClick }: { label: string; s: Summary; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`text-left bg-white p-4 rounded-lg border shadow-sm ${active ? 'ring-2 ring-slate-900' : ''} ${onClick ? 'hover:border-slate-400' : 'cursor-default'}`}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{s.devices}</p>
      <p className="text-xs text-gray-500">devices{s.tests > 0 && <span> · {s.tests} test (not counted)</span>}</p>
      <p className="text-xs mt-1">
        <span className="text-gray-500">{s.calls} push{s.calls === 1 ? '' : 'es'}</span>
        {s.failed > 0 && <span className="text-red-600 font-semibold"> · {s.failed} failed</span>}
      </p>
    </button>
  )
}

export default function DrfonePushesPage() {
  const [date, setDate] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'devices' | 'log'>('devices')
  const [station, setStation] = useState<string | null>(null)
  const [showTests, setShowTests] = useState(false)

  // Per tester name (station / PC) for the chosen day, real devices only
  const stations = useMemo(() => {
    const m = new Map<string, { name: string; total: number; added: number; updated: number; failed: number; grades: Map<string, number> }>()
    for (const d of data?.devices || []) {
      if (d.is_test) continue
      const name = d.tester_name?.trim() || '(no tester name)'
      const s = m.get(name) || { name, total: 0, added: 0, updated: 0, failed: 0, grades: new Map() }
      s.total++
      if (d.is_new) s.added++; else s.updated++
      if (d.fail?.trim()) s.failed++
      if (d.grade) s.grades.set(d.grade, (s.grades.get(d.grade) || 0) + 1)
      m.set(name, s)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [data])

  const testCount = data?.devices.filter(d => d.is_test).length || 0
  const shown = (data?.devices || []).filter(d =>
    (showTests || !d.is_test) &&
    (!station || (d.tester_name?.trim() || '(no tester name)') === station)
  )

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/drfone/pushes${d ? `?date=${d}` : ''}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load')
      if (json.setupNeeded) { setSetupNeeded(true); setData(null); return }
      setSetupNeeded(false)
      setData(json)
      if (!d) setDate(json.date)
    } catch (e: any) {
      setError(e.message || 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load('') }, [load])

  const pick = (d: string) => { setDate(d); setStation(null); load(d) }
  const shift = (days: number) => {
    const t = new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000
    pick(new Date(t).toISOString().slice(0, 10))
  }
  const yesterday = data ? new Date(new Date(`${data.today}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : ''

  function exportExcel() {
    if (!data) return
    const rows = shown.map(d => ({
      'Pushed at (Dubai)': fmt(d.pushed_at), IMEI: d.imei, Model: d.model, GB: d.gb, Color: d.color,
      Carrier: d.carrier, Grade: d.grade, Tester: d.tester_name, 'Test time': fmt(d.test_time),
      'Battery %': d.battery_health, Fail: d.fail, Status: d.is_test ? 'Test' : d.is_new ? 'New' : 'Updated',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pushed devices')
    XLSX.writeFile(wb, `DrFone_pushes_${data.date}${station ? `_${station.replace(/\W+/g, '_')}` : ''}.xlsx`)
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dr.Fone Pushes</h2>
          <p className="text-sm text-gray-600 mt-1">
            Devices Dr.Fone sent to Stock Master, by day (Dubai time). Last successful push: <b>{fmt(data?.lastPushAt ?? null)}</b>
          </p>
        </div>
        <Link href="/dashboard/stock-master" className="shrink-0 px-4 py-2 border rounded-lg text-xs font-bold hover:bg-gray-50">
          ← Stock Master
        </Link>
      </div>

      {setupNeeded && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          The push log table isn&apos;t set up yet. Run <code>docs/drfone-push-log.sql</code> once in the Master Supabase project&apos;s SQL Editor, then reload this page.
        </div>
      )}
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Stat label="Today" s={data.stats.today} active={date === data.today} onClick={() => pick(data.today)} />
            <Stat label="Yesterday" s={data.stats.yesterday} active={date === yesterday} onClick={() => pick(yesterday)} />
            <Stat label="Last 7 days" s={data.stats.week} />
          </div>

          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">By station (tester name) · {date}</h3>
              {station && <button onClick={() => setStation(null)} className="text-xs font-bold text-blue-600">Show all stations</button>}
            </div>
            {stations.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No real devices pushed on this day.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>{['Station', 'Devices', 'New', 'Updated', 'With fails', 'Grades'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {stations.map(s => (
                    <tr
                      key={s.name}
                      onClick={() => { setStation(station === s.name ? null : s.name); setTab('devices') }}
                      className={`cursor-pointer hover:bg-gray-50 ${station === s.name ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-3 py-2 font-semibold">{s.name}</td>
                      <td className="px-3 py-2 font-bold">{s.total}</td>
                      <td className="px-3 py-2">{s.added}</td>
                      <td className="px-3 py-2">{s.updated}</td>
                      <td className={`px-3 py-2 ${s.failed ? 'text-red-600' : ''}`}>{s.failed}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{[...s.grades].sort().map(([g, n]) => `${g}: ${n}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2">{stations.reduce((a, s) => a + s.total, 0)}</td>
                    <td className="px-3 py-2">{stations.reduce((a, s) => a + s.added, 0)}</td>
                    <td className="px-3 py-2">{stations.reduce((a, s) => a + s.updated, 0)}</td>
                    <td className="px-3 py-2">{stations.reduce((a, s) => a + s.failed, 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border">
            <div className="p-4 border-b flex items-center gap-2 flex-wrap">
              <button onClick={() => shift(-1)} className="px-2 py-1.5 border rounded text-sm hover:bg-gray-50">‹</button>
              <input type="date" value={date} max={data.today} onChange={e => e.target.value && pick(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
              <button onClick={() => shift(1)} disabled={date >= data.today} className="px-2 py-1.5 border rounded text-sm hover:bg-gray-50 disabled:opacity-40">›</button>
              <span className="text-sm text-gray-600 ml-2">
                {data.stats.day.devices} devices in {data.stats.day.calls} push{data.stats.day.calls === 1 ? '' : 'es'}
                {station && <> · station <b>{station}</b></>}
              </span>
              {testCount > 0 && (
                <label className="text-xs text-gray-600 flex items-center gap-1 ml-2">
                  <input type="checkbox" checked={showTests} onChange={e => setShowTests(e.target.checked)} />
                  Show {testCount} test device{testCount === 1 ? '' : 's'}
                </label>
              )}
              <div className="ml-auto flex gap-2">
                <div className="flex border rounded overflow-hidden text-xs font-bold">
                  <button onClick={() => setTab('devices')} className={`px-3 py-1.5 ${tab === 'devices' ? 'bg-slate-900 text-white' : ''}`}>Devices</button>
                  <button onClick={() => setTab('log')} className={`px-3 py-1.5 ${tab === 'log' ? 'bg-slate-900 text-white' : ''}`}>Push log</button>
                </div>
                <button onClick={exportExcel} disabled={!shown.length} className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-bold disabled:opacity-40">Export Excel</button>
                <button onClick={() => load(date)} className="px-3 py-1.5 border rounded text-xs font-bold hover:bg-gray-50">↻ Refresh</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <p className="p-6 text-sm text-gray-500">Loading...</p>
              ) : tab === 'devices' ? (
                shown.length === 0 ? (
                  <p className="p-6 text-sm text-gray-500">{station ? 'No devices from this station.' : testCount ? 'Only test devices this day.' : 'No devices pushed on this day.'}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>{['Pushed', 'IMEI', 'Model', 'GB', 'Color', 'Grade', 'Tester', 'Battery', 'Fail', 'Status'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {shown.map(d => {
                        const label = d.is_test ? 'Test' : d.is_new ? 'New' : 'Updated'
                        const color = d.is_test ? 'bg-gray-200 text-gray-600' : d.is_new ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        return (
                          <tr key={d.imei} className={`hover:bg-gray-50 ${d.is_test ? 'opacity-60' : ''}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{time(d.pushed_at)}</td>
                            <td className="px-3 py-2 font-mono">{d.imei}</td>
                            <td className="px-3 py-2">{d.model}</td>
                            <td className="px-3 py-2">{d.gb}</td>
                            <td className="px-3 py-2">{d.color}</td>
                            <td className="px-3 py-2">{d.grade}</td>
                            <td className="px-3 py-2">{d.tester_name}</td>
                            <td className="px-3 py-2">{d.battery_health ? `${d.battery_health}%` : ''}</td>
                            <td className="px-3 py-2 text-red-600 max-w-[200px] truncate" title={d.fail || ''}>{d.fail}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${color}`}>{label}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              ) : data.logs.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">No push calls on this day.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>{['Time', 'Result', 'Received', 'New', 'Updated', 'Older skipped', 'Rejected', 'From IP', 'Note'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.logs.map(l => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{time(l.created_at)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${l.status === 200 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {l.status === 200 ? (l.dry_run ? 'Dry run' : 'OK') : `Failed ${l.status}`}
                          </span>
                        </td>
                        <td className="px-3 py-2">{l.received}</td>
                        <td className="px-3 py-2">{l.inserted}</td>
                        <td className="px-3 py-2">{l.updated}</td>
                        <td className="px-3 py-2">{l.skipped_older}</td>
                        <td className={`px-3 py-2 ${l.rejected ? 'text-red-600 font-semibold' : ''}`}>{l.rejected}</td>
                        <td className="px-3 py-2 font-mono text-xs">{l.source_ip || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{l.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
