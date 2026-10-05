'use client'

import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'

// Maps your Excel's exact header names (normalized: lowercase, no spaces)
// to the device_master column they fill. Any header NOT in this map is
// ignored, per "skip extra columns."
const HEADER_MAP: Record<string, string> = {
  modelno: 'model_no',
  modelname: 'model',
  color: 'color',
  memory: 'gb',
  carrier: 'carrier',
  serial: 'serial',
  imei: 'imei',
  imei2: 'imei2',
  firmware: 'firmware',
  version: 'version',
  os: 'os',
  fail: 'fail',
  pass: 'pass',
  wipe: 'wipe',
  fmi: 'fmi',
  jailbreak: 'jailbreak',
  regioncode: 'region_code',
  batteryserial: 'battery_serial',
  batteryhealth: 'battery_health',
  designcapacity: 'design_capacity',
  currentcapacity: 'current_capacity',
  cyclecount: 'cycle_count',
  mdmlock: 'mdm_lock',
  grade: 'grade',
  testername: 'tester_name',
  time: 'test_time',
  simlock: 'sim_lock'
}

function normalizeHeader(h: string) {
  return String(h || '').trim().toLowerCase().replace(/[\s_]/g, '')
}

const BATCH_SIZE = 500

export default function StockMasterPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<{ upserted: number; skipped: number; rowsFound: number; duplicatesMerged: number; unmatchedColumns: string[] } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setErrorMsg('')
    setSummary(null)
    setParsing(true)

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

      if (rawRows.length < 2) {
        setErrorMsg('File has no data rows.')
        setParsing(false)
        return
      }

      const headerRow = rawRows[0]
      const columnMap: { index: number; dbColumn: string }[] = []
      const unmatchedColumns: string[] = []

      headerRow.forEach((h, idx) => {
        const normalized = normalizeHeader(String(h))
        const dbColumn = HEADER_MAP[normalized]
        if (dbColumn) {
          columnMap.push({ index: idx, dbColumn })
        } else if (String(h).trim()) {
          unmatchedColumns.push(String(h).trim())
        }
      })

      if (!columnMap.some(c => c.dbColumn === 'imei')) {
        setErrorMsg('No "Imei" column found in this file — cannot proceed without it.')
        setParsing(false)
        return
      }

      const parsedRows = rawRows.slice(1)
        .filter(r => r.some(cell => String(cell).trim() !== ''))
        .map(r => {
          const obj: Record<string, string> = {}
          columnMap.forEach(({ index, dbColumn }) => {
            const val = r[index]
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              obj[dbColumn] = String(val).trim()
            }
          })
          return obj
        })

      // A single upsert statement fails if the same IMEI appears twice in
      // it ("ON CONFLICT DO UPDATE command cannot affect row a second
      // time") — real export files commonly have a device tested/logged
      // more than once. Keep the LAST occurrence of each IMEI.
      const byImei = new Map<string, Record<string, string>>()
      for (const row of parsedRows) {
        if (row.imei) byImei.set(row.imei, row)
      }
      const mappedRows = Array.from(byImei.values())
      const duplicatesMerged = parsedRows.length - mappedRows.length

      setParsing(false)
      setUploading(true)
      setProgress({ done: 0, total: mappedRows.length })

      let totalUpserted = 0
      let totalSkipped = 0

      for (let i = 0; i < mappedRows.length; i += BATCH_SIZE) {
        const batch = mappedRows.slice(i, i + BATCH_SIZE)
        const res = await fetch('/api/stock-master/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch })
        })
        const result = await res.json()
        if (!result.success) {
          setErrorMsg(`Stopped at row ${i}: ${result.error}`)
          break
        }
        totalUpserted += result.upserted
        totalSkipped += result.skipped
        setProgress({ done: Math.min(i + BATCH_SIZE, mappedRows.length), total: mappedRows.length })
      }

      setSummary({ upserted: totalUpserted, skipped: totalSkipped, rowsFound: parsedRows.length, duplicatesMerged, unmatchedColumns })
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to read file')
      setParsing(false)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Stock Master</h2>
        <p className="text-sm text-gray-600 mt-1">
          Bulk-upload your device master Excel file. Rows are matched by IMEI — uploading a file
          with an IMEI that's already in the system updates that row instead of duplicating it.
          Only the known columns are read; anything else in the file is ignored.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          disabled={parsing || uploading}
          className="block w-full text-sm border border-gray-300 rounded-lg p-2.5 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-900 file:text-white file:text-xs file:font-bold disabled:opacity-50"
        />
        {fileName && <p className="text-xs text-gray-500">Selected: {fileName}</p>}

        {parsing && <p className="text-sm text-gray-600">Reading file...</p>}

        {uploading && (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-slate-900 h-2.5 rounded-full transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">{progress.done} / {progress.total} rows uploaded...</p>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded-lg">{errorMsg}</div>
        )}

        {summary && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm p-4 rounded-lg space-y-1">
            <p><strong>{summary.upserted}</strong> rows saved to Stock Master.</p>
            {summary.skipped > 0 && <p>{summary.skipped} rows skipped (missing IMEI).</p>}
            {summary.duplicatesMerged > 0 && <p>{summary.duplicatesMerged} duplicate IMEI rows in the file were merged (last occurrence kept).</p>}
            <p className="text-xs text-emerald-700">{summary.rowsFound} data rows found in the file.</p>
            {summary.unmatchedColumns.length > 0 && (
              <p className="text-xs text-emerald-700">
                Ignored columns not in the expected list: {summary.unmatchedColumns.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}