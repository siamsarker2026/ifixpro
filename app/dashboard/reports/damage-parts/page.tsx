'use client'

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { playSuccess, playError } from '@/lib/sounds'
import { fetchUserNames } from '@/lib/userNames'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

type Tab = 'entries' | 'summary' | 'prices'

// Asia/Dubai is a fixed UTC+4 offset (no DST).
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000
const todayDubai = () => new Date(Date.now() + DUBAI_OFFSET_MS).toISOString().split('T')[0]

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${y}-${pad(m)}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
  return { start, end }
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
const modelSort = (a: string, b: string) => {
  const na = parseFloat(a) || 0
  const nb = parseFloat(b) || 0
  return na !== nb ? na - nb : a.localeCompare(b)
}
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-900'
const OTHER = '__other'
// Only LCD Damage has two prices (charged price + our cost). Other parts have one price.
const hasCost = (p: any) => (p?.has_cost ?? /lcd/i.test(p?.name || '')) === true
// Our cost per piece: the specific cost if one was set, otherwise the normal (unit) price.
const costOf = (r: any) => (Number(r?.cost_price) > 0 ? Number(r.cost_price) : Number(r?.unit_price) || 0)

export default function DamagePartsPage() {
  const [tab, setTab] = useState<Tab>('entries')
  const [month, setMonth] = useState(todayDubai().slice(0, 7))
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [loadingBase, setLoadingBase] = useState(true)
  const [loadingRecords, setLoadingRecords] = useState(true)

  const [departments, setDepartments] = useState<any[]>([])
  const [parts, setParts] = useState<any[]>([])
  const [people, setPeople] = useState<any[]>([])
  const [prices, setPrices] = useState<any[]>([])
  const [records, setRecords] = useState<any[]>([])
  const [enteredBy, setEnteredBy] = useState<Map<string, string>>(new Map())

  // Entry form
  const [fDate, setFDate] = useState(todayDubai())
  const [newPersonDept, setNewPersonDept] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [editPrice, setEditPrice] = useState(false)
  const [fPerson, setFPerson] = useState('')
  const [fPart, setFPart] = useState('')
  const [fModel, setFModel] = useState('')
  const [fModelOther, setFModelOther] = useState('')
  const [fQty, setFQty] = useState('1')
  const [fImei, setFImei] = useState('')
  const [fRemark, setFRemark] = useState('')
  const [fUnit, setFUnit] = useState('')
  const [fCost, setFCost] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  const [newPerson, setNewPerson] = useState('')
  const [saving, setSaving] = useState(false)

  // List / summary filters
  const [eDept, setEDept] = useState('ALL')
  const [eSearch, setESearch] = useState('')
  const [sDept, setSDept] = useState('ALL')
  const [pdfCost, setPdfCost] = useState(false)

  // Price list tab
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [extraModels, setExtraModels] = useState<string[]>([])
  const [newModel, setNewModel] = useState('')
  const [csvText, setCsvText] = useState('')
  const [importTarget, setImportTarget] = useState('')
  const [newDeptName, setNewDeptName] = useState('')
  const [newPartName, setNewPartName] = useState('')

  useEffect(() => {
    if (!msg) return
    if (msg.type === 'error') playError()
    else playSuccess()
    const t = setTimeout(() => setMsg(null), 6000)
    return () => clearTimeout(t)
  }, [msg])

  const loadBase = useCallback(async () => {
    const [d, p, pe, pr] = await Promise.all([
      supabase.from('damage_departments').select('*').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('damage_part_types').select('*').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('damage_people').select('*').eq('is_active', true).order('name'),
      fetchAll((from, to) => supabase.from('damage_prices').select('*').order('model').range(from, to))
    ])
    const err = d.error || p.error || pe.error || pr.error
    if (err) {
      setMsg({ type: 'error', text: err.message + ' (has damage-parts-setup.sql been run in the main project?)' })
    } else {
      setDepartments(d.data || [])
      setParts(p.data || [])
      setPeople(pe.data || [])
      setPrices(pr.data || [])
    }
    setLoadingBase(false)
  }, [])

  const loadRecords = useCallback(async (m: string) => {
    setLoadingRecords(true)
    const { start, end } = monthRange(m)
    const { data, error } = await fetchAll((from, to) =>
      supabase.from('damage_records').select('*')
        .gte('damage_date', start).lt('damage_date', end)
        .order('damage_date', { ascending: false }).order('id').range(from, to)
    )
    if (error) setMsg({ type: 'error', text: error.message })
    else {
      setRecords(data)
      fetchUserNames(data.map(r => r.created_by)).then(setEnteredBy)
    }
    setLoadingRecords(false)
  }, [])

  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { loadRecords(month) }, [month, loadRecords])

  // Default dropdown choices once the lists arrive
  useEffect(() => {
    if (!newPersonDept && departments.length > 0) setNewPersonDept(departments[0].id)
    if (!fPart && parts.length > 0) setFPart(parts[0].id)
  }, [departments, parts, newPersonDept, fPart])

  const deptName = useMemo(() => new Map<string, string>(departments.map(d => [d.id, d.name])), [departments])
  const partName = useMemo(() => new Map<string, string>(parts.map(p => [p.id, p.name])), [parts])
  const personName = useMemo(() => new Map<string, string>(people.map(p => [p.id, p.name])), [people])
  const priceMap = useMemo(
    () => new Map<string, any>(prices.map(p => [`${p.part_type_id}|${norm(p.model)}`, p])),
    [prices]
  )

  const selectedPerson = people.find(p => p.id === fPerson)

  // Models offered in the entry form: every model in the Price List, whatever
  // the part. A model with no price for the chosen part asks for the price.
  const modelOptions = useMemo(() => {
    const byKey = new Map<string, string>()
    prices.forEach(p => { const k = norm(p.model); if (!byKey.has(k)) byKey.set(k, p.model as string) })
    return Array.from(byKey.values()).sort(modelSort)
  }, [prices])

  const effectiveModel = (fModel === OTHER ? fModelOther : fModel).trim()
  const noListedPrice = !!effectiveModel && !!fPart && !priceMap.get(`${fPart}|${norm(effectiveModel)}`)

  // A model chosen for another part may not exist for this one: reset it.
  useEffect(() => {
    if (fModel && fModel !== OTHER && !modelOptions.includes(fModel)) setFModel('')
  }, [modelOptions, fModel])

  // Prefill the prices from the Price List (can still be changed per entry)
  useEffect(() => {
    if (!fPart || !effectiveModel) { setFUnit(''); setFCost(''); return }
    const p = priceMap.get(`${fPart}|${norm(effectiveModel)}`)
    setFUnit(p ? String(Number(p.unit_price)) : '')
    setFCost(p && Number(p.cost_price) > 0 ? String(Number(p.cost_price)) : '')
  }, [fPart, effectiveModel, priceMap])

  async function addPerson() {
    const name = newPerson.trim()
    if (!name || !newPersonDept) return
    const { data, error } = await supabase
      .from('damage_people').insert({ department_id: newPersonDept, name }).select().single()
    if (error) {
      setMsg({ type: 'error', text: error.code === '23505' ? 'That person already exists in this department.' : error.message })
      return
    }
    setNewPerson('')
    setAddingPerson(false)
    await loadBase()
    setFPerson(data.id)
  }

  async function saveRecord(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const qty = Number(fQty)
    const unit = num(fUnit)
    const cost = fCost.trim() === '' ? unit : Number(fCost) // no specific cost: use the normal price
    const imei = fImei.trim()

    if (!selectedPerson || !fPart || !effectiveModel) return setMsg({ type: 'error', text: 'Choose the person, damage part and model.' })
    if (!Number.isInteger(qty) || qty < 1) return setMsg({ type: 'error', text: 'Qty must be a whole number, 1 or more.' })
    if (!Number.isFinite(unit) || unit < 0) return setMsg({ type: 'error', text: 'Enter the unit price (no price in the Price List for this model).' })
    if (!Number.isFinite(cost) || cost < 0) return setMsg({ type: 'error', text: 'Cost must be a number.' })
    if (imei && !/^\d{15}$/.test(imei)) return setMsg({ type: 'error', text: 'IMEI must be 15 digits, or leave it empty.' })

    setSaving(true)
    const { error } = await supabase.from('damage_records').insert({
      damage_date: fDate,
      department_id: selectedPerson.department_id,
      person_id: fPerson,
      part_type_id: fPart,
      // Keep one spelling per model so the Summary does not split "15 Pro" / "15 pro".
      model: priceModels.find(x => norm(x) === norm(effectiveModel)) ?? effectiveModel,
      qty,
      imei: imei || null,
      unit_price: unit,
      cost_price: cost,
      remark: fRemark.trim() || null
    })
    setSaving(false)
    if (error) return setMsg({ type: 'error', text: error.message })

    setMsg({ type: 'ok', text: `Saved: ${personName.get(fPerson)} · ${partName.get(fPart)} · ${effectiveModel} × ${qty}` })
    setFQty('1'); setFImei(''); setFRemark(''); setEditPrice(false)
    if (fDate.slice(0, 7) !== month) setMonth(fDate.slice(0, 7))
    else loadRecords(month)
  }

  async function deleteRecord(r: any) {
    if (!confirm(`Delete this entry?\n${personName.get(r.person_id)} · ${partName.get(r.part_type_id)} · ${r.model} × ${r.qty}`)) return
    const { error } = await supabase.from('damage_records').delete().eq('id', r.id)
    if (error) return setMsg({ type: 'error', text: error.message })
    loadRecords(month)
  }

  // ---- Entries list -----------------------------------------------------------
  const listRecords = useMemo(() => {
    const q = norm(eSearch)
    return records.filter(r => {
      if (eDept !== 'ALL' && r.department_id !== eDept) return false
      if (!q) return true
      return [personName.get(r.person_id), partName.get(r.part_type_id), r.model, r.imei, r.remark, enteredBy.get(r.created_by)]
        .some(v => norm(v).includes(q))
    })
  }, [records, eDept, eSearch, personName, partName, enteredBy])

  const listTotals = useMemo(() => listRecords.reduce(
    (a, r) => ({ qty: a.qty + r.qty, amt: a.amt + r.qty * Number(r.unit_price), cost: a.cost + r.qty * costOf(r) }),
    { qty: 0, amt: 0, cost: 0 }
  ), [listRecords])

  // ---- Summary pivot ----------------------------------------------------------
  const pivot = useMemo(() => {
    const rows = records.filter(r => sDept === 'ALL' || r.department_id === sDept)
    const models = Array.from(new Set<string>(rows.map(r => r.model as string))).sort(modelSort)
    type Cell = { qty: number; amt: number; cost: number }
    const empty = (): Cell => ({ qty: 0, amt: 0, cost: 0 })
    const add = (c: Cell, r: any) => { c.qty += r.qty; c.amt += r.qty * Number(r.unit_price); c.cost += r.qty * costOf(r) }

    const groups = parts
      .map(part => {
        const partRows = rows.filter(r => r.part_type_id === part.id)
        const people = new Map<string, { id: string; name: string; cells: Map<string, Cell>; total: Cell }>()
        const cells = new Map<string, Cell>()
        const total = empty()
        partRows.forEach(r => {
          if (!people.has(r.person_id)) people.set(r.person_id, { id: r.person_id, name: personName.get(r.person_id) || 'Unknown', cells: new Map(), total: empty() })
          const p = people.get(r.person_id)!
          if (!p.cells.has(r.model)) p.cells.set(r.model, empty())
          if (!cells.has(r.model)) cells.set(r.model, empty())
          add(p.cells.get(r.model)!, r); add(p.total, r)
          add(cells.get(r.model)!, r); add(total, r)
        })
        return {
          part,
          people: Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name)),
          cells, total
        }
      })
      .filter(g => g.people.length > 0)

    const grandCells = new Map<string, Cell>()
    const grand = empty()
    rows.forEach(r => {
      if (!grandCells.has(r.model)) grandCells.set(r.model, empty())
      add(grandCells.get(r.model)!, r); add(grand, r)
    })
    // Per person across all parts: who owes what for the month
    const byPersonMap = new Map<string, { id: string; name: string; dept: string; perPart: Map<string, Cell>; total: Cell }>()
    rows.forEach(r => {
      if (!byPersonMap.has(r.person_id)) {
        byPersonMap.set(r.person_id, { id: r.person_id, name: personName.get(r.person_id) || 'Unknown', dept: deptName.get(r.department_id) || '', perPart: new Map(), total: empty() })
      }
      const p = byPersonMap.get(r.person_id)!
      if (!p.perPart.has(r.part_type_id)) p.perPart.set(r.part_type_id, empty())
      add(p.perPart.get(r.part_type_id)!, r); add(p.total, r)
    })
    const byPerson = Array.from(byPersonMap.values()).sort((a, b) => b.total.amt - a.total.amt || a.name.localeCompare(b.name))
    return { models, groups, grandCells, grand, byPerson }
  }, [records, parts, sDept, personName, deptName])

  // ---- Price list -------------------------------------------------------------
  const priceModels = useMemo(
    () => Array.from(new Set<string>([...prices.map(p => p.model as string), ...extraModels])).sort(modelSort),
    [prices, extraModels]
  )

  async function savePrice(partId: string, model: string, which: 'u' | 'c') {
    const key = `${partId}|${model}|${which}`
    const raw = priceDraft[key]
    if (raw === undefined) return
    const clear = () => setPriceDraft(prev => { const n = { ...prev }; delete n[key]; return n })

    const existing = priceMap.get(`${partId}|${norm(model)}`)
    const current = existing ? Number(which === 'u' ? existing.unit_price : existing.cost_price) : 0
    const value = raw.trim() === '' ? 0 : Number(raw)
    if (!Number.isFinite(value) || value < 0) { setMsg({ type: 'error', text: 'Price must be a number.' }); return }
    if (value === current) { clear(); return }

    const unit = which === 'u' ? value : Number(existing?.unit_price || 0)
    const cost = which === 'c' ? value : Number(existing?.cost_price || 0)

    const { error } = unit === 0 && cost === 0
      ? await supabase.from('damage_prices').delete().eq('part_type_id', partId).eq('model', existing?.model ?? model)
      : await supabase.from('damage_prices').upsert(
          { part_type_id: partId, model: existing?.model ?? model, unit_price: unit, cost_price: cost, updated_at: new Date().toISOString() },
          { onConflict: 'part_type_id,model' }
        )
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    clear()
    loadBase()
  }

  function addModelRow() {
    const m = newModel.trim()
    if (!m) return
    if (!priceModels.some(x => norm(x) === norm(m))) setExtraModels(prev => [...prev, m])
    setNewModel('')
  }

  // Paste one block from the sheet: two columns, "model  price". The block is
  // saved as the unit price or the cost of the chosen part.
  async function importBlock() {
    const target = importTarget || (parts[0] ? `${parts[0].id}|u` : '')
    const [partId, which] = target.split('|')
    if (!partId) return
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const batch = new Map<string, any>()
    const problems: string[] = []

    lines.forEach((line, i) => {
      const cols = line.split(/\t|,|;/).map(c => c.trim().replace(/^"|"$/g, ''))
      const model = cols[0]
      const price = Number(cols[1])
      if (cols.length < 2 || !model) { problems.push(`Line ${i + 1}: needs model and price`); return }
      if (!Number.isFinite(price)) { if (i !== 0) problems.push(`Line ${i + 1}: price is not a number`); return } // header row is skipped
      if (price < 0) { problems.push(`Line ${i + 1}: price is negative`); return }
      const existing = priceMap.get(`${partId}|${norm(model)}`)
      batch.set(`${partId}|${norm(model)}`, {
        part_type_id: partId,
        model: existing?.model ?? model,
        unit_price: which === 'u' ? price : Number(existing?.unit_price || 0),
        cost_price: which === 'c' ? price : Number(existing?.cost_price || 0),
        updated_at: new Date().toISOString()
      })
    })

    if (batch.size === 0) { setMsg({ type: 'error', text: problems.slice(0, 3).join(' · ') || 'Nothing to import.' }); return }
    const rows = Array.from(batch.values())
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('damage_prices').upsert(rows.slice(i, i + 500), { onConflict: 'part_type_id,model' })
      if (error) { setMsg({ type: 'error', text: error.message }); return }
    }
    setCsvText('')
    await loadBase()
    setMsg({ type: problems.length ? 'error' : 'ok', text: `Imported ${rows.length} prices.${problems.length ? ' Skipped: ' + problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` (+${problems.length - 3} more)` : '') : ''}` })
  }

  async function addDepartment() {
    const name = newDeptName.trim()
    if (!name) return
    const { error } = await supabase.from('damage_departments').insert({ name, sort_order: departments.length + 1 })
    if (error) return setMsg({ type: 'error', text: error.code === '23505' ? 'That department already exists.' : error.message })
    setNewDeptName(''); loadBase()
  }

  async function addPartType() {
    const name = newPartName.trim()
    if (!name) return
    const { error } = await supabase.from('damage_part_types').insert({ name, sort_order: parts.length + 1 })
    if (error) return setMsg({ type: 'error', text: error.code === '23505' ? 'That part already exists.' : error.message })
    setNewPartName(''); loadBase()
  }

  // ---- Excel ------------------------------------------------------------------
  function exportEntries() {
    const data = listRecords.map(r => ({
      Date: r.damage_date,
      Department: deptName.get(r.department_id) || '',
      Person: personName.get(r.person_id) || '',
      'Damage part': partName.get(r.part_type_id) || '',
      Model: r.model,
      Qty: r.qty,
      IMEI: r.imei || '',
      'Unit price': Number(r.unit_price),
      'Total charged': r.qty * Number(r.unit_price),
      'Cost each': costOf(r),
      'Total cost': r.qty * costOf(r),
      Remark: r.remark || '',
      'Entered by': enteredBy.get(r.created_by) || '',
      'Entered at': r.created_at ? new Date(r.created_at).toLocaleString() : ''
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), `Damage_${month}`)
    XLSX.writeFile(wb, `Damage_Parts_${month}.xlsx`)
  }

  function downloadPdf() {
    const doc = new jsPDF({ orientation: 'landscape' })
    const deptLabel = sDept === 'ALL' ? 'All departments' : (deptName.get(sDept) || '')
    const partCols = pivot.groups.map(g => g.part)
    const cellText = (c?: { qty: number; amt: number }) => (c && c.qty > 0 ? `${c.qty} (${money(c.amt)})` : '')
    const dark = [15, 23, 42] as [number, number, number]

    doc.setFontSize(16)
    doc.text('Damage Parts Summary', 14, 15)
    doc.setFontSize(10)
    doc.text(`Month: ${month}   |   ${deptLabel}`, 14, 22)
    doc.text(
      `Pieces: ${pivot.grand.qty}   |   Total charged: ${money(pivot.grand.amt)} AED` + (pdfCost ? `   |   Our cost: ${money(pivot.grand.cost)} AED` : ''),
      14, 28
    )

    // 1) By person
    autoTable(doc, {
      startY: 33,
      head: [['Person', 'Department', ...partCols.map(p => p.name), 'Pieces', 'Total charged (AED)', ...(pdfCost ? ['Our cost (AED)'] : [])]],
      body: pivot.byPerson.map(p => [
        p.name, p.dept,
        ...partCols.map(x => cellText(p.perPart.get(x.id))),
        String(p.total.qty), money(p.total.amt),
        ...(pdfCost ? [p.total.cost ? money(p.total.cost) : ''] : [])
      ]),
      foot: [['Total', '', ...partCols.map(x => {
        const qty = pivot.byPerson.reduce((a, p) => a + (p.perPart.get(x.id)?.qty || 0), 0)
        const amt = pivot.byPerson.reduce((a, p) => a + (p.perPart.get(x.id)?.amt || 0), 0)
        return cellText({ qty, amt })
      }), String(pivot.grand.qty), money(pivot.grand.amt), ...(pdfCost ? [money(pivot.grand.cost)] : [])]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: dark },
      footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' }
    })

    // 2) By model
    let y = (doc as any).lastAutoTable.finalY + 10
    if (y > 150) { doc.addPage(); y = 15 }
    doc.setFontSize(12)
    doc.text('By model', 14, y)
    const span = pivot.models.length + 2
    const body: any[] = []
    pivot.groups.forEach(g => {
      body.push([{ content: g.part.name, colSpan: span, styles: { fillColor: [241, 245, 249], fontStyle: 'bold' } }])
      g.people.forEach(p => body.push([p.name, ...pivot.models.map(m => cellText(p.cells.get(m))), cellText(p.total)]))
      body.push([
        { content: `${g.part.name} total`, styles: { fontStyle: 'bold' } },
        ...pivot.models.map(m => ({ content: cellText(g.cells.get(m)), styles: { fontStyle: 'bold' } })),
        { content: cellText(g.total), styles: { fontStyle: 'bold' } }
      ])
    })
    autoTable(doc, {
      startY: y + 4,
      head: [['Damage part / Person', ...pivot.models, 'Total']],
      body,
      foot: [['Grand Total', ...pivot.models.map(m => cellText(pivot.grandCells.get(m))), cellText(pivot.grand)]],
      styles: { fontSize: pivot.models.length > 12 ? 6 : 7, halign: 'center' },
      columnStyles: { 0: { halign: 'left', cellWidth: 38 } },
      headStyles: { fillColor: dark },
      footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' }
    })

    doc.setFontSize(8)
    doc.text('Each cell: pieces (amount charged, AED).', 14, doc.internal.pageSize.getHeight() - 8)
    const deptSuffix = sDept === 'ALL' ? '' : `_${deptLabel.replace(/\s+/g, '')}`
    doc.save(`Damage_Parts_${month}${deptSuffix}.pdf`)
  }

  function exportSummary() {
    const build = (pick: (c: { qty: number; amt: number; cost: number }) => number, withCost: boolean) => {
      const head = ['Damage part', 'Person', ...pivot.models, 'Total', ...(withCost ? ['Our cost'] : [])]
      const aoa: (string | number)[][] = [head]
      pivot.groups.forEach(g => {
        g.people.forEach(p => aoa.push([g.part.name, p.name, ...pivot.models.map(m => { const c = p.cells.get(m); return c ? pick(c) : '' }), pick(p.total), ...(withCost ? [p.total.cost] : [])]))
        aoa.push([`${g.part.name} total`, '', ...pivot.models.map(m => { const c = g.cells.get(m); return c ? pick(c) : '' }), pick(g.total), ...(withCost ? [g.total.cost] : [])])
      })
      aoa.push(['Grand Total', '', ...pivot.models.map(m => { const c = pivot.grandCells.get(m); return c ? pick(c) : '' }), pick(pivot.grand), ...(withCost ? [pivot.grand.cost] : [])])
      return XLSX.utils.aoa_to_sheet(aoa)
    }
    const wb = XLSX.utils.book_new()
    const partCols = pivot.groups.map(g => g.part)
    const personAoa: (string | number)[][] = [['Person', 'Department', ...partCols.map(p => `${p.name} qty`), ...partCols.map(p => `${p.name} AED`), 'Total qty', 'Total charged', 'Our cost']]
    pivot.byPerson.forEach(p => personAoa.push([
      p.name, p.dept,
      ...partCols.map(x => p.perPart.get(x.id)?.qty || ''),
      ...partCols.map(x => p.perPart.get(x.id)?.amt || ''),
      p.total.qty, p.total.amt, p.total.cost
    ]))
    personAoa.push(['Total', '', ...partCols.map(() => ''), ...partCols.map(() => ''), pivot.grand.qty, pivot.grand.amt, pivot.grand.cost])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(personAoa), 'By person')
    XLSX.utils.book_append_sheet(wb, build(c => c.qty, false), 'Qty')
    XLSX.utils.book_append_sheet(wb, build(c => c.amt, true), 'Amount charged')
    const deptSuffix = sDept === 'ALL' ? '' : `_${(deptName.get(sDept) || '').replace(/\s+/g, '')}`
    XLSX.writeFile(wb, `Damage_Summary_${month}${deptSuffix}.xlsx`)
  }

  if (loadingBase) return <div className="max-w-7xl mx-auto p-6 text-center text-sm text-gray-500">Loading Damage Parts...</div>

  const TABS: { id: Tab; label: string }[] = [
    { id: 'entries', label: 'Entries' },
    { id: 'summary', label: 'Summary' },
    { id: 'prices', label: 'Price List' }
  ]
  const priceOf = (partId: string, model: string) => priceMap.get(`${partId}|${norm(model)}`)

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Damage Parts</h2>
          <p className="text-xs text-gray-500 mt-1">
            Record parts damaged by each person, priced from the Price List. Prices are saved with each entry, so later price changes do not alter old entries.
            {loadingRecords && <span className="ml-2 text-slate-500 font-semibold animate-pulse">· Updating…</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 text-sm">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-lg font-medium cursor-pointer ${tab === t.id ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab !== 'prices' && (
            <div className="flex items-center gap-2 border-l pl-3">
              <label className="text-xs font-bold text-gray-700">Month:</label>
              <input
                type="month"
                value={month}
                onChange={e => e.target.value && setMonth(e.target.value)}
                className="px-3 py-2 text-xs border rounded-lg font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          )}
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg border text-sm ${msg.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
          {msg.text}
        </div>
      )}

      {/* ---------------------------------------------------------------- ENTRIES */}
      {tab === 'entries' && (
        <>
          <form onSubmit={saveRecord} className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
            <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">New damage entry</h3>

            {addingPerson ? (
              <div className="flex flex-wrap items-end gap-2 text-sm bg-slate-50 border rounded-lg p-3">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-gray-500 text-xs mb-1">New person name</label>
                  <input
                    autoFocus
                    value={newPerson}
                    onChange={e => setNewPerson(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPerson() } }}
                    className={inputCls}
                  />
                </div>
                <div className="min-w-[150px]">
                  <label className="block text-gray-500 text-xs mb-1">Department</label>
                  <select value={newPersonDept} onChange={e => setNewPersonDept(e.target.value)} className={inputCls}>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <button type="button" onClick={addPerson} className="px-4 py-2.5 bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer">Add person</button>
                <button type="button" onClick={() => { setAddingPerson(false); setNewPerson('') }} className="px-4 py-2.5 bg-gray-100 rounded-lg text-xs font-bold cursor-pointer">Cancel</button>
              </div>
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
              <div className="col-span-2">
                <label className="block text-gray-500 text-xs mb-1">Person</label>
                <div className="flex gap-2">
                  <select value={fPerson} onChange={e => setFPerson(e.target.value)} className={inputCls} required>
                    <option value="">Select person…</option>
                    {departments.map(d => {
                      const list = people.filter(p => p.department_id === d.id)
                      return list.length === 0 ? null : (
                        <optgroup key={d.id} label={d.name}>
                          {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </optgroup>
                      )
                    })}
                  </select>
                  <button type="button" onClick={() => setAddingPerson(true)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer">+ New</button>
                </div>
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1">Damage part</label>
                <select value={fPart} onChange={e => setFPart(e.target.value)} className={inputCls}>
                  {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1">Model</label>
                {modelOptions.length === 0 || fModel === OTHER ? (
                  <input
                    value={fModel === OTHER ? fModelOther : fModel}
                    onChange={e => { setFModel(OTHER); setFModelOther(e.target.value) }}
                    placeholder="e.g. 15 pro"
                    className={inputCls}
                    required
                  />
                ) : (
                  <select value={fModel} onChange={e => setFModel(e.target.value)} className={inputCls} required>
                    <option value="">Select…</option>
                    {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value={OTHER}>Other…</option>
                  </select>
                )}
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1">Qty</label>
                <input type="number" min={1} step={1} value={fQty} onChange={e => setFQty(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1">Date</label>
                <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className={inputCls} required />
              </div>
            </div>

            {showMore && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="block text-gray-500 text-xs mb-1">IMEI (optional)</label>
                  <input value={fImei} onChange={e => setFImei(e.target.value)} inputMode="numeric" maxLength={15} placeholder="15 digits" className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gray-500 text-xs mb-1">Remark (optional)</label>
                  <input value={fRemark} onChange={e => setFRemark(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            {(editPrice || noListedPrice) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Unit price (AED)</label>
                  <input type="number" min={0} step="0.01" value={fUnit} onChange={e => setFUnit(e.target.value)} className={inputCls} />
                </div>
                {hasCost(parts.find(x => x.id === fPart)) && (
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Our cost each (optional)</label>
                    <input type="number" min={0} step="0.01" value={fCost} onChange={e => setFCost(e.target.value)} placeholder={fUnit ? `${fUnit} (same as price)` : ''} className={inputCls} />
                  </div>
                )}
                {noListedPrice && <p className="col-span-2 self-end pb-2 text-xs text-amber-700">No price in the Price List for this model. Enter it here, or add it in the Price List tab.</p>}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                {Number.isFinite(num(fUnit)) && Number(fQty) > 0 ? (
                  <span>Price: <b className="text-gray-900">{money(num(fUnit))}</b> each · Total: <b className="text-gray-900">{money(Number(fQty) * num(fUnit))} AED</b></span>
                ) : (
                  <span>Pick the person, part and model.</span>
                )}
                {Number.isFinite(num(fUnit)) && (
                  <button type="button" onClick={() => setEditPrice(v => !v)} className="underline hover:text-gray-900 cursor-pointer">{editPrice ? 'Hide price' : 'Change price'}</button>
                )}
                <button type="button" onClick={() => setShowMore(v => !v)} className="underline hover:text-gray-900 cursor-pointer">{showMore ? 'Fewer details' : 'IMEI / remark'}</button>
              </div>
              <button type="submit" disabled={saving} className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-50 cursor-pointer">
                {saving ? 'Saving…' : 'Save entry'}
              </button>
            </div>
          </form>

          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-bold text-gray-900 text-sm">Entries — {month} ({listRecords.length})</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select value={eDept} onChange={e => setEDept(e.target.value)} className="border rounded-lg px-3 py-2 bg-white font-semibold">
                  <option value="ALL">All departments</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <input value={eSearch} onChange={e => setESearch(e.target.value)} placeholder="Search person, part, model, IMEI…" className="border rounded-lg px-3 py-2 w-56" />
                <button onClick={exportEntries} disabled={listRecords.length === 0} className="px-3 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 cursor-pointer">Export Excel</button>
              </div>
            </div>
            {listRecords.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">No entries for this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-900 text-white font-bold">
                    <tr>
                      <th className="p-3">Date</th><th className="p-3">Department</th><th className="p-3">Person</th>
                      <th className="p-3">Damage part</th><th className="p-3">Model</th><th className="p-3 text-center">Qty</th>
                      <th className="p-3">IMEI</th><th className="p-3 text-right">Unit</th><th className="p-3 text-right">Total</th>
                      <th className="p-3 text-right">Our cost</th><th className="p-3">Remark</th><th className="p-3">Entered by</th><th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {listRecords.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="p-3 font-mono">{r.damage_date}</td>
                        <td className="p-3">{deptName.get(r.department_id)}</td>
                        <td className="p-3 font-semibold text-slate-900">{personName.get(r.person_id)}</td>
                        <td className="p-3">{partName.get(r.part_type_id)}</td>
                        <td className="p-3">{r.model}</td>
                        <td className="p-3 text-center font-mono">{r.qty}</td>
                        <td className="p-3 font-mono text-gray-500">{r.imei || '—'}</td>
                        <td className="p-3 text-right font-mono">{money(Number(r.unit_price))}</td>
                        <td className="p-3 text-right font-mono font-bold">{money(r.qty * Number(r.unit_price))}</td>
                        <td className="p-3 text-right font-mono text-gray-600">{money(r.qty * costOf(r))}</td>
                        <td className="p-3 max-w-[200px] truncate" title={r.remark || ''}>{r.remark || ''}</td>
                        <td className="p-3 text-gray-600" title={r.created_at ? new Date(r.created_at).toLocaleString() : ''}>{enteredBy.get(r.created_by) || '—'}</td>
                        <td className="p-3 text-right">
                          <button onClick={() => deleteRecord(r)} className="text-red-600 font-medium hover:underline cursor-pointer">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                      <td className="p-3" colSpan={5}>TOTAL</td>
                      <td className="p-3 text-center font-mono">{listTotals.qty}</td>
                      <td className="p-3"></td><td className="p-3"></td>
                      <td className="p-3 text-right font-mono">{money(listTotals.amt)}</td>
                      <td className="p-3 text-right font-mono">{money(listTotals.cost)}</td>
                      <td className="p-3" colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------------------------------------------------------------- SUMMARY */}
      {tab === 'summary' && (
        <>
          <div className="bg-white p-4 rounded-lg shadow-sm border flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <label className="font-bold text-gray-700">Department:</label>
              <select value={sDept} onChange={e => setSDept(e.target.value)} className="border rounded-lg px-3 py-2 bg-white font-semibold">
                <option value="ALL">All departments</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                <input type="checkbox" checked={pdfCost} onChange={e => setPdfCost(e.target.checked)} />
                Include our cost in PDF
              </label>
              <button onClick={downloadPdf} disabled={pivot.groups.length === 0} className="px-3 py-2 font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 cursor-pointer">Download PDF</button>
              <button onClick={exportSummary} disabled={pivot.groups.length === 0} className="px-3 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 cursor-pointer">Export Excel</button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm border"><p className="text-xs text-gray-500">Pieces damaged</p><p className="text-2xl font-bold text-slate-900">{pivot.grand.qty}</p></div>
            <div className="bg-white p-4 rounded-lg shadow-sm border"><p className="text-xs text-gray-500">Total charged (AED)</p><p className="text-2xl font-bold text-slate-900">{money(pivot.grand.amt)}</p></div>
            <div className="bg-white p-4 rounded-lg shadow-sm border"><p className="text-xs text-gray-500">Our cost (AED)</p><p className="text-2xl font-bold text-slate-900">{money(pivot.grand.cost)}</p></div>
          </div>

          {pivot.groups.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border"><p className="p-6 text-center text-sm text-gray-500">No entries for {month}.</p></div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <div className="p-4 border-b">
                  <h3 className="font-bold text-gray-900 text-sm">By person — {month}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">What each person damaged this month. Highest amount first.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900 text-white font-bold">
                      <tr>
                        <th className="p-3 text-left">Person</th>
                        <th className="p-3 text-left">Department</th>
                        {pivot.groups.map(g => <th key={g.part.id} className="p-3 text-center whitespace-nowrap">{g.part.name}</th>)}
                        <th className="p-3 text-center whitespace-nowrap">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pivot.byPerson.map(p => (
                        <tr key={p.id} className="border-b hover:bg-slate-50">
                          <td className="p-3 font-semibold text-slate-900">{p.name}</td>
                          <td className="p-3 text-gray-500">{p.dept}</td>
                          {pivot.groups.map(g => <CellBox key={g.part.id} c={p.perPart.get(g.part.id)} />)}
                          <CellBox c={p.total} bold />
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-200 font-bold border-t-2 border-slate-400">
                        <td className="p-3 text-slate-900" colSpan={2}>Total</td>
                        {pivot.groups.map(g => <CellBox key={g.part.id} c={g.total} bold />)}
                        <CellBox c={pivot.grand} bold showCost />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <div className="p-4 border-b">
                  <h3 className="font-bold text-gray-900 text-sm">By model — {month}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Damage part, then person, across models.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900 text-white font-bold">
                      <tr>
                        <th className="p-3 text-left sticky left-0 bg-slate-900 z-10 min-w-[170px]">Damage part / Person</th>
                        {pivot.models.map(m => <th key={m} className="p-3 text-center whitespace-nowrap">{m}</th>)}
                        <th className="p-3 text-center whitespace-nowrap">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pivot.groups.map(g => (
                        <FragmentGroup key={g.part.id} g={g} models={pivot.models} />
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-200 font-bold border-t-2 border-slate-400">
                        <td className="p-3 sticky left-0 bg-slate-200 text-slate-900">Grand Total</td>
                        {pivot.models.map(m => <CellBox key={m} c={pivot.grandCells.get(m)} bold />)}
                        <CellBox c={pivot.grand} bold showCost />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="p-3 text-[11px] text-gray-500 border-t">Each cell: pieces, then the amount charged (AED). Totals also show our cost in grey when it differs from the amount charged.</p>
              </div>
            </>
          )}
        </>
      )}

      {/* ---------------------------------------------------------------- PRICES */}
      {tab === 'prices' && (
        <>
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900 text-sm">Price List (AED)</h3>
                <p className="text-xs text-gray-500 mt-0.5">Unit = price charged to the person. Cost (LCD only) = our cost; left empty, our cost is the unit price. Saved when you leave the box. Changing a price does not change old entries.</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <input value={newModel} onChange={e => setNewModel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addModelRow() }} placeholder="New model, e.g. 16 pro max" className="border rounded-lg px-3 py-2 w-48" />
                <button onClick={addModelRow} className="px-3 py-2 font-bold bg-slate-900 text-white rounded-lg cursor-pointer">+ Model</button>
              </div>
            </div>
            {priceModels.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">No prices yet. Add a model above, or paste your prices below.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 text-white font-bold">
                    <tr>
                      <th className="p-3 text-left" rowSpan={2}>Model</th>
                      {parts.map(p => <th key={p.id} colSpan={hasCost(p) ? 2 : 1} className="p-2 text-center border-l border-slate-700">{p.name}</th>)}
                    </tr>
                    <tr className="bg-slate-800">
                      {parts.map(p => <FragmentHeads key={p.id} withCost={hasCost(p)} />)}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {priceModels.map(m => (
                      <tr key={m} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-900">{m}</td>
                        {parts.map(p => {
                          const row = priceOf(p.id, m)
                          const cell = (which: 'u' | 'c') => {
                            const key = `${p.id}|${m}|${which}`
                            const saved = row ? Number(which === 'u' ? row.unit_price : row.cost_price) : 0
                            return (
                              <td key={which} className={`p-1.5 ${which === 'u' ? 'border-l' : ''}`}>
                                <input
                                  type="number" min={0} step="0.01"
                                  value={priceDraft[key] ?? (saved ? String(saved) : '')}
                                  onChange={e => setPriceDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                  onBlur={() => savePrice(p.id, m, which)}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  className="w-20 px-2 py-1.5 border rounded-md text-center font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                                />
                              </td>
                            )
                          }
                          return <Fragment key={p.id}>{cell('u')}{hasCost(p) && cell('c')}</Fragment>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border space-y-3">
            <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Paste prices from your sheet</h3>
            <p className="text-xs text-gray-500">
              Copy one block from your sheet (two columns: model and price), choose where it goes, and paste it. Do one block at a time.
              A header row is ignored and existing prices are updated.
            </p>
            <select
              value={importTarget || (parts[0] ? `${parts[0].id}|u` : '')}
              onChange={e => setImportTarget(e.target.value)}
              className={inputCls}
            >
              {parts.flatMap(p => [
                <option key={`${p.id}|u`} value={`${p.id}|u`}>{p.name} — {hasCost(p) ? 'Unit price (e.g. Original LCD)' : 'Price'}</option>,
                ...(hasCost(p) ? [<option key={`${p.id}|c`} value={`${p.id}|c`}>{p.name} — Our cost (e.g. Mocell LCD)</option>] : [])
              ])}
            </select>
            <textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              rows={5}
              placeholder={'12 pro\t140\n13\t140\n13 pro max\t140'}
              className={`${inputCls} font-mono text-xs`}
            />
            <button onClick={importBlock} disabled={!csvText.trim()} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer">Import prices</button>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm border grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="space-y-2">
              <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Departments</h3>
              <p className="text-gray-600">{departments.map(d => d.name).join(' · ') || 'None'}</p>
              <div className="flex gap-2">
                <input value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="New department" className={inputCls} />
                <button onClick={addDepartment} className="px-3 py-2 bg-slate-900 text-white rounded-lg font-bold cursor-pointer">Add</button>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Damage part types</h3>
              <p className="text-gray-600">{parts.map(p => p.name).join(' · ') || 'None'}</p>
              <div className="flex gap-2">
                <input value={newPartName} onChange={e => setNewPartName(e.target.value)} placeholder="New part type, e.g. Camera damage" className={inputCls} />
                <button onClick={addPartType} className="px-3 py-2 bg-slate-900 text-white rounded-lg font-bold cursor-pointer">Add</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---- small presentational helpers ------------------------------------------------

function FragmentHeads({ withCost }: { withCost: boolean }) {
  return (
    <>
      <th className="p-1.5 text-center font-semibold border-l border-slate-700">{withCost ? 'Unit (Original)' : 'Price'}</th>
      {withCost && <th className="p-1.5 text-center font-semibold">Cost (Mocell)</th>}
    </>
  )
}

function CellBox({ c, bold, showCost }: { c?: { qty: number; amt: number; cost: number }; bold?: boolean; showCost?: boolean }) {
  if (!c || c.qty === 0) return <td className="p-2 text-center text-gray-300">·</td>
  return (
    <td className="p-2 text-center whitespace-nowrap">
      <div className={`font-mono ${bold ? 'font-bold' : 'font-semibold'} text-slate-900`}>{c.qty}</div>
      <div className="font-mono text-[11px] text-slate-600">{money(c.amt)}</div>
      {showCost && c.cost > 0 && Math.abs(c.cost - c.amt) > 0.005 && <div className="font-mono text-[10px] text-gray-400">cost {money(c.cost)}</div>}
    </td>
  )
}

function FragmentGroup({ g, models }: { g: any; models: string[] }) {
  return (
    <>
      <tr className="bg-slate-100">
        <td colSpan={models.length + 2} className="p-2 px-3 font-bold text-slate-900 sticky left-0">{g.part.name}</td>
      </tr>
      {g.people.map((p: any) => (
        <tr key={p.id} className="border-b hover:bg-slate-50">
          <td className="p-2 px-3 sticky left-0 bg-white font-medium text-slate-800">{p.name}</td>
          {models.map(m => <CellBox key={m} c={p.cells.get(m)} />)}
          <CellBox c={p.total} bold />
        </tr>
      ))}
      <tr className="bg-slate-50 border-b-2 border-slate-300 font-bold">
        <td className="p-2 px-3 sticky left-0 bg-slate-50 text-slate-900">{g.part.name} Total</td>
        {models.map(m => <CellBox key={m} c={g.cells.get(m)} bold />)}
        <CellBox c={g.total} bold showCost />
      </tr>
    </>
  )
}