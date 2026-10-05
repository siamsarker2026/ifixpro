'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'

interface PartRow {
  component: string
  factoryValue: string
  readValue: string
  result: 'Normal' | 'Mismatch' | 'N/A'
}

interface CheckItem {
  name: string
  result: 'Pass' | 'Fail' | 'N/A'
}

// Our own grouping/wording — not a copy of any third-party report's layout.
const DEFAULT_CHECKLIST: { group: string; items: string[] }[] = [
  { group: 'Connectivity', items: ['WiFi', 'Bluetooth', 'NFC', 'Baseband / Cellular'] },
  { group: 'Display & Camera', items: ['LCD / Display', 'Touch Digitizer', 'Screen Brightness Sensor', 'Front Camera', 'Rear Camera', 'Ultra Wide Camera', 'Face ID'] },
  { group: 'Audio', items: ['Earpiece', 'Loud Speaker', 'Front Mic', 'Bottom Mic', 'Rear Mic'] },
  { group: 'Buttons & Mechanical', items: ['Power Button', 'Volume Up', 'Volume Down', 'Mute Switch', 'Vibration Motor'] },
  { group: 'Sensors', items: ['Proximity Sensor', 'Ambient Light Sensor', 'Gyroscope', 'Accelerometer'] },
  { group: 'Power', items: ['Battery', 'Charging / USB Port'] },
  { group: 'Other', items: ['Flash', 'iCloud Lock Status'] }
]

const MAX_IMAGE_BYTES = 3 * 1024 * 1024 // 3MB — keeps the PDF a sane size

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read image file'))
    reader.readAsDataURL(file)
  })
}

// Scales to fit inside a maxW x maxH box without distorting the image —
// addImage() otherwise stretches to whatever exact size you give it.
function fitWithin(naturalW: number, naturalH: number, maxW: number, maxH: number) {
  const ratio = Math.min(maxW / naturalW, maxH / naturalH)
  return { width: naturalW * ratio, height: naturalH * ratio }
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image dimensions'))
    img.src = dataUrl
  })
}

export default function DiagnosticsReportPage() {
  const [imeiInput, setImeiInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [item, setItem] = useState<any>(null)
  const [notFound, setNotFound] = useState(false)

  const [manualModel, setManualModel] = useState('')
  const [manualColor, setManualColor] = useState('')
  const [manualStorage, setManualStorage] = useState('')

  // Device Information — not tracked elsewhere in iFix Pro, entered just for
  // this report and not saved back to repair_request_items.
  const [serialNumber, setSerialNumber] = useState('')
  const [version, setVersion] = useState('')
  const [carrier, setCarrier] = useState('')
  const [manufacturer, setManufacturer] = useState('Apple')
  const [grade, setGrade] = useState('')
  const [aNumber, setANumber] = useState('')
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0])

  // Battery Information
  const [batterySerial, setBatterySerial] = useState('')
  const [designCapacity, setDesignCapacity] = useState('')
  const [cycleCount, setCycleCount] = useState('')
  const [batteryHealth, setBatteryHealth] = useState('')

  // Lock Status — generic device-lock concepts, not any one vendor's format.
  const [fmip, setFmip] = useState<'Off' | 'On'>('Off')
  const [mdm, setMdm] = useState<'Off' | 'Locked' | 'Unlocked'>('Off')
  const [blacklistStatus, setBlacklistStatus] = useState<'Clean' | 'Blacklisted' | 'Unknown'>('Clean')
  const [simLockStatus, setSimLockStatus] = useState<'Unlocked' | 'Locked' | 'Unknown'>('Unlocked')

  // Parts verification — editable rows, defaults are just a starting point.
  const [partsRows, setPartsRows] = useState<PartRow[]>([
    { component: 'Battery', factoryValue: '', readValue: '', result: 'N/A' },
    { component: 'Display', factoryValue: '', readValue: '', result: 'N/A' },
    { component: 'Rear Camera', factoryValue: '', readValue: '', result: 'N/A' }
  ])

  // Wipe Information — no claim of any specific third-party certification.
  // Operation defaults to blank: describe your own actual process here
  // rather than it being pre-filled with anything.
  const [osVersion, setOsVersion] = useState('iOS')
  const [erasureVersion, setErasureVersion] = useState('')
  const [operation, setOperation] = useState('')
  const [wipeStatus, setWipeStatus] = useState<'Not Performed' | 'Performed' | 'Failed'>('Not Performed')
  const [wipeNotes, setWipeNotes] = useState('')

  const [checklist, setChecklist] = useState<CheckItem[]>(
    DEFAULT_CHECKLIST.flatMap(g => g.items.map(name => ({ name, result: 'Pass' as const })))
  )

  // Optional images — processed locally for the PDF only, never uploaded to
  // Supabase or any database.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const [devicePhotoDataUrl, setDevicePhotoDataUrl] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [generating, setGenerating] = useState(false)

  function cycleResult(name: string) {
    setChecklist(prev => prev.map(c => {
      if (c.name !== name) return c
      const next = c.result === 'Pass' ? 'Fail' : c.result === 'Fail' ? 'N/A' : 'Pass'
      return { ...c, result: next }
    }))
  }

  function updatePartRow(idx: number, field: keyof PartRow, value: string) {
    setPartsRows(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row))
  }

  function addPartRow() {
    setPartsRows(prev => [...prev, { component: '', factoryValue: '', readValue: '', result: 'N/A' }])
  }

  function removePartRow(idx: number) {
    setPartsRows(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, setter: (url: string | null) => void) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      alert('Please choose a PNG or JPEG image.')
      e.target.value = ''
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      alert('Image is too large (max 3MB). Please choose a smaller file.')
      e.target.value = ''
      return
    }
    try {
      const dataUrl = await readImageAsDataUrl(file)
      setter(dataUrl)
    } catch {
      alert('Could not read that image file.')
    }
    e.target.value = ''
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    const imei = imeiInput.trim()
    if (!imei) return

    setLoading(true)
    setErrorMsg('')
    setItem(null)
    setNotFound(false)

    const { data, error } = await supabase
      .from('repair_request_items')
      .select(`
        *,
        technicians_vendors!repair_request_items_technician_id_fkey (name, type)
      `)
      .eq('imei', imei)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    if (!data || data.length === 0) {
      setErrorMsg('No repair record found for this IMEI.')
      setNotFound(true)
      setLoading(false)
      return
    }

    const row = data[0]

    const { data: servicesData } = await supabase.from('services').select('id, name')
    const serviceMap = new Map((servicesData || []).map((s: any) => [s.id, s.name]))
    const serviceIds: string[] = row.service_ids || []
    const serviceNames = serviceIds.map((id: string) => serviceMap.get(id) || 'Unknown Service')

    setItem({ ...row, serviceNames })
    setLoading(false)
  }

  function handleContinueManually() {
    setItem({
      imei: imeiInput.trim(),
      model: manualModel.trim(),
      color: manualColor.trim(),
      storage_gb: manualStorage.trim(),
      isManual: true
    })
    setErrorMsg('')
    setNotFound(false)
  }

  async function handleGenerate() {
    if (!item) return
    setGenerating(true)

    try {
      const qrText = [
        'iFix Pro Diagnostics Report',
        `IMEI: ${item.imei}`,
        serialNumber ? `Serial: ${serialNumber}` : null,
        `Model: ${item.model || '—'}`,
        `Storage: ${item.storage_gb || '—'} GB`,
        `Color: ${item.color || '—'}`,
        grade ? `Grade: ${grade}` : null,
        batteryHealth ? `Battery Health: ${batteryHealth}%` : null,
        `Date: ${reportDate}`
      ].filter(Boolean).join('\n')

      const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 240 })

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const marginX = 14
      const bottomMargin = 20

      // Keeps a section from starting right at the bottom edge and then
      // awkwardly spilling onto the next page mid-block.
      function ensureSpace(doc: jsPDF, y: number, needed: number) {
        if (y + needed > pageHeight - bottomMargin) {
          doc.addPage()
          return 20
        }
        return y
      }

      // ---- Header: QR top-left, centered title, optional logo top-right ----
      const headerHeight = 34
      doc.setFillColor(15, 23, 42)
      doc.rect(0, 0, pageWidth, headerHeight, 'F')

      doc.addImage(qrDataUrl, 'PNG', marginX, 5, 24, 24)

      doc.setTextColor(255, 255, 255)
      doc.setFontSize(15)
      doc.setFont('helvetica', 'bold')
      const title = 'iFix Pro — Device Diagnostics Report'
      const titleWidth = doc.getTextWidth(title)
      doc.text(title, (pageWidth - titleWidth) / 2, 20)

      if (logoDataUrl) {
        try {
          const dims = await getImageDimensions(logoDataUrl)
          const { width, height } = fitWithin(dims.width, dims.height, 24, 24)
          // Right-align and vertically center within the reserved 24x24 box.
          doc.addImage(logoDataUrl, pageWidth - 14 - width, 5 + (24 - height) / 2, width, height)
        } catch {
          // Malformed image data — skip rather than crash the whole PDF.
        }
      }

      doc.setDrawColor(255, 255, 255)
      doc.setLineWidth(0.3)
      doc.line(marginX, 26, pageWidth - marginX, 26)

      doc.setTextColor(0, 0, 0)
      let y = headerHeight + 10

      function sectionTitle(title: string) {
        y = ensureSpace(doc, y, 14)
        doc.setFillColor(226, 232, 240)
        doc.rect(marginX, y - 5, pageWidth - marginX * 2, 7, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text(title, marginX + 2, y)
        y += 10
      }

      function field(label: string, value: string, x: number) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.text(`${label}:`, x, y)
        doc.setFont('helvetica', 'normal')
        const maxWidth = x < 110 ? 90 : pageWidth - marginX - x - 32
        const text = doc.splitTextToSize(value || '—', maxWidth)
        doc.text(text, x + 32, y)
      }

      // ---- Device Information ----
      sectionTitle('Device Information')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text(item.model || 'Unknown Model', marginX + 2, y)
      y += 8

      const storageText = item.storage_gb
        ? (String(item.storage_gb).toUpperCase().includes('GB') ? String(item.storage_gb) : `${item.storage_gb} GB`)
        : ''

      field('IMEI', item.imei, marginX); field('Version', version, 110); y += 7
      field('Serial Number', serialNumber, marginX); field('Carrier', carrier, 110); y += 7
      field('Model', item.model, marginX); field('Manufacturer', manufacturer, 110); y += 7
      field('Colour', item.color, marginX); field('Grade', grade, 110); y += 7
      field('Memory', storageText, marginX); field('A Number', aNumber, 110); y += 12

      // ---- Battery Information ----
      sectionTitle('Battery Information')
      field('Battery Serial Number', batterySerial, marginX); field('Design Capacity', designCapacity ? `${designCapacity} mAh` : '', 110); y += 7
      field('Cycle Count', cycleCount, marginX); field('Battery Health', batteryHealth ? `${batteryHealth}%` : '', 110); y += 12

      // ---- Locks Information ----
      sectionTitle('Locks Information')
      field('FMIP', fmip, marginX); field('MDM', mdm, 110); y += 7
      field('Blacklist', blacklistStatus, marginX); field('SIM Lock', simLockStatus, 110); y += 10

      // ---- Optional device photo ----
      if (devicePhotoDataUrl) {
        y = ensureSpace(doc, y, 48)
        try {
          const dims = await getImageDimensions(devicePhotoDataUrl)
          const { width, height } = fitWithin(dims.width, dims.height, 40, 40)
          doc.addImage(devicePhotoDataUrl, marginX, y, width, height)
          y += height + 6
        } catch {
          // Skip silently rather than crash the PDF on bad image data.
        }
      }

      // ---- Parts Info ----
      if (partsRows.length > 0) {
        sectionTitle('Parts Info')
        autoTable(doc, {
          head: [['Component', 'Factory Value', 'Read Value', 'Result']],
          body: partsRows.filter(r => r.component.trim()).map(r => [r.component, r.factoryValue || '—', r.readValue || '—', r.result]),
          startY: y,
          margin: { left: marginX, right: marginX },
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 23, 42] }
        })
        // @ts-ignore - autoTable attaches this to the doc instance
        y = doc.lastAutoTable.finalY + 10
      }

      // ---- Wipe Information ----
      y = ensureSpace(doc, y, 30)
      sectionTitle('Wipe Information')
      field('Erasure Version', erasureVersion, marginX); field('OS Version', osVersion, 110); y += 7
      const erasureResult = wipeStatus === 'Performed' ? 'Pass' : wipeStatus === 'Failed' ? 'Fail' : 'Not Performed'
      field('Erasure Result', erasureResult, marginX); field('Operation', operation, 110); y += 7
      if (wipeNotes) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.text(`Notes: ${wipeNotes}`, marginX, y)
        y += 6
      }
      y += 6

      // ---- Diagnostics Information — 3 columns ----
      y = ensureSpace(doc, y, 20)
      sectionTitle('Diagnostics Information')

      const triples: string[][] = []
      for (let i = 0; i < checklist.length; i += 3) {
        const chunk = checklist.slice(i, i + 3)
        const row: string[] = []
        for (let c = 0; c < 3; c++) {
          row.push(chunk[c]?.name || '')
          row.push(chunk[c]?.result || '')
        }
        triples.push(row)
      }

      autoTable(doc, {
        body: triples,
        startY: y,
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: {
          0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' }, 4: { fontStyle: 'bold' }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && [1, 3, 5].includes(data.column.index)) {
            const val = data.cell.raw as string
            if (val === 'Pass') data.cell.styles.textColor = [16, 128, 80]
            else if (val === 'Fail') data.cell.styles.textColor = [185, 28, 28]
            else data.cell.styles.textColor = [120, 120, 120]
          }
        }
      })

      // @ts-ignore
      y = doc.lastAutoTable.finalY + 8

      // ---- Footer: overall result + date, consistent on every page ----
      const overallResult = checklist.some(c => c.result === 'Fail') ? 'Fail' : 'Pass'
      const pageCount = doc.internal.pages.length - 1
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p)
        doc.setDrawColor(200, 200, 200)
        doc.setLineWidth(0.2)
        doc.line(marginX, pageHeight - 14, pageWidth - marginX, pageHeight - 14)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(0, 0, 0)
        doc.text(`Result: ${overallResult}   ·   Date: ${reportDate}`, marginX, pageHeight - 8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(120, 120, 120)
        doc.text(`iFix Pro — Page ${p} of ${pageCount}`, pageWidth - marginX - 40, pageHeight - 8)
      }

      doc.save(`iFixPro_Diagnostics_${item.imei}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Diagnostics Report</h2>
        <p className="text-sm text-gray-600 mt-1">
          Generates an iFix Pro-branded PDF report from this IMEI's actual record, plus device
          details you enter below.
        </p>
      </div>

      <form onSubmit={handleLookup} className="bg-white p-4 rounded-lg shadow-sm border flex gap-3">
        <input
          type="text"
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          placeholder="Enter IMEI to load its record..."
          className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm font-mono focus:ring-2 focus:ring-slate-900 outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </form>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded-lg">{errorMsg}</div>
      )}

      {notFound && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-bold text-amber-900">
            Not in iFix Pro? If the phone is physically with you, you can still generate a report —
            just enter its details manually below.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <input value={manualModel} onChange={(e) => setManualModel(e.target.value)} placeholder="Model (e.g. iPhone 13)" className="border border-gray-300 rounded-lg p-2 text-sm" />
            <input value={manualColor} onChange={(e) => setManualColor(e.target.value)} placeholder="Color" className="border border-gray-300 rounded-lg p-2 text-sm" />
            <input value={manualStorage} onChange={(e) => setManualStorage(e.target.value)} placeholder="Storage (e.g. 128GB)" className="border border-gray-300 rounded-lg p-2 text-sm" />
          </div>
          <button
            onClick={handleContinueManually}
            disabled={!manualModel.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold"
          >
            Continue Without a Database Record
          </button>
        </div>
      )}

      {item && (
        <div className="bg-white p-6 rounded-lg shadow-sm border space-y-6">
          {item.isManual && (
            <span className="inline-block bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full">
              Manually entered — no iFix Pro record for this IMEI
            </span>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="font-bold text-gray-700">IMEI:</span> <span className="font-mono">{item.imei}</span></div>
            <div><span className="font-bold text-gray-700">Model:</span> {item.model || '—'}</div>
            <div><span className="font-bold text-gray-700">Storage:</span> {item.storage_gb ? (String(item.storage_gb).toUpperCase().includes('GB') ? item.storage_gb : `${item.storage_gb} GB`) : '—'}</div>
            <div><span className="font-bold text-gray-700">Color:</span> {item.color || '—'}</div>
            {!item.isManual && (
              <>
                <div><span className="font-bold text-gray-700">Technician:</span> {item.technicians_vendors?.name || 'Unassigned'}</div>
                <div><span className="font-bold text-gray-700">Status:</span> {item.current_status || 'Assigned'}</div>
              </>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Device Information — not tracked in iFix Pro yet</p>
            <div className="grid grid-cols-3 gap-3">
              <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="Serial Number" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Manufacturer" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Grade (e.g. A3)" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={aNumber} onChange={(e) => setANumber(e.target.value)} placeholder="A Number" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-sm col-span-3 md:col-span-1" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Battery Information</p>
            <div className="grid grid-cols-2 gap-3">
              <input value={batterySerial} onChange={(e) => setBatterySerial(e.target.value)} placeholder="Battery Serial Number" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={designCapacity} onChange={(e) => setDesignCapacity(e.target.value)} placeholder="Design Capacity (mAh)" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={cycleCount} onChange={(e) => setCycleCount(e.target.value)} placeholder="Cycle Count" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={batteryHealth} onChange={(e) => setBatteryHealth(e.target.value)} placeholder="Battery Health (%)" className="border border-gray-300 rounded-lg p-2 text-sm" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Lock Status</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                FMIP
                <select value={fmip} onChange={(e) => setFmip(e.target.value as any)} className="font-semibold">
                  <option>Off</option><option>On</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                MDM
                <select value={mdm} onChange={(e) => setMdm(e.target.value as any)} className="font-semibold">
                  <option>Off</option><option>Locked</option><option>Unlocked</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                Blacklist
                <select value={blacklistStatus} onChange={(e) => setBlacklistStatus(e.target.value as any)} className="font-semibold">
                  <option>Clean</option><option>Blacklisted</option><option>Unknown</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                SIM Lock
                <select value={simLockStatus} onChange={(e) => setSimLockStatus(e.target.value as any)} className="font-semibold">
                  <option>Unlocked</option><option>Locked</option><option>Unknown</option>
                </select>
              </label>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Optional Images (processed locally — not uploaded anywhere)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-600 mb-1">Company Logo (top-right of PDF)</p>
                {logoDataUrl ? (
                  <div className="flex items-center gap-2">
                    <img src={logoDataUrl} alt="Logo preview" className="h-12 w-12 object-contain border rounded" />
                    <button type="button" onClick={() => setLogoDataUrl(null)} className="text-xs text-red-600 font-bold">Remove</button>
                    <button type="button" onClick={() => logoInputRef.current?.click()} className="text-xs text-slate-700 font-bold">Replace</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => logoInputRef.current?.click()} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg font-bold text-gray-700">
                    Upload Logo
                  </button>
                )}
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => handleImageUpload(e, setLogoDataUrl)} />
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Device Photo (optional)</p>
                {devicePhotoDataUrl ? (
                  <div className="flex items-center gap-2">
                    <img src={devicePhotoDataUrl} alt="Device preview" className="h-12 w-12 object-cover border rounded" />
                    <button type="button" onClick={() => setDevicePhotoDataUrl(null)} className="text-xs text-red-600 font-bold">Remove</button>
                    <button type="button" onClick={() => photoInputRef.current?.click()} className="text-xs text-slate-700 font-bold">Replace</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => photoInputRef.current?.click()} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg font-bold text-gray-700">
                    Upload Photo
                  </button>
                )}
                <input ref={photoInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => handleImageUpload(e, setDevicePhotoDataUrl)} />
              </div>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-gray-500 uppercase">Parts Verification</p>
              <button type="button" onClick={addPartRow} className="text-xs font-bold text-slate-900 hover:underline">+ Add Row</button>
            </div>
            {partsRows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-2 items-center">
                <input value={row.component} onChange={(e) => updatePartRow(idx, 'component', e.target.value)} placeholder="Component" className="border border-gray-300 rounded-lg p-2 text-xs col-span-2" />
                <input value={row.factoryValue} onChange={(e) => updatePartRow(idx, 'factoryValue', e.target.value)} placeholder="Factory Value" className="border border-gray-300 rounded-lg p-2 text-xs" />
                <input value={row.readValue} onChange={(e) => updatePartRow(idx, 'readValue', e.target.value)} placeholder="Read Value" className="border border-gray-300 rounded-lg p-2 text-xs" />
                <div className="flex gap-1">
                  <select value={row.result} onChange={(e) => updatePartRow(idx, 'result', e.target.value)} className="border border-gray-300 rounded-lg p-2 text-xs flex-1">
                    <option>N/A</option><option>Normal</option><option>Mismatch</option>
                  </select>
                  <button type="button" onClick={() => removePartRow(idx)} className="text-red-500 text-xs font-bold px-1">×</button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Wipe Information</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <input value={erasureVersion} onChange={(e) => setErasureVersion(e.target.value)} placeholder="Erasure Version" className="border border-gray-300 rounded-lg p-2" />
              <input value={osVersion} onChange={(e) => setOsVersion(e.target.value)} placeholder="OS Version" className="border border-gray-300 rounded-lg p-2" />
              <select value={wipeStatus} onChange={(e) => setWipeStatus(e.target.value as any)} className="border border-gray-300 rounded-lg p-2">
                <option>Not Performed</option><option>Performed</option><option>Failed</option>
              </select>
              <input value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="Operation (describe what was actually done)" className="border border-gray-300 rounded-lg p-2" />
            </div>
            <input value={wipeNotes} onChange={(e) => setWipeNotes(e.target.value)} placeholder="Notes (optional)" className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Diagnostics Checklist — click a result to cycle Pass / Fail / N/A</p>
            {DEFAULT_CHECKLIST.map(group => (
              <div key={group.group}>
                <p className="text-xs font-bold text-gray-600 mt-2">{group.group}</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {group.items.map(name => {
                    const checkItem = checklist.find(c => c.name === name)!
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => cycleResult(name)}
                        className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <span>{name}</span>
                        <span className={`font-bold ${
                          checkItem.result === 'Pass' ? 'text-emerald-600' :
                          checkItem.result === 'Fail' ? 'text-red-600' : 'text-gray-400'
                        }`}>{checkItem.result}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate & Download PDF'}
          </button>
        </div>
      )}
    </div>
  )
}