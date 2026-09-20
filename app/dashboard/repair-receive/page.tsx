'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface QueueItem {
  id: string
  imei: string
  mode: 'receive' | 'reject'
  rejectionReason: string | null
  status: 'Queued' | 'Processing' | 'Success' | 'Error'
  errorMsg?: string
  time: string
  details?: {
    referenceNo?: string
    technician?: string
    services?: string[]
    computedStatus?: string
  }
}

export default function RepairReceivePage() {
  const [mode, setMode] = useState<'receive' | 'reject'>('receive')
  const [imeiInput, setImeiInput] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [servicesMap, setServicesMap] = useState<Map<string, string>>(new Map())
  
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [recentProcessed, setRecentProcessed] = useState<any[]>([])

  const processingRef = useRef(false)
  const queueRef = useRef<QueueItem[]>([])
  queueRef.current = queue

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchServices()
  }, [])

  async function fetchServices() {
    const { data } = await supabase.from('services').select('id, name')
    if (data) {
      setServicesMap(new Map(data.map(s => [s.id, s.name])))
    }
  }

  // Keep focus on IMEI input automatically for continuous scanning
  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])

  useEffect(() => {
    processQueue()
  }, [queue])

  function determineStatus(serviceNames: string[]): string {
    if (!serviceNames || serviceNames.length === 0) return 'Repaired'
    const combined = serviceNames.join(' ').toLowerCase()
    if (combined.includes('opening')) return 'Opened'
    if (combined.includes('closing')) return 'Closed'
    if (combined.includes('rework')) return 'Reworked'
    if (combined.includes('checking')) return 'Checked'
    return 'Repaired'
  }

  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleanImei = imeiInput.trim()
    if (!cleanImei) return

    if (mode === 'reject' && !rejectionReason.trim()) {
      alert('Please enter a rejection reason before scanning in Reject mode.')
      return
    }

    const alreadyQueued = queueRef.current.some(q => q.imei === cleanImei && (q.status === 'Queued' || q.status === 'Processing'))
    if (alreadyQueued) {
      setImeiInput('')
      return
    }

    const newItem: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      imei: cleanImei,
      mode,
      rejectionReason: mode === 'reject' ? rejectionReason.trim() : null,
      status: 'Queued',
      time: new Date().toLocaleTimeString()
    }

    setQueue(prev => [newItem, ...prev])
    setImeiInput('')
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  async function updateTechnicianDailyStock(technicianId: string, computedStatus: string, isRejected: boolean) {
    if (!technicianId) return
    const todayStr = new Date().toISOString().split('T')[0]

    // 1. Check if daily stock row exists for this technician today
    const { data: existingRecords, error: fetchError } = await supabase
      .from('daily_technician_stock')
      .select('*')
      .eq('technician_id', technicianId)
      .eq('stock_date', todayStr)
      .limit(1)

    if (fetchError) {
      console.error('Error fetching daily technician stock:', fetchError.message)
      return
    }

    let currentRecord = existingRecords && existingRecords.length > 0 ? existingRecords[0] : null

    // Determine increment mappings
    const incReceivedBack = 1
    const incRepaired = (!isRejected && computedStatus === 'Repaired') ? 1 : 0
    const incReworked = (!isRejected && computedStatus === 'Reworked') ? 1 : 0
    const incOpened = (!isRejected && computedStatus === 'Opened') ? 1 : 0
    const incChecked = (!isRejected && computedStatus === 'Checked') ? 1 : 0
    const incClosed = (!isRejected && computedStatus === 'Closed') ? 1 : 0
    const incRejected = isRejected ? 1 : 0

    if (currentRecord) {
      // Update existing record
      const newClosingPending = Math.max(0, (currentRecord.closing_pending || 0) - 1)
      await supabase
        .from('daily_technician_stock')
        .update({
          received_back: (currentRecord.received_back || 0) + incReceivedBack,
          repaired: (currentRecord.repaired || 0) + incRepaired,
          reworked: (currentRecord.reworked || 0) + incReworked,
          opened: (currentRecord.opened || 0) + incOpened,
          checked: (currentRecord.checked || 0) + incChecked,
          closed: (currentRecord.closed || 0) + incClosed,
          rejected_return: (currentRecord.rejected_return || 0) + incRejected,
          closing_pending: newClosingPending
        })
        .eq('id', currentRecord.id)
    } else {
      // Insert new record for today
      await supabase
        .from('daily_technician_stock')
        .insert({
          technician_id: technicianId,
          stock_date: todayStr,
          received_back: incReceivedBack,
          repaired: incRepaired,
          reworked: incReworked,
          opened: incOpened,
          checked: incChecked,
          closed: incClosed,
          rejected_return: incRejected,
          closing_pending: 0
        })
    }
  }

  async function processQueue() {
    if (processingRef.current) return
    
    const nextItem = queueRef.current.find(q => q.status === 'Queued')
    if (!nextItem) return

    processingRef.current = true
    setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'Processing' } : q))

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session expired. Please log in.')

      // 1. Search for latest item by IMEI
      const { data, error } = await supabase
        .from('repair_request_items')
        .select(`
          *,
          technicians_vendors (id, name, type),
          repair_requests (reference_number, user_id, status)
        `)
        .eq('imei', nextItem.imei)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw new Error(error.message)
      if (!data || data.length === 0) throw new Error(`No repair record found`)

      const itemData = data[0]

      if (itemData.received_at) {
        const refNo = itemData.repair_requests?.reference_number || 'Unknown'
        throw new Error(`Already received (${refNo})`)
      }

      const ids = itemData.service_ids && itemData.service_ids.length > 0
        ? itemData.service_ids
        : (itemData.service_id ? [itemData.service_id] : [])

      const serviceNames = ids.map((id: string) => servicesMap.get(id) || 'Unknown Service')
      const isRejectedMode = nextItem.mode === 'reject'
      const computedStatus = isRejectedMode ? 'Rejected' : determineStatus(serviceNames)

      const updatePayload: any = {
        current_status: computedStatus,
        received_at: new Date().toISOString(),
        received_by: user.id,
        rejection_reason: nextItem.rejectionReason
      }

      // 2. Update item record
      const { error: updateError } = await supabase
        .from('repair_request_items')
        .update(updatePayload)
        .eq('id', itemData.id)

      if (updateError) throw new Error(updateError.message)

      // 3. Log history event
      const primaryServiceId = ids[0] || null
      await supabase.from('repair_history_events').insert([{
        repair_request_item_id: itemData.id,
        repair_request_id: itemData.repair_request_id,
        imei: itemData.imei,
        technician_id: itemData.technician_id,
        service_id: primaryServiceId,
        event_type: computedStatus.toUpperCase(),
        status_snapshot: computedStatus,
        rejection_reason: nextItem.rejectionReason,
        performed_by: user.id
      }])

      // 4. Automatically update Technician Daily Stock Counters
      if (itemData.technician_id) {
        await updateTechnicianDailyStock(itemData.technician_id, computedStatus, isRejectedMode)
      }

      const successDetails = {
        referenceNo: itemData.repair_requests?.reference_number,
        technician: itemData.technicians_vendors?.name || 'Unknown',
        services: serviceNames,
        computedStatus
      }

      setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'Success', details: successDetails } : q))
      
      setRecentProcessed(prev => [{
        imei: nextItem.imei,
        mode: nextItem.mode,
        status: computedStatus,
        technician: itemData.technicians_vendors?.name || 'Unknown',
        services: serviceNames,
        time: nextItem.time
      }, ...prev.slice(0, 9)])

    } catch (err: any) {
      setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'Error', errorMsg: err.message || 'Failed' } : q))
    } finally {
      processingRef.current = false
      setTimeout(() => processQueue(), 20)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Repair Receive & Blazing-Fast Continuous Scanning</h2>
        <p className="text-sm text-gray-600">Scan items back-to-back instantly. Automatically updates daily technician stock metrics.</p>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border flex items-center space-x-6">
        <span className="text-sm font-semibold text-gray-700">Operation Mode:</span>
        <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-gray-900">
          <input 
            type="radio" 
            name="receiveMode"
            checked={mode === 'receive'}
            onChange={() => setMode('receive')}
            className="w-4 h-4 text-slate-900"
          />
          <span>Receive Mode</span>
        </label>
        <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-gray-900">
          <input 
            type="radio" 
            name="receiveMode"
            checked={mode === 'reject'}
            onChange={() => setMode('reject')}
            className="w-4 h-4 text-slate-900"
          />
          <span>Reject Mode</span>
        </label>
      </div>

      {mode === 'reject' && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg space-y-2">
          <label className="block text-sm font-semibold text-amber-900">Rejection Reason (Required)</label>
          <input 
            type="text"
            placeholder="Enter reason for rejection..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="w-full bg-white text-gray-900 border border-amber-300 p-3 rounded-lg focus:ring-2 focus:ring-amber-900 outline-none text-sm font-sans"
          />
        </div>
      )}

      {/* Continuous Scanner Input Form */}
      <div className={`p-6 rounded-lg shadow-sm border ${mode === 'receive' ? 'bg-white' : 'bg-red-50/20 border-red-200'}`}>
        <form onSubmit={handleScanSubmit} className="space-y-3">
          <label className="block text-sm font-bold text-gray-900">
            {mode === 'receive' ? '📥 Continuous Scan IMEI to Receive' : '❌ Continuous Scan IMEI to Reject'}
          </label>
          <div className="flex gap-4">
            <input 
              ref={inputRef}
              autoFocus
              type="text"
              placeholder="Scan barcode or type IMEI..."
              value={imeiInput}
              onChange={(e) => setImeiInput(e.target.value)}
              className="flex-1 bg-white text-gray-900 placeholder:text-gray-400 border border-gray-300 p-3.5 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none font-mono text-base"
            />
          </div>
          <p className="text-xs text-gray-500">Input auto-clears instantly so you can scan the next device right away.</p>
        </form>
      </div>

      {/* Background Queue Monitor */}
      {queue.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow-sm border space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-800">Processing Queue</h3>
            <span className="bg-amber-600 text-white text-xs px-2.5 py-0.5 rounded-full font-mono font-bold">
              {queue.filter(q => q.status === 'Success').length} / {queue.length} Processed
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y font-mono text-xs">
            {queue.map(q => (
              <div key={q.id} className="py-2 flex items-center justify-between gap-4">
                <span className="font-bold text-gray-900">{q.imei}</span>
                <div>
                  {q.status === 'Queued' && <span className="text-gray-500">Queued...</span>}
                  {q.status === 'Processing' && <span className="text-blue-600 animate-pulse">Processing...</span>}
                  {q.status === 'Success' && <span className="text-emerald-700 font-bold">✓ {q.details?.computedStatus}</span>}
                  {q.status === 'Error' && <span className="text-red-600 font-sans">✕ {q.errorMsg}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Success Feed */}
      {recentProcessed.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow-sm border space-y-3">
          <h3 className="text-sm font-bold text-gray-800">Recently Scanned & Logged</h3>
          <div className="divide-y text-xs font-mono">
            {recentProcessed.map((item, idx) => (
              <div key={idx} className="py-2.5 flex justify-between items-center gap-4">
                <div>
                  <span className="font-bold text-gray-900">{item.imei}</span>
                  <span className="ml-2 text-gray-500 font-sans">({item.technician})</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-0.5 rounded font-bold ${item.mode === 'receive' ? 'bg-slate-900 text-white' : 'bg-red-700 text-white'}`}>
                    {item.status}
                  </span>
                  <span className="text-gray-400 font-sans">{item.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}