'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { playSuccess, playError } from '@/lib/sounds'

// ---------------------------------------------------------------------------
// Parts Inventory
//   Stock     - model x part grid (like the Google Sheet). Click a cell to
//               deduct, correct the count, set the minimum or return to supplier.
//   Purchases - the ONLY place stock is added. Cost / supplier / invoice optional.
//   Returns   - parts sent back to a supplier or shop for quality reasons.
//   Reorder   - cells below the minimum you set, with the last supplier / cost.
// All stock changes go through database functions (see parts-inventory-setup.sql)
// so every change is logged and stock can never go below zero.
// ---------------------------------------------------------------------------

type Tab = 'stock' | 'purchases' | 'returns' | 'reorder'

interface Model { id: string; name: string; sort_order: number }
interface PartType { id: string; name: string; category: string; sort_order: number }
interface Supplier { id: string; name: string }
interface StockCell { qty: number; min: number }

const PAGE_CHUNK = 1000

// Asia/Dubai is a fixed UTC+4 offset (no DST).
function dubaiToday() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().split('T')[0]
}

const k = (m: string, t: string) => `${m}|${t}`

export default function PartsInventoryPage() {
  const [tab, setTab] = useState<Tab>('stock')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const [models, setModels] = useState<Model[]>([])
  const [types, setTypes] = useState<PartType[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [stock, setStock] = useState<Map<string, StockCell>>(new Map())
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map())

  const [purchases, setPurchases] = useState<any[]>([])
  const [returns, setReturns] = useState<any[]>([])

  // Stock tab
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [selected, setSelected] = useState<{ modelId: string; typeId: string } | null>(null)
  const [showAdd, setShowAdd] = useState<'model' | 'type' | 'rename' | null>(null)
  const [addName, setAddName] = useState('')
  const [addCategory, setAddCategory] = useState('')
  // Rename a part type ("t|<id>")
  const [renameTarget, setRenameTarget] = useState('')
  const [renameName, setRenameName] = useState('')
  const [renameCategory, setRenameCategory] = useState('')

  // Purchase form
  const [pModel, setPModel] = useState('')
  const [pType, setPType] = useState('')
  const [pQty, setPQty] = useState('')
  const [pCost, setPCost] = useState('')
  const [pSupplier, setPSupplier] = useState('')
  const [pRef, setPRef] = useState('')
  const [pDate, setPDate] = useState(dubaiToday())
  const [pNote, setPNote] = useState('')
  const [newSupplier, setNewSupplier] = useState('')
  const [busy, setBusy] = useState(false)

  // Returns filter
  const [returnFilter, setReturnFilter] = useState<'Pending' | 'All'>('Pending')

  // Sounds follow the status message, same as the other pages
  useEffect(() => {
    if (!msg) return
    if (msg.type === 'error') playError()
    else playSuccess()
  }, [msg])

  const flash = (text: string, type: 'success' | 'error' = 'success') => setMsg({ text, type })

  // ---------- data loading ----------
  const loadAllStock = useCallback(async () => {
    // PostgREST returns at most 1000 rows per request, so read in chunks.
    const map = new Map<string, StockCell>()
    for (let from = 0; ; from += PAGE_CHUNK) {
      const { data, error } = await supabase
        .from('parts_stock')
        .select('model_id, type_id, qty, min_qty')
        .order('model_id')
        .order('type_id')
        .range(from, from + PAGE_CHUNK - 1)
      if (error) throw new Error(error.message)
      ;(data || []).forEach((r: any) => map.set(k(r.model_id, r.type_id), { qty: r.qty, min: r.min_qty }))
      if (!data || data.length < PAGE_CHUNK) break
    }
    setStock(map)
  }, [])

  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase.from('parts_suppliers').select('id, name').eq('is_active', true).order('name')
    setSuppliers(data || [])
  }, [])

  const loadPurchases = useCallback(async () => {
    const { data } = await supabase
      .from('parts_movements')
      .select('*')
      .eq('movement_type', 'purchase')
      .order('created_at', { ascending: false })
      .limit(1000)
    setPurchases(data || [])
  }, [])

  const loadReturns = useCallback(async () => {
    const { data } = await supabase
      .from('parts_returns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    setReturns(data || [])
  }, [])

  useEffect(() => {
    async function init() {
      try {
        const [mRes, tRes] = await Promise.all([
          supabase.from('parts_models').select('id, name, sort_order').eq('is_active', true).order('sort_order').order('name'),
          supabase.from('parts_types').select('id, name, category, sort_order').eq('is_active', true).order('sort_order').order('name'),
        ])
        if (mRes.error) throw new Error(mRes.error.message)
        if (tRes.error) throw new Error(tRes.error.message)
        setModels(mRes.data || [])
        setTypes(tRes.data || [])
        await Promise.all([loadAllStock(), loadSuppliers(), loadPurchases(), loadReturns()])

        const { data: profiles } = await supabase.from('profiles').select('*')
        const names = new Map<string, string>()
        ;(profiles || []).forEach((p: any) => {
          const n = p.full_name || p.name || p.email
          if (p.id) names.set(p.id, n)
          if (p.uuid) names.set(p.uuid, n)
        })
        setUserNames(names)
      } catch (e: any) {
        setLoadError(e.message || 'Could not load parts inventory')
      }
      setLoading(false)
    }
    init()
  }, [loadAllStock, loadSuppliers, loadPurchases, loadReturns])

  // ---------- lookups ----------
  const modelName = useMemo(() => new Map(models.map(m => [m.id, m.name])), [models])
  const typeName = useMemo(() => new Map(types.map(t => [t.id, t.name])), [types])
  const supplierName = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers])
  const categories = useMemo(() => Array.from(new Set(types.map(t => t.category))), [types])

  // ---------- actions ----------
  async function applyMovement(args: {
    modelId: string; typeId: string; movement: string; delta: number
    unitCost?: number | null; supplierId?: string | null; reference?: string | null
    note?: string | null; date?: string | null
  }): Promise<boolean> {
    setBusy(true)
    const { data, error } = await supabase.rpc('parts_apply_movement', {
      p_model: args.modelId,
      p_type: args.typeId,
      p_movement: args.movement,
      p_delta: args.delta,
      p_unit_cost: args.unitCost ?? null,
      p_supplier: args.supplierId ?? null,
      p_reference: args.reference ?? null,
      p_note: args.note ?? null,
      p_date: args.date ?? null,
    })
    setBusy(false)
    if (error) {
      flash(error.message, 'error')
      return false
    }
    setStock(prev => {
      const next = new Map(prev)
      const key = k(args.modelId, args.typeId)
      next.set(key, { qty: data as number, min: prev.get(key)?.min ?? 0 })
      return next
    })
    return true
  }

  async function handleDeduct(modelId: string, typeId: string, qty: number, note: string) {
    if (!Number.isInteger(qty) || qty <= 0) { flash('Enter a quantity of 1 or more.', 'error'); return false }
    const have = stock.get(k(modelId, typeId))?.qty ?? 0
    if (qty > have) { flash(`Not enough stock: only ${have} in stock.`, 'error'); return false }
    const ok = await applyMovement({ modelId, typeId, movement: 'use', delta: -qty, note })
    if (ok) flash(`Deducted ${qty} - ${modelName.get(modelId)} / ${typeName.get(typeId)}.`)
    return ok
  }

  async function handleSetCount(modelId: string, typeId: string, newCount: number, note: string) {
    if (!Number.isInteger(newCount) || newCount < 0) { flash('Enter a count of 0 or more.', 'error'); return false }
    const have = stock.get(k(modelId, typeId))?.qty ?? 0
    if (newCount === have) { flash('That is already the current count.', 'error'); return false }
    const ok = await applyMovement({ modelId, typeId, movement: 'adjust', delta: newCount - have, note: note || 'Stock count correction' })
    if (ok) flash(`Count set to ${newCount}.`)
    return ok
  }

  async function handleSetMin(modelId: string, typeId: string, min: number) {
    if (!Number.isInteger(min) || min < 0) { flash('Enter a minimum of 0 or more.', 'error'); return false }
    setBusy(true)
    const { error } = await supabase.rpc('parts_set_min', { p_model: modelId, p_type: typeId, p_min: min })
    setBusy(false)
    if (error) { flash(error.message, 'error'); return false }
    setStock(prev => {
      const next = new Map(prev)
      const key = k(modelId, typeId)
      next.set(key, { qty: prev.get(key)?.qty ?? 0, min })
      return next
    })
    flash(`Minimum set to ${min}.`)
    return true
  }

  async function handleCreateReturn(modelId: string, typeId: string, qty: number, supplierId: string, reason: string) {
    if (!Number.isInteger(qty) || qty <= 0) { flash('Enter a quantity of 1 or more.', 'error'); return false }
    const have = stock.get(k(modelId, typeId))?.qty ?? 0
    if (qty > have) { flash(`Not enough stock: only ${have} in stock.`, 'error'); return false }
    if (!reason.trim()) { flash('Please enter the reason for the return.', 'error'); return false }
    setBusy(true)
    const { error } = await supabase.rpc('parts_create_return', {
      p_model: modelId, p_type: typeId, p_qty: qty, p_supplier: supplierId || null, p_reason: reason.trim(),
    })
    setBusy(false)
    if (error) { flash(error.message, 'error'); return false }
    await Promise.all([loadAllStock(), loadReturns()])
    flash(`${qty} part(s) marked as returned to supplier.`)
    return true
  }

  async function handleResolveReturn(id: string, status: 'Replaced' | 'Credited' | 'Rejected' | 'Cancelled') {
    setBusy(true)
    const { error } = await supabase.rpc('parts_resolve_return', { p_return: id, p_status: status, p_note: null })
    setBusy(false)
    if (error) { flash(error.message, 'error'); return }
    await Promise.all([loadAllStock(), loadReturns()])
    flash(
      status === 'Replaced' ? 'Replacement received - stock updated.' :
      status === 'Cancelled' ? 'Return cancelled - parts are back in stock.' :
      `Return marked ${status}.`
    )
  }

  async function addSupplier(name: string) {
    const clean = name.trim()
    if (!clean) return null
    const existing = suppliers.find(s => s.name.toLowerCase() === clean.toLowerCase())
    if (existing) return existing.id
    const { data, error } = await supabase.from('parts_suppliers').insert({ name: clean }).select('id, name').single()
    if (error || !data) { flash(error?.message || 'Could not add supplier.', 'error'); return null }
    setSuppliers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return data.id as string
  }

  async function handlePurchaseSubmit(e: React.FormEvent) {
    e.preventDefault()
    const qty = parseInt(pQty, 10)
    if (!pModel || !pType) { flash('Choose the model and the part.', 'error'); return }
    if (!Number.isInteger(qty) || qty <= 0) { flash('Enter the purchased quantity (1 or more).', 'error'); return }
    const cost = pCost.trim() === '' ? null : Number(pCost)
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) { flash('Price must be a number, or leave it empty.', 'error'); return }

    let supplierId: string | null = pSupplier || null
    if (!supplierId && newSupplier.trim()) {
      supplierId = await addSupplier(newSupplier)
      if (!supplierId) return
    }

    const ok = await applyMovement({
      modelId: pModel, typeId: pType, movement: 'purchase', delta: qty,
      unitCost: cost, supplierId, reference: pRef, note: pNote, date: pDate || null,
    })
    if (ok) {
      await loadPurchases()
      flash(`Added ${qty} - ${modelName.get(pModel)} / ${typeName.get(pType)}.`)
      setPQty(''); setPCost(''); setPRef(''); setPNote(''); setNewSupplier('')
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    const name = addName.trim()
    if (!name || !showAdd) return
    setBusy(true)
    if (showAdd === 'model') {
      const next = (models[models.length - 1]?.sort_order ?? 0) + 1
      const { data, error } = await supabase.from('parts_models').insert({ name, sort_order: next }).select('id, name, sort_order').single()
      setBusy(false)
      if (error || !data) { flash(error?.message || 'Could not add model.', 'error'); return }
      setModels(prev => [...prev, data])
    } else {
      const category = addCategory.trim() || 'Other'
      const next = (types.filter(t => t.category === category).reduce((mx, t) => Math.max(mx, t.sort_order), 0)) + 1
      const { data, error } = await supabase.from('parts_types').insert({ name, category, sort_order: next }).select('id, name, category, sort_order').single()
      setBusy(false)
      if (error || !data) { flash(error?.message || 'Could not add part type.', 'error'); return }
      setTypes(prev => [...prev, data].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
    }
    flash(`${showAdd === 'model' ? 'Model' : 'Part type'} "${name}" added.`)
    setAddName(''); setAddCategory(''); setShowAdd(null)
  }

  function pickRename(target: string) {
    setRenameTarget(target)
    const [kind, id] = target.split('|')
    if (kind === 't') { const t = types.find(x => x.id === id); setRenameName(t?.name || ''); setRenameCategory(t?.category || '') }
    else { setRenameName(''); setRenameCategory('') }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    const [kind, id] = renameTarget.split('|')
    const name = renameName.trim()
    if (!id || !name) return
    setBusy(true)
    if (kind === 't') {
      const old = types.find(t => t.id === id)
      const category = renameCategory.trim() || old?.category || 'Other'
      const { error } = await supabase.from('parts_types').update({ name, category }).eq('id', id)
      setBusy(false)
      if (error) { flash(error.code === '23505' ? 'A part with that name already exists.' : error.message, 'error'); return }
      setTypes(prev => prev.map(t => (t.id === id ? { ...t, name, category } : t)))
      flash(`Part "${old?.name}" renamed to "${name}".`)
    }
    setRenameTarget(''); setRenameName(''); setRenameCategory(''); setShowAdd(null)
  }

  function goPurchase(modelId: string, typeId: string) {
    setPModel(modelId); setPType(typeId)
    setSelected(null)
    setTab('purchases')
  }

  // ---------- derived ----------
  const lastBuy = useMemo(() => {
    const map = new Map<string, any>()
    for (const p of purchases) {
      const key = k(p.model_id, p.type_id)
      if (!map.has(key)) map.set(key, p) // purchases are newest first
    }
    return map
  }, [purchases])

  const reorderRows = useMemo(() => {
    const rows: { model: Model; type: PartType; qty: number; min: number }[] = []
    const mById = new Map(models.map(m => [m.id, m]))
    const tById = new Map(types.map(t => [t.id, t]))
    stock.forEach((cell, key) => {
      if (cell.min > 0 && cell.qty < cell.min) {
        const [mid, tid] = key.split('|')
        const model = mById.get(mid); const type = tById.get(tid)
        if (model && type) rows.push({ model, type, qty: cell.qty, min: cell.min })
      }
    })
    rows.sort((a, b) => a.type.category.localeCompare(b.type.category) || a.type.sort_order - b.type.sort_order || a.model.sort_order - b.model.sort_order)
    return rows
  }, [stock, models, types])

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading Parts Inventory...</div>

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto bg-red-50 border border-red-200 text-red-800 p-5 rounded-lg text-sm space-y-2">
        <p className="font-bold">Parts Inventory could not load.</p>
        <p>{loadError}</p>
        <p>If this says a table does not exist, run <span className="font-mono">parts-inventory-setup.sql</span> in your MAIN project&apos;s SQL Editor first.</p>
      </div>
    )
  }

  const lowCount = reorderRows.length
  const pendingReturns = returns.filter(r => r.status === 'Pending').length

  return (
    <div className="space-y-5">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Parts Inventory</h2>
          <p className="text-sm text-gray-500 mt-1">Stock by model and part. Add stock in Purchases; click a cell in Stock to deduct it.</p>
        </div>
        <div className="flex gap-2 text-sm flex-wrap">
          {([
            ['stock', 'Stock'],
            ['purchases', 'Purchases'],
            ['returns', `Returns${pendingReturns ? ` (${pendingReturns})` : ''}`],
            ['reorder', `Reorder${lowCount ? ` (${lowCount})` : ''}`],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-lg font-medium cursor-pointer ${tab === id ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm font-medium border ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* ====================== STOCK ====================== */}
      {tab === 'stock' && (
        <div className="bg-white rounded-lg shadow-sm border p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search model or part name..."
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 outline-none focus:ring-2 focus:ring-slate-900"
            />
            <select
              value={catFilter}
              onChange={e => setCatFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="All">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex items-center gap-3 text-xs text-gray-600 ml-2">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> below minimum</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-200 inline-block" /> in stock</span>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setShowAdd(showAdd === 'model' ? null : 'model'); setAddName('') }} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-gray-50">+ Model</button>
              <button onClick={() => { setShowAdd(showAdd === 'type' ? null : 'type'); setAddName('') }} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-gray-50">+ Part type</button>
              <button onClick={() => { setShowAdd(showAdd === 'rename' ? null : 'rename'); pickRename('') }} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-gray-50">✎ Edit part names</button>
            </div>
          </div>

          {showAdd === 'rename' && (
            <form onSubmit={handleRename} className="flex flex-wrap gap-2 p-3 bg-slate-50 border rounded-lg">
              <select
                autoFocus
                value={renameTarget}
                onChange={e => pickRename(e.target.value)}
                className="w-56 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">Choose a part to rename…</option>
                {categories.map(c => (
                  <optgroup key={c} label={`Parts · ${c}`}>
                    {types.filter(t => t.category === c).map(t => <option key={t.id} value={`t|${t.id}`}>{t.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <input
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                disabled={!renameTarget}
                placeholder="New name"
                className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-gray-100"
              />
              {renameTarget.startsWith('t|') && (
                <>
                  <input
                    list="parts-categories-rename"
                    value={renameCategory}
                    onChange={e => setRenameCategory(e.target.value)}
                    placeholder="Category"
                    className="w-52 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <datalist id="parts-categories-rename">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </>
              )}
              <button type="submit" disabled={busy || !renameTarget || !renameName.trim()} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40 cursor-pointer">Save</button>
              <p className="w-full text-[11px] text-gray-500">Renaming keeps all stock, purchases and history. They are linked by ID, not by name.</p>
            </form>
          )}

          {(showAdd === 'model' || showAdd === 'type') && (
            <form onSubmit={handleAddItem} className="flex flex-wrap gap-2 p-3 bg-slate-50 border rounded-lg">
              <input
                autoFocus
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder={showAdd === 'model' ? 'New model name, e.g. iPhone 17 Air' : 'New part name'}
                className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              />
              {showAdd === 'type' && (
                <>
                  <input
                    list="parts-categories"
                    value={addCategory}
                    onChange={e => setAddCategory(e.target.value)}
                    placeholder="Category"
                    className="w-52 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <datalist id="parts-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </>
              )}
              <button type="submit" disabled={busy || !addName.trim()} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40 cursor-pointer">Add</button>
            </form>
          )}

          <StockGrid
            models={models}
            types={types}
            stock={stock}
            search={search}
            catFilter={catFilter}
            onSelect={(m, t) => setSelected({ modelId: m, typeId: t })}
          />
        </div>
      )}

      {/* ====================== PURCHASES ====================== */}
      {tab === 'purchases' && (
        <div className="space-y-5">
          <form onSubmit={handlePurchaseSubmit} className="bg-white rounded-lg shadow-sm border p-5 space-y-4">
            <h3 className="font-semibold text-gray-800">Record a purchase <span className="text-xs font-normal text-gray-500">- adds the quantity to stock automatically</span></h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Model">
                <select value={pModel} onChange={e => setPModel(e.target.value)} className={inputCls}>
                  <option value="">-- Choose model --</option>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="Part">
                <select value={pType} onChange={e => setPType(e.target.value)} className={inputCls}>
                  <option value="">-- Choose part --</option>
                  {categories.map(c => (
                    <optgroup key={c} label={c}>
                      {types.filter(t => t.category === c).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label="Quantity bought">
                <input type="number" min={1} step={1} value={pQty} onChange={e => setPQty(e.target.value)} className={inputCls} placeholder="e.g. 10" />
              </Field>
              <Field label="Price per piece (optional)">
                <input type="number" min={0} step="0.01" value={pCost} onChange={e => setPCost(e.target.value)} className={inputCls} placeholder="AED" />
              </Field>
              <Field label="Supplier (optional)">
                <select value={pSupplier} onChange={e => setPSupplier(e.target.value)} className={inputCls}>
                  <option value="">-- None --</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="...or add a new supplier">
                <input value={newSupplier} onChange={e => setNewSupplier(e.target.value)} disabled={!!pSupplier} className={`${inputCls} disabled:bg-gray-100`} placeholder="Supplier / shop name" />
              </Field>
              <Field label="Invoice / bill no. (optional)">
                <input value={pRef} onChange={e => setPRef(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Purchase date">
                <input type="date" value={pDate} onChange={e => setPDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Note (optional)">
                <input value={pNote} onChange={e => setPNote(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <button type="submit" disabled={busy} className="bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 cursor-pointer">
              {busy ? 'Saving...' : 'Add to stock'}
            </button>
          </form>

          <div className="bg-white rounded-lg shadow-sm border p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Recent purchases <span className="text-xs font-normal text-gray-500">(latest 50)</span></h3>
            {purchases.length === 0 ? (
              <p className="text-sm text-gray-400 text-center p-6">No purchases recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b text-gray-600">
                    <tr>
                      <th className="p-2.5">Date</th><th className="p-2.5">Model</th><th className="p-2.5">Part</th>
                      <th className="p-2.5">Qty</th><th className="p-2.5">Price</th><th className="p-2.5">Total</th>
                      <th className="p-2.5">Supplier</th><th className="p-2.5">Invoice</th><th className="p-2.5">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {purchases.slice(0, 50).map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="p-2.5 whitespace-nowrap">{p.movement_date}</td>
                        <td className="p-2.5">{modelName.get(p.model_id)}</td>
                        <td className="p-2.5">{typeName.get(p.type_id)}</td>
                        <td className="p-2.5 font-semibold">+{p.qty_change}</td>
                        <td className="p-2.5">{p.unit_cost != null ? Number(p.unit_cost).toFixed(2) : '—'}</td>
                        <td className="p-2.5">{p.unit_cost != null ? (Number(p.unit_cost) * p.qty_change).toFixed(2) : '—'}</td>
                        <td className="p-2.5">{p.supplier_id ? supplierName.get(p.supplier_id) || '—' : '—'}</td>
                        <td className="p-2.5">{p.reference || '—'}</td>
                        <td className="p-2.5 text-gray-500">{userNames.get(p.performed_by) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================== RETURNS ====================== */}
      {tab === 'returns' && (
        <div className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="font-semibold text-gray-800">Quality returns to supplier / shop</h3>
              <p className="text-xs text-gray-500">Start a return from a cell in Stock. The parts leave stock now; when the supplier answers, close it here.</p>
            </div>
            <select value={returnFilter} onChange={e => setReturnFilter(e.target.value as any)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="Pending">Waiting for supplier</option>
              <option value="All">All returns</option>
            </select>
          </div>
          {(() => {
            const rows = returns.filter(r => returnFilter === 'All' || r.status === 'Pending')
            if (rows.length === 0) return <p className="text-sm text-gray-400 text-center p-6">Nothing here.</p>
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b text-gray-600">
                    <tr>
                      <th className="p-2.5">Date</th><th className="p-2.5">Model</th><th className="p-2.5">Part</th>
                      <th className="p-2.5">Qty</th><th className="p-2.5">Supplier</th><th className="p-2.5">Reason</th>
                      <th className="p-2.5">Status</th><th className="p-2.5">Close it</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 align-top">
                        <td className="p-2.5 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td className="p-2.5">{modelName.get(r.model_id)}</td>
                        <td className="p-2.5">{typeName.get(r.type_id)}</td>
                        <td className="p-2.5 font-semibold">{r.qty}</td>
                        <td className="p-2.5">{r.supplier_id ? supplierName.get(r.supplier_id) || '—' : '—'}</td>
                        <td className="p-2.5 max-w-xs">{r.reason}</td>
                        <td className="p-2.5">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            r.status === 'Pending' ? 'bg-amber-100 text-amber-800' :
                            r.status === 'Replaced' ? 'bg-emerald-100 text-emerald-800' :
                            r.status === 'Credited' ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'
                          }`}>{r.status}</span>
                        </td>
                        <td className="p-2.5">
                          {r.status === 'Pending' ? (
                            <div className="flex flex-wrap gap-1.5">
                              <button disabled={busy} onClick={() => handleResolveReturn(r.id, 'Replaced')} className="bg-emerald-600 text-white px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-40" title="Supplier sent a replacement - adds it back to stock">Replacement received</button>
                              <button disabled={busy} onClick={() => handleResolveReturn(r.id, 'Credited')} className="bg-blue-600 text-white px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-40" title="Refund / credit - no stock change">Credited</button>
                              <button disabled={busy} onClick={() => handleResolveReturn(r.id, 'Rejected')} className="bg-gray-600 text-white px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-40" title="Supplier refused - no stock change">Rejected</button>
                              <button disabled={busy} onClick={() => handleResolveReturn(r.id, 'Cancelled')} className="border border-gray-300 text-gray-700 px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-40" title="Returned by mistake - puts it back in stock">Back to stock</button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">{r.resolved_at ? new Date(r.resolved_at).toLocaleDateString() : ''}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {/* ====================== REORDER ====================== */}
      {tab === 'reorder' && (
        <div className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="font-semibold text-gray-800">Parts below the minimum you set</h3>
              <p className="text-xs text-gray-500">Suggested quantity = minimum minus what is in stock. Last supplier and price come from your latest purchase of that part.</p>
            </div>
            {reorderRows.length > 0 && (
              <button
                onClick={() => {
                  const text = reorderRows.map(r => `${r.model.name} - ${r.type.name}: need ${r.min - r.qty} (have ${r.qty}, min ${r.min})`).join('\n')
                  navigator.clipboard?.writeText(text).then(() => flash('Reorder list copied.'), () => flash('Could not copy.', 'error'))
                }}
                className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-gray-50"
              >
                Copy list
              </button>
            )}
          </div>
          {reorderRows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center p-6">Nothing is below its minimum. (Minimums are set per part from the Stock tab.)</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b text-gray-600">
                  <tr>
                    <th className="p-2.5">Category</th><th className="p-2.5">Part</th><th className="p-2.5">Model</th>
                    <th className="p-2.5">In stock</th><th className="p-2.5">Min</th><th className="p-2.5">Suggest buying</th>
                    <th className="p-2.5">Last supplier</th><th className="p-2.5">Last price</th><th className="p-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reorderRows.map(r => {
                    const last = lastBuy.get(k(r.model.id, r.type.id))
                    return (
                      <tr key={k(r.model.id, r.type.id)} className="hover:bg-gray-50">
                        <td className="p-2.5 text-gray-500">{r.type.category}</td>
                        <td className="p-2.5">{r.type.name}</td>
                        <td className="p-2.5">{r.model.name}</td>
                        <td className="p-2.5 font-semibold text-red-700">{r.qty}</td>
                        <td className="p-2.5">{r.min}</td>
                        <td className="p-2.5 font-semibold">{r.min - r.qty}</td>
                        <td className="p-2.5">{last?.supplier_id ? supplierName.get(last.supplier_id) || '—' : '—'}</td>
                        <td className="p-2.5">{last?.unit_cost != null ? Number(last.unit_cost).toFixed(2) : '—'}</td>
                        <td className="p-2.5">
                          <button onClick={() => goPurchase(r.model.id, r.type.id)} className="bg-slate-900 text-white px-2.5 py-1 rounded text-xs cursor-pointer">Record purchase</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ====================== CELL POPUP ====================== */}
      {selected && (
        <CellModal
          key={k(selected.modelId, selected.typeId)}
          modelId={selected.modelId}
          typeId={selected.typeId}
          modelLabel={modelName.get(selected.modelId) || ''}
          typeLabel={typeName.get(selected.typeId) || ''}
          cell={stock.get(k(selected.modelId, selected.typeId)) || { qty: 0, min: 0 }}
          suppliers={suppliers}
          busy={busy}
          userNames={userNames}
          supplierName={supplierName}
          message={msg}
          onClose={() => setSelected(null)}
          onDeduct={handleDeduct}
          onSetCount={handleSetCount}
          onSetMin={handleSetMin}
          onReturn={handleCreateReturn}
          onPurchase={goPurchase}
        />
      )}
    </div>
  )
}

const inputCls = 'w-full bg-white text-gray-900 border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}

// ---------------------------------------------------------------------------
// The grid (models down the side, part types across the top)
// ---------------------------------------------------------------------------
function StockGrid({ models, types, stock, search, catFilter, onSelect }: {
  models: Model[]; types: PartType[]; stock: Map<string, StockCell>
  search: string; catFilter: string; onSelect: (modelId: string, typeId: string) => void
}) {
  // Search matches model names, part names, or both together:
  //   "15 pro"      -> rows for that model, all parts
  //   "lcd"         -> all models, only LCD columns
  //   "15 pro lcd"  -> that model and those parts (either order works)
  const q = search.trim().toLowerCase().replace(/\s+/g, ' ')
  const catTypes = types.filter(t => catFilter === 'All' || t.category === catFilter)
  const matchModels = (s: string) => models.filter(m => m.name.toLowerCase().includes(s))
  const matchTypes = (s: string) => catTypes.filter(t => t.name.toLowerCase().includes(s) || t.category.toLowerCase().includes(s))

  let visibleModels = models
  let visibleTypes = catTypes
  if (q) {
    const modelHits = matchModels(q)
    const typeHits = matchTypes(q)
    if (modelHits.length > 0) visibleModels = modelHits
    else if (typeHits.length > 0) visibleTypes = typeHits
    else {
      // Try every split into a model part and a part-name part, both orders.
      // Prefer the longest model text, so "15 pro max lcd" means model "15 pro max".
      const words = q.split(' ')
      let found = false
      for (let i = words.length - 1; i >= 1 && !found; i--) {
        for (const [mText, tText] of [[words.slice(0, i).join(' '), words.slice(i).join(' ')], [words.slice(words.length - i).join(' '), words.slice(0, words.length - i).join(' ')]]) {
          const ms = matchModels(mText)
          const ts = matchTypes(tText)
          if (ms.length > 0 && ts.length > 0) { visibleModels = ms; visibleTypes = ts; found = true; break }
        }
      }
      if (!found) { visibleModels = []; visibleTypes = [] }
    }
  }

  // Category bands above the part names
  const groups: { category: string; count: number }[] = []
  visibleTypes.forEach(t => {
    const last = groups[groups.length - 1]
    if (last && last.category === t.category) last.count++
    else groups.push({ category: t.category, count: 1 })
  })

  const totals = new Map<string, number>()
  stock.forEach((cell, key) => {
    const tid = key.split('|')[1]
    totals.set(tid, (totals.get(tid) || 0) + cell.qty)
  })

  if (visibleTypes.length === 0 || visibleModels.length === 0) {
    return <p className="text-sm text-gray-400 text-center p-8">Nothing matches.</p>
  }

  return (
    <div className="overflow-auto max-h-[70vh] border rounded-lg">
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-slate-900 min-w-[150px]" />
            {groups.map((g, i) => (
              <th key={i} colSpan={g.count} className="sticky top-0 z-20 bg-slate-700 text-slate-100 text-[11px] font-semibold py-1 border-l border-slate-600">
                {g.category}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 top-[26px] z-30 bg-slate-900 text-white text-left px-3 py-2 min-w-[150px]">MODEL</th>
            {visibleTypes.map(t => (
              <th key={t.id} className="sticky top-[26px] z-20 bg-slate-900 text-white font-semibold px-1.5 py-2 min-w-[72px] max-w-[96px] align-bottom leading-tight border-l border-slate-700">
                {t.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleModels.map(m => (
            <tr key={m.id}>
              <th className="sticky left-0 z-10 bg-teal-100 text-gray-900 text-left font-medium px-3 py-1.5 border-b border-white whitespace-nowrap">{m.name}</th>
              {visibleTypes.map(t => {
                const cell = stock.get(k(m.id, t.id))
                let cls = 'bg-white text-transparent hover:bg-slate-100'
                let label: string | number = '·'
                if (cell) {
                  label = cell.qty
                  if (cell.qty < cell.min) cls = 'bg-red-100 text-red-700 hover:bg-red-200'
                  else if (cell.qty > 0) cls = 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  else cls = 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }
                return (
                  <td
                    key={t.id}
                    onClick={() => onSelect(m.id, t.id)}
                    title={cell ? `In stock ${cell.qty} - minimum ${cell.min}` : 'No stock recorded'}
                    className={`text-center font-semibold border-b border-l border-gray-100 py-1.5 cursor-pointer ${cls}`}
                  >
                    {label}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky left-0 bottom-0 z-30 bg-slate-900 text-white text-left px-3 py-2">TOTAL</th>
            {visibleTypes.map(t => (
              <td key={t.id} className="sticky bottom-0 z-20 bg-slate-900 text-white text-center font-bold py-2 border-l border-slate-700">
                {totals.get(t.id) || 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popup for one cell
// ---------------------------------------------------------------------------
function CellModal(props: {
  modelId: string; typeId: string; modelLabel: string; typeLabel: string
  cell: StockCell; suppliers: Supplier[]; busy: boolean
  userNames: Map<string, string>; supplierName: Map<string, string>
  message: { text: string; type: 'success' | 'error' } | null
  onClose: () => void
  onDeduct: (m: string, t: string, qty: number, note: string) => Promise<boolean>
  onSetCount: (m: string, t: string, n: number, note: string) => Promise<boolean>
  onSetMin: (m: string, t: string, min: number) => Promise<boolean>
  onReturn: (m: string, t: string, qty: number, supplierId: string, reason: string) => Promise<boolean>
  onPurchase: (m: string, t: string) => void
}) {
  const { modelId, typeId, cell, busy } = props
  const [deductQty, setDeductQty] = useState('')
  const [deductNote, setDeductNote] = useState('')
  const [countVal, setCountVal] = useState('')
  const [minVal, setMinVal] = useState(String(cell.min))
  const [retQty, setRetQty] = useState('1')
  const [retSupplier, setRetSupplier] = useState('')
  const [retReason, setRetReason] = useState('')
  const [section, setSection] = useState<'none' | 'count' | 'return'>('none')
  const [history, setHistory] = useState<any[]>([])

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('parts_movements')
      .select('*')
      .eq('model_id', modelId)
      .eq('type_id', typeId)
      .order('created_at', { ascending: false })
      .limit(8)
    setHistory(data || [])
  }, [modelId, typeId])

  useEffect(() => { loadHistory() }, [loadHistory, cell.qty])

  useEffect(() => { setMinVal(String(cell.min)) }, [cell.min])

  const kindLabel: Record<string, string> = {
    purchase: 'Purchase', use: 'Used', adjust: 'Count fix', return_out: 'Sent to supplier', return_in: 'Back in stock',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-3">
          <div>
            <p className="text-xs text-gray-500">{props.modelLabel}</p>
            <h3 className="text-lg font-bold text-gray-900">{props.typeLabel}</h3>
          </div>
          <button onClick={props.onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none cursor-pointer" aria-label="Close">×</button>
        </div>

        {props.message && (
          <div className={`p-2.5 rounded-lg text-sm font-medium border ${props.message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            {props.message.text}
          </div>
        )}

        <div className="flex items-end gap-6">
          <div>
            <p className="text-xs text-gray-500">In stock</p>
            <p className={`text-4xl font-bold ${cell.qty < cell.min ? 'text-red-600' : 'text-gray-900'}`}>{cell.qty}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Minimum</p>
            <p className="text-xl font-semibold text-gray-700">{cell.min}</p>
          </div>
          {cell.qty < cell.min && cell.min > 0 && <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded mb-1">Below minimum</span>}
        </div>

        {/* Deduct */}
        <div className="space-y-2 p-4 rounded-lg bg-red-50/50 border border-red-100">
          <p className="text-sm font-semibold text-gray-800">Deduct (part used)</p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              disabled={busy || cell.qty < 1}
              onClick={async () => { if (await props.onDeduct(modelId, typeId, 1, deductNote)) setDeductNote('') }}
              className="bg-red-600 hover:bg-red-700 text-white w-12 h-10 rounded-lg text-xl font-bold disabled:opacity-40 cursor-pointer"
              title="Deduct 1"
            >
              −
            </button>
            <span className="text-xs text-gray-500">deducts 1, or type a quantity:</span>
            <input
              type="number" min={1} step={1} value={deductQty}
              onChange={e => setDeductQty(e.target.value)}
              placeholder="Qty"
              className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
            />
            <button
              disabled={busy || !deductQty}
              onClick={async () => { if (await props.onDeduct(modelId, typeId, parseInt(deductQty, 10), deductNote)) { setDeductQty(''); setDeductNote('') } }}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40 cursor-pointer"
            >
              Deduct
            </button>
          </div>
          <input
            value={deductNote} onChange={e => setDeductNote(e.target.value)}
            placeholder="Note (optional) - e.g. technician or job"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        {/* Minimum */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Minimum level</span>
          <input
            type="number" min={0} step={1} value={minVal} onChange={e => setMinVal(e.target.value)}
            className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900"
          />
          <button
            disabled={busy || minVal === '' || parseInt(minVal, 10) === cell.min}
            onClick={() => props.onSetMin(modelId, typeId, parseInt(minVal, 10))}
            className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
          >
            Save
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <button onClick={() => props.onPurchase(modelId, typeId)} className="bg-emerald-600 text-white px-3 py-2 rounded-lg cursor-pointer">+ Record purchase</button>
          <button onClick={() => setSection(section === 'return' ? 'none' : 'return')} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">Return to supplier</button>
          <button onClick={() => setSection(section === 'count' ? 'none' : 'count')} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">Fix count</button>
        </div>

        {section === 'return' && (
          <div className="space-y-2 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm font-semibold text-gray-800">Return poor-quality / defective parts</p>
            <div className="flex gap-2">
              <input type="number" min={1} step={1} value={retQty} onChange={e => setRetQty(e.target.value)} className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm" />
              <select value={retSupplier} onChange={e => setRetSupplier(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white">
                <option value="">Supplier / shop (optional)</option>
                {props.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <input value={retReason} onChange={e => setRetReason(e.target.value)} placeholder="Reason (required) - e.g. no display, touch not working" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button
              disabled={busy}
              onClick={async () => { if (await props.onReturn(modelId, typeId, parseInt(retQty, 10), retSupplier, retReason)) { setRetReason(''); setSection('none') } }}
              className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40 cursor-pointer"
            >
              Send back
            </button>
          </div>
        )}

        {section === 'count' && (
          <div className="space-y-2 p-4 rounded-lg bg-slate-50 border">
            <p className="text-sm font-semibold text-gray-800">Fix the count after a physical stock check</p>
            <div className="flex gap-2">
              <input type="number" min={0} step={1} value={countVal} onChange={e => setCountVal(e.target.value)} placeholder="Counted qty" className="w-32 border border-gray-300 rounded-lg px-2 py-2 text-sm" />
              <button
                disabled={busy || countVal === ''}
                onClick={async () => { if (await props.onSetCount(modelId, typeId, parseInt(countVal, 10), '')) { setCountVal(''); setSection('none') } }}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40 cursor-pointer"
              >
                Set count
              </button>
            </div>
          </div>
        )}

        {/* Recent history */}
        <div>
          <p className="text-sm font-semibold text-gray-800 mb-1">Recent changes</p>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400">No changes yet.</p>
          ) : (
            <div className="border rounded-lg divide-y text-xs">
              {history.map(h => (
                <div key={h.id} className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-gray-500 whitespace-nowrap">{h.movement_date}</span>
                  <span className="flex-1 text-gray-700 truncate" title={h.note || ''}>
                    {kindLabel[h.movement_type] || h.movement_type}{h.note ? ` - ${h.note}` : ''}
                  </span>
                  <span className={`font-semibold ${h.qty_change > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{h.qty_change > 0 ? '+' : ''}{h.qty_change}</span>
                  <span className="text-gray-400 w-16 text-right">→ {h.balance_after}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}