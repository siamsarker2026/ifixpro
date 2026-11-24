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

// Diagnostics test items, in report order. When the IMEI has a Dr.Fone test in
// Stock Master, the list is replaced by that test's own Pass/Fail items.
const DEFAULT_TESTS = [
  'Proximity', 'Flip Switch', 'Bluetooth', 'Front Shaking Camera', 'Rear Mic', 'Flash', 'Face ID', 'FrontCamera',
  'Front Mic', 'Accelerometer', 'Gyroscope', 'Loud Speaker', 'NFC', 'Ultra Wide Camera', 'Screen Rotation', 'WiFi',
  'Dot Projector', 'LCD', 'RearCamera', 'Bottom Mic', 'USB IC', 'Digitizer', 'Volume Down Button', 'Volume Up Button',
  'Brightness', 'Buttons', 'Infared Camera', 'Power Button', 'Earpiece', 'Device Vibration', 'Baseband', 'Battery', 'iCloud',
]
const DEFAULT_PARTS = ['Battery', 'Display', 'Camera', 'Bluetooth', 'Board', 'FaceID', 'FrontCamera', 'RearCamera']
const splitList = (v: unknown) => String(v ?? '').split(',').map(x => x.trim()).filter(Boolean)

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
  const [aNumber, setANumber] = useState('')
  const [testerName, setTesterName] = useState('')
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0])

  // Battery Information
  const [batterySerial, setBatterySerial] = useState('')
  const [designCapacity, setDesignCapacity] = useState('')
  const [cycleCount, setCycleCount] = useState('')
  const [batteryHealth, setBatteryHealth] = useState('')
  const [currentCapacity, setCurrentCapacity] = useState('')

  // Lock Status — generic device-lock concepts, not any one vendor's format.
  const [fmip, setFmip] = useState('Off')          // FRP / Find My
  const [mdm, setMdm] = useState('Unlock')
  const [blacklistStatus, setBlacklistStatus] = useState('Clean')
  const [simLockStatus, setSimLockStatus] = useState('Unlocked')
  const [idLock, setIdLock] = useState('Off')

  // Parts verification — editable rows, defaults are just a starting point.
  const [partsRows, setPartsRows] = useState<PartRow[]>(
    DEFAULT_PARTS.map(component => ({ component, factoryValue: '', readValue: '', result: 'Normal' as const }))
  )

  // Wipe Information — no claim of any specific third-party certification.
  // Operation defaults to blank: describe your own actual process here
  // rather than it being pre-filled with anything.
  const [osVersion, setOsVersion] = useState('iOS')
  const [operation, setOperation] = useState('')
  const [wipedResult, setWipedResult] = useState('YES')
  const [drfoneFound, setDrfoneFound] = useState<boolean | null>(null)

  const [checklist, setChecklist] = useState<CheckItem[]>(DEFAULT_TESTS.map(name => ({ name, result: 'Pass' as const })))

  // Optional images — processed locally for the PDF only, never uploaded to
  // Supabase or any database.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

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

  // Fill the report from the Dr.Fone test stored in Stock Master (device_master).
  function applyDrfone(d: any) {
    const v = (x: unknown) => (x === null || x === undefined ? '' : String(x))
    setSerialNumber(v(d.serial)); setVersion(v(d.version)); setCarrier(v(d.carrier))
    setTesterName(v(d.tester_name)); setOsVersion(v(d.os) || 'iOS')
    setBatterySerial(v(d.battery_serial)); setDesignCapacity(v(d.design_capacity)); setCycleCount(v(d.cycle_count))
    setBatteryHealth(v(d.battery_health)); setCurrentCapacity(v(d.current_capacity))
    if (d.fmi) setFmip(v(d.fmi))
    if (d.mdm_lock) setMdm(v(d.mdm_lock))
    if (d.sim_lock) setSimLockStatus(v(d.sim_lock))
    if (d.wipe) setWipedResult(v(d.wipe).toUpperCase())
    if (d.test_time) {
      const t = new Date(d.test_time)
      if (!isNaN(t.getTime())) setReportDate(t.toISOString().split('T')[0])
    }
    const pass = splitList(d.pass), fail = splitList(d.fail)
    if (pass.length + fail.length > 0) {
      const failSet = new Set(fail.map(x => x.toLowerCase()))
      const names = Array.from(new Set([...pass, ...fail]))
      setChecklist(names.map(name => ({ name, result: failSet.has(name.toLowerCase()) ? 'Fail' as const : 'Pass' as const })))
    }
    if (d.battery_serial) {
      setPartsRows(prev => prev.map(r => r.component === 'Battery' && !r.factoryValue
        ? { ...r, factoryValue: v(d.battery_serial), readValue: v(d.battery_serial) } : r))
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    const imei = imeiInput.trim()
    if (!imei) return

    setLoading(true)
    setErrorMsg('')
    setItem(null)
    setNotFound(false)
    setDrfoneFound(null)

    const [{ data, error }, deviceRes] = await Promise.all([
      supabase
        .from('repair_request_items')
        .select(`
          *,
          technicians_vendors!repair_request_items_technician_id_fkey (name, type)
        `)
        .eq('imei', imei)
        .order('created_at', { ascending: false })
        .limit(1),
      /^\d{15}$/.test(imei) ? fetch(`/api/device?imei=${imei}`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
    ])
    const device = deviceRes?.success ? deviceRes.device : null
    setDrfoneFound(!!device)
    if (device) applyDrfone(device)

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }
    if (!data || data.length === 0) {
      if (device) {
        // Not in repairs, but tested by Dr.Fone: build the report from that.
        setItem({ imei, model: device.model || '', color: device.color || '', storage_gb: device.gb || '', isManual: false, fromDrfone: true })
      } else {
        setErrorMsg('No repair record or Dr.Fone test found for this IMEI.')
        setNotFound(true)
      }
      setLoading(false)
      return
    }

    const row = data[0]

    const { data: servicesData } = await supabase.from('services').select('id, name')
    const serviceMap = new Map((servicesData || []).map((s: any) => [s.id, s.name]))
    const serviceIds: string[] = row.service_ids || []
    const serviceNames = serviceIds.map((id: string) => serviceMap.get(id) || 'Unknown Service')

    setItem({
      ...row,
      model: row.model || device?.model || '',
      color: row.color || device?.color || '',
      storage_gb: row.storage_gb || device?.gb || '',
      serviceNames,
    })
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
      // ---------------------------------------------------------------
      // Fixed report layout (A4, mm). Sections, order and field pairs
      // follow the agreed sample; change them here only on purpose.
      // ---------------------------------------------------------------
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()
      const H = doc.internal.pageSize.getHeight()
      const X = 10
      const COL2 = 108                   // second label column
      const VAL_OFFSET = 48              // label -> value gap
      const BAND: [number, number, number] = [30, 192, 238]
      const GREEN: [number, number, number] = [40, 167, 69]
      const RED: [number, number, number] = [200, 35, 35]
      const BOTTOM = 18
      let y = 0

      const newPageIfNeeded = (needed: number) => {
        if (y + needed > H - BOTTOM) { doc.addPage(); y = 16 }
      }
      const resultColor = (v: string) => (/^(pass|normal)$/i.test(v) ? GREEN : /^(fail|mismatch)$/i.test(v) ? RED : [110, 110, 110] as [number, number, number])

      // ---- Header: title, coloured band with subtitle, logo on the right ----
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(0, 0, 0)
      doc.text('Device Diagnostics Report', X, 18)
      doc.setFillColor(...BAND)
      doc.rect(0, 23, 138, 10, 'F')
      doc.rect(182, 23, W - 182, 10, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(255, 255, 255)
      doc.text('This diagnostics report is generated and certified by Dr Fones!', X, 29.5)
      // Logo: one uploaded on this page wins; otherwise the permanent company
      // logo at public/report-logo.png (skipped if that file is missing).
      let logo = logoDataUrl
      if (!logo) {
        try {
          const res = await fetch('/report-logo.png', { cache: 'no-store' })
          if (res.ok && res.headers.get('content-type')?.startsWith('image/')) {
            const blob = await res.blob()
            logo = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = reject
              r.readAsDataURL(blob)
            })
          }
        } catch { /* no permanent logo */ }
      }
      if (logo) {
        try {
          const dims = await getImageDimensions(logo)
          const { width, height } = fitWithin(dims.width, dims.height, 42, 26)
          doc.addImage(logo, 160 - width / 2, 8 + (26 - height) / 2, width, height)
        } catch { /* bad image: leave the space empty */ }
      }
      doc.setTextColor(0, 0, 0)
      y = 44

      const heading = (title: string, underline = false) => {
        newPageIfNeeded(16)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(15)
        doc.setTextColor(0, 0, 0)
        doc.text(title, X, y)
        if (underline) {
          doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4)
          doc.line(X, y + 1.2, X + doc.getTextWidth(title), y + 1.2)
        }
        y += 8
      }
      // Two label/value pairs per line; a missing pair leaves its half empty.
      const pairs = (rows: [string, string, string?, string?][]) => {
        rows.forEach(([l1, v1, l2, v2]) => {
          newPageIfNeeded(7)
          doc.setFontSize(10.5)
          doc.setFont('helvetica', 'bold'); doc.text(`${l1} :`, X + 1, y)
          doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(v1 || 'N/A', COL2 - X - VAL_OFFSET - 2)[0], X + VAL_OFFSET, y)
          if (l2) {
            doc.setFont('helvetica', 'bold'); doc.text(`${l2} :`, COL2, y)
            doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(v2 || 'N/A', W - COL2 - VAL_OFFSET - X)[0], COL2 + VAL_OFFSET - 6, y)
          }
          y += 6.5
        })
        y += 3
      }

      const memory = item.storage_gb
        ? (String(item.storage_gb).toUpperCase().includes('GB') ? String(item.storage_gb) : `${item.storage_gb}GB`)
        : ''

      // ---- Device Information ----
      heading('Device Information')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
      doc.text(item.model || 'Unknown Model', X, y); y += 8
      pairs([
        ['IMEI', item.imei, 'Version', version],
        ['Serial Number', serialNumber, 'Carrier', carrier],
        ['Model', item.model, 'Manufacture', manufacturer],
        ['Color', item.color, 'Memory', memory],
        ['ANumber', aNumber, 'Tester Name', testerName],
      ])

      // ---- Battery Information ----
      heading('Battery Information')
      pairs([
        ['Serial Number', batterySerial, 'Design Capacity', designCapacity],
        ['Cycle Count', cycleCount, 'Battery Health', batteryHealth ? `${String(batteryHealth).replace('%', '')}%` : ''],
        ['Current Capacity', currentCapacity],
      ])

      // ---- Locks Information ----
      heading('Locks Information')
      pairs([
        ['FRP', fmip, 'MDM', mdm],
        ['Blacklist', blacklistStatus, 'SIM', simLockStatus],
        ['ID Lock', idLock],
      ])

      // ---- Parts Information ----
      const parts = partsRows.filter(r => r.component.trim())
      if (parts.length > 0) {
        y += 2
        heading('Parts Information', true)
        autoTable(doc, {
          head: [['Test Item', 'Factory Value', 'Read Value', 'Result']],
          body: parts.map(r => [r.component, r.factoryValue || 'N/A', r.readValue || 'N/A', r.result]),
          startY: y,
          margin: { left: X, right: X, bottom: BOTTOM },
          theme: 'plain',
          styles: { fontSize: 8, cellPadding: { top: 0.8, bottom: 0.8, left: 0.5, right: 1 }, textColor: 0 },
          headStyles: { fontSize: 11, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 66 }, 2: { cellWidth: 66 }, 3: { cellWidth: 30 } },
          didParseCell: d => {
            if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = resultColor(String(d.cell.raw))
          },
        })
        // @ts-expect-error autoTable adds lastAutoTable to the doc
        y = doc.lastAutoTable.finalY + 8
      }

      // ---- Wipe Information ----
      heading('Wipe Information')
      newPageIfNeeded(14)
      doc.setFontSize(10.5)
      doc.setFont('helvetica', 'bold'); doc.text('OS Version :', X + 1, y)
      doc.setFont('helvetica', 'normal'); doc.text(osVersion || 'N/A', X + 45, y)
      doc.setFont('helvetica', 'bold'); doc.text('Wiped Result :', 95, y)
      const wipedLabelW = doc.getTextWidth('Wiped Result : ')
      doc.setFont('helvetica', 'normal'); doc.text(wipedResult || 'N/A', 95 + wipedLabelW, y)
      y += 6.5
      doc.setFont('helvetica', 'bold'); doc.text('Operation :', X + 1, y)
      doc.setFont('helvetica', 'normal'); doc.text(operation || 'N/A', X + 45, y)
      y += 12

      // ---- Diagnostics Information: two columns of test / result ----
      newPageIfNeeded(24)
      doc.setFillColor(...BAND)
      doc.rect(X + 1, y - 7, 75, 0.9, 'F')
      heading('Diagnostics Information')
      y += 2
      const tests = checklist.filter(c => c.name.trim())
      const half = Math.ceil(tests.length / 2)
      const body: string[][] = []
      for (let i = 0; i < half; i++) {
        const a = tests[i * 2], b = tests[i * 2 + 1]
        body.push([a?.name || '', a?.result || '', b?.name || '', b?.result || ''])
      }
      autoTable(doc, {
        body,
        startY: y,
        margin: { left: X, right: X, bottom: BOTTOM },
        theme: 'plain',
        styles: { fontSize: 11, fontStyle: 'bold', cellPadding: { top: 1, bottom: 1, left: 0.5, right: 1 }, textColor: 0 },
        columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 23 }, 2: { cellWidth: 60 }, 3: { cellWidth: 25 } },
        didParseCell: d => {
          if (d.column.index === 1 || d.column.index === 3) d.cell.styles.textColor = resultColor(String(d.cell.raw))
        },
      })
      // @ts-expect-error autoTable adds lastAutoTable to the doc
      y = doc.lastAutoTable.finalY + 10

      // ---- Testing score, date and QR ----
      const scored = tests.filter(t => t.result !== 'N/A')
      const score = scored.length ? Math.round((scored.filter(t => t.result === 'Pass').length / scored.length) * 100) : 0
      const qrText = [
        'https://ifix.glpwms.com',
        'iFix Pro Diagnostics Report',
        `IMEI: ${item.imei}`,
        serialNumber ? `Serial: ${serialNumber}` : null,
        `Model: ${item.model || '-'}`,
        `Testing Score: ${score}`,
        `Date: ${reportDate}`,
      ].filter(Boolean).join('\n')
      const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 240 })

      newPageIfNeeded(62)
      // QR code at the right of the diagnostics heading (like the sample)
      // is placed below instead, beside the stamp, to keep the tests column clear.

      // Score box: green border, "Testing Score  N", five stars, date below.
      const boxX = X - 3, boxY = y, boxW = 66, boxH = 26
      doc.setDrawColor(...GREEN); doc.setLineWidth(1.2)
      doc.roundedRect(boxX, boxY, boxW, boxH, 1, 1, 'S')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0, 0, 0)
      const label = 'Testing Score'
      const scoreText = String(score)
      doc.setFontSize(13); const lw = doc.getTextWidth(label)
      doc.setFontSize(19); const sw = doc.getTextWidth(scoreText)
      const startX = boxX + (boxW - (lw + 8 + sw)) / 2
      doc.setFontSize(13); doc.text(label, startX, boxY + 10)
      doc.setFontSize(19); doc.setTextColor(...GREEN); doc.text(scoreText, startX + lw + 8, boxY + 10.5)

      // Stars: filled for each 20 points (rounded), outline for the rest.
      const STAR_GREEN: [number, number, number] = [95, 190, 95]
      const filled = Math.round(score / 20)
      const star = (cx: number, cy: number, r: number, fill: boolean) => {
        const pts: [number, number][] = []
        for (let k = 0; k < 10; k++) {
          const ang = -Math.PI / 2 + (k * Math.PI) / 5
          const rad = k % 2 === 0 ? r : r * 0.42
          pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)])
        }
        const segs = pts.slice(1).map((pt, k) => [pt[0] - pts[k][0], pt[1] - pts[k][1]])
        doc.setFillColor(...STAR_GREEN); doc.setDrawColor(...STAR_GREEN); doc.setLineWidth(0.4)
        doc.lines(segs, pts[0][0], pts[0][1], [1, 1], fill ? 'F' : 'S', true)
      }
      const r = 3.6, gap = 9.2
      const firstX = boxX + boxW / 2 - 2 * gap
      for (let k = 0; k < 5; k++) star(firstX + k * gap, boxY + 18.5, r, k < filled)

      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(0, 0, 0)
      doc.text(`Date: ${reportDate}`, boxX + boxW / 2, boxY + boxH + 8, { align: 'center' })

      // "TESTED / APPROVED" round stamp with the approver underneath.
      const cx = 105, cy = boxY + 12.8, R = 12.8
      doc.setDrawColor(25, 25, 25); doc.setTextColor(25, 25, 25)
      doc.setLineWidth(1.1); doc.circle(cx, cy, R, 'S')
      doc.setLineWidth(0.5); doc.circle(cx, cy, R * 0.87, 'S')
      doc.setLineWidth(0.5); doc.circle(cx, cy, R * 0.51, 'S')
      const arcText = (text: string, radius: number, startDeg: number, endDeg: number, top: boolean) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(5.2)
        const chars = text.split('')
        chars.forEach((ch, idx) => {
          const t = chars.length === 1 ? 0.5 : idx / (chars.length - 1)
          const deg = startDeg + (endDeg - startDeg) * t
          const rad = (deg * Math.PI) / 180
          const px = cx + radius * Math.cos(rad), py = cy + radius * Math.sin(rad)
          const rot = top ? -(deg + 90) : -(deg - 90)
          doc.text(ch, px, py, { angle: rot, align: 'center', baseline: 'middle' })
        })
      }
      arcText('APPROVED', R * 0.69, 238, 302, true)
      arcText('APPROVED', R * 0.69, 122, 58, false)
      // Band across the middle with TESTED, slightly tilted like a stamp
      doc.setFillColor(255, 255, 255)
      doc.setLineWidth(0.8)
      const tilt = -11, tr = (tilt * Math.PI) / 180
      const bw = 2 * R + 3, bh = 5.8
      const corner = (dx: number, dy: number): [number, number] => [cx + dx * Math.cos(tr) - dy * Math.sin(tr), cy + dx * Math.sin(tr) + dy * Math.cos(tr)]
      const c1 = corner(-bw / 2, -bh / 2), c2 = corner(bw / 2, -bh / 2), c3 = corner(bw / 2, bh / 2), c4 = corner(-bw / 2, bh / 2)
      doc.lines([[c2[0] - c1[0], c2[1] - c1[1]], [c3[0] - c2[0], c3[1] - c2[1]], [c4[0] - c3[0], c4[1] - c3[1]]], c1[0], c1[1], [1, 1], 'FD', true)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
      doc.text('TESTED', cx, cy, { angle: -tilt, align: 'center', baseline: 'middle' })
      doc.setFontSize(4.6); doc.text('* * *', cx, cy - 5, { align: 'center', baseline: 'middle' })
      doc.text('* * *', cx, cy + 5.5, { align: 'center', baseline: 'middle' })

      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(0, 0, 0)
      doc.text('Approved by iFix Pro', cx, cy + R + 8, { align: 'center' })

      // QR to the far right, for scanning the device summary
      doc.addImage(qrDataUrl, 'PNG', 159, boxY, 25.7, 25.7)
      // Under the QR: the site, on the same line as "Approved by" and "Date"
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0)
      doc.text('ifix.glpwms.com', 159 + 25.7 / 2, cy + R + 8, { align: 'center' })
      y = boxY + boxH + 18

      // ---- Page numbers ----
      const pageCount = doc.getNumberOfPages()
      for (let pg = 1; pg <= pageCount; pg++) {
        doc.setPage(pg)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 140)
        doc.text(`Page ${pg} of ${pageCount}`, W - X, H - 8, { align: 'right' })
      }

      doc.save(`Diagnostics_${item.imei}.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Diagnostics Report</h2>
        <p className="text-sm text-gray-600 mt-1">
          Fixed report format. Loads the device from repairs and its Dr.Fone test in Stock Master; check the details and download the PDF.
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

          {drfoneFound !== null && (
            <div className={`text-xs p-2.5 rounded-lg border ${drfoneFound ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
              {drfoneFound ? 'Filled from the Dr.Fone test in Stock Master. Check the details, then download.' : 'No Dr.Fone test found for this IMEI. Fill the details in by hand.'}
            </div>
          )}

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Device Information</p>
            <div className="grid grid-cols-3 gap-3">
              <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="Serial Number" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Manufacture" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={aNumber} onChange={(e) => setANumber(e.target.value)} placeholder="ANumber (e.g. A2881)" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={testerName} onChange={(e) => setTesterName(e.target.value)} placeholder="Tester Name" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <label className="text-xs text-gray-500 flex flex-col gap-1">Report date
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-sm" />
              </label>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Battery Information</p>
            <div className="grid grid-cols-2 gap-3">
              <input value={batterySerial} onChange={(e) => setBatterySerial(e.target.value)} placeholder="Battery Serial Number" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={designCapacity} onChange={(e) => setDesignCapacity(e.target.value)} placeholder="Design Capacity" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={cycleCount} onChange={(e) => setCycleCount(e.target.value)} placeholder="Cycle Count" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={batteryHealth} onChange={(e) => setBatteryHealth(e.target.value)} placeholder="Battery Health (%)" className="border border-gray-300 rounded-lg p-2 text-sm" />
              <input value={currentCapacity} onChange={(e) => setCurrentCapacity(e.target.value)} placeholder="Current Capacity" className="border border-gray-300 rounded-lg p-2 text-sm" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Locks Information</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                FRP
                <select value={fmip} onChange={(e) => setFmip(e.target.value)} className="font-semibold">
                  {!['Off', 'On'].includes(fmip) && <option>{fmip}</option>}<option>Off</option><option>On</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                MDM
                <select value={mdm} onChange={(e) => setMdm(e.target.value)} className="font-semibold">
                  {!['Unlock', 'Locked'].includes(mdm) && <option>{mdm}</option>}<option>Unlock</option><option>Locked</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                Blacklist
                <select value={blacklistStatus} onChange={(e) => setBlacklistStatus(e.target.value)} className="font-semibold">
                  {!['Clean', 'Blacklisted', 'Unknown'].includes(blacklistStatus) && <option>{blacklistStatus}</option>}<option>Clean</option><option>Blacklisted</option><option>Unknown</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                SIM
                <select value={simLockStatus} onChange={(e) => setSimLockStatus(e.target.value)} className="font-semibold">
                  {!['Unlocked', 'Locked'].includes(simLockStatus) && <option>{simLockStatus}</option>}<option>Unlocked</option><option>Locked</option>
                </select>
              </label>
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                ID Lock
                <select value={idLock} onChange={(e) => setIdLock(e.target.value)} className="font-semibold">
                  {!['Off', 'On'].includes(idLock) && <option>{idLock}</option>}<option>Off</option><option>On</option>
                </select>
              </label>
            </div>
          </div>

          <div className="border-t pt-4 space-y-2">
            <p className="text-xs font-bold text-gray-500 uppercase">Logo for this report only (optional; the company logo is used automatically)</p>
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

          <div className="border-t pt-4 space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-gray-500 uppercase">Parts Information</p>
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
            <div className="grid grid-cols-3 gap-3 text-sm">
              <input value={osVersion} onChange={(e) => setOsVersion(e.target.value)} placeholder="OS Version" className="border border-gray-300 rounded-lg p-2" />
              <label className="flex items-center justify-between border border-gray-300 rounded-lg p-2">
                Wiped Result
                <select value={wipedResult} onChange={(e) => setWipedResult(e.target.value)} className="font-semibold">
                  {!['YES', 'NO'].includes(wipedResult) && <option>{wipedResult}</option>}<option>YES</option><option>NO</option>
                </select>
              </label>
              <input value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="Operation (N/A if none)" className="border border-gray-300 rounded-lg p-2" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">
              Diagnostics Information — click a result to cycle Pass / Fail / N/A
            </p>
            <div className="grid grid-cols-2 gap-2">
              {checklist.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => cycleResult(c.name)}
                  className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
                >
                  <span>{c.name}</span>
                  <span className={`font-bold ${c.result === 'Pass' ? 'text-emerald-600' : c.result === 'Fail' ? 'text-red-600' : 'text-gray-400'}`}>{c.result}</span>
                </button>
              ))}
            </div>
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