'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface QueueItem {
  id: string
  imei: string
  technicianId: string
  services: any[]
  status: 'Queued' | 'Processing' | 'Saved' | 'Error'
  errorMsg?: string
  time: string
}

export default function RepairRequestPage() {
  const [openRequests, setOpenRequests] = useState<any[]>([])
  const [technicians, setTechnicians] = useState<any[]>([])
  const [services, setServices] = useState<any[]>([])

  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [selectedRequestObj, setSelectedRequestObj] = useState<any>(null)

  const [technicianId, setTechnicianId] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')
  const [selectedServices, setSelectedServices] = useState<any[]>([])
  const [isServiceDropdownOpen, setIsServiceDropdownOpen] = useState(false)
  const [imeiInput, setImeiInput] = useState('')
  
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [scannedItems, setScannedItems] = useState<any[]>([])

  const processingRef = useRef(false)
  const queueRef = useRef<QueueItem[]>([])
  queueRef.current = queue

  const imeiInputRef = useRef<HTMLInputElement>(null)

  const [isRemoveMode, setIsRemoveMode] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  useEffect(() => {
    fetchInitialData()
  }, [])

  useEffect(() => {
    processQueue()
  }, [queue])

  async function fetchInitialData() {
    setLoading(true)
    
    const { data: techData, error: techError } = await supabase
      .from('technicians_vendors')
      .select('*')
      .eq('is_active', true)

    if (techError) {
      setFetchError(techError.message)
    } else {
      setTechnicians(techData || [])
    }

    const { data: servData } = await supabase.from('services').select('*').eq('is_active', true)
    if (servData && servData.length > 0) {
      setServices(servData)
    }

    await loadOpenRequests()
    setLoading(false)
  }

  async function loadOpenRequests() {
    const { data: reqs, error } = await supabase
      .from('repair_requests')
      .select('*')
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching open repair requests:', error)
      setOpenRequests([])
    } else if (reqs && reqs.length > 0) {
      const userIds = Array.from(new Set(reqs.map(r => r.user_id)))
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('uuid, full_name')
        .in('uuid', userIds)

      const profileMap = new Map()
      profilesData?.forEach(p => profileMap.set(p.uuid, p.full_name))

      const formatted = reqs.map(r => ({
        ...r,
        creator_name: profileMap.get(r.user_id) || 'Technician'
      }))

      setOpenRequests(formatted)
    } else {
      setOpenRequests([])
    }
  }

  async function handleSelectRequest(req: any) {
    setSelectedRequestId(req.id)
    setSelectedRequestObj(req)
    setStatusMessage(null)
    setQueue([])
    await loadScannedItemsForRequest(req.id)
  }

  async function loadScannedItemsForRequest(reqId: string) {
    const { data: items, error } = await supabase
      .from('repair_request_items')
      .select('*')
      .eq('repair_request_id', reqId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading items:', error)
      setScannedItems([])
    } else {
      const serviceMap = new Map(services.map(s => [s.id, s.name]))

      const formatted = (items || []).map((item: any) => {
        const ids = item.service_ids && item.service_ids.length > 0 ? item.service_ids : []
        const serviceNames = ids.map((id: string) => serviceMap.get(id) || 'Unknown Service')

        return {
          imei: item.imei,
          services: serviceNames,
          time: new Date(item.created_at).toLocaleTimeString()
        }
      })
      setScannedItems(formatted)
    }
  }

  async function handleCreateNewRequest() {
    setActionLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('You must be logged in.')
      setActionLoading(false)
      return
    }

    const { data: newReq, error } = await supabase.rpc('create_repair_request', {
      p_user_id: user.id
    })

    if (error || !newReq) {
      alert('Failed to create repair request: ' + (error?.message || 'Unknown error'))
      setActionLoading(false)
      return
    }

    await loadOpenRequests()
    setSelectedRequestId(newReq.id)
    setSelectedRequestObj(newReq)
    setScannedItems([])
    setQueue([])
    setStatusMessage(null)
    setActionLoading(false)
  }

  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(serviceSearch.toLowerCase())
  )

  const handleToggleService = (srv: any) => {
    const exists = selectedServices.some(s => s.id === srv.id)
    if (exists) {
      setSelectedServices(selectedServices.filter(s => s.id !== srv.id))
    } else {
      setSelectedServices([...selectedServices, srv])
    }
  }

  async function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!imeiInput.trim()) return
    if (!selectedRequestId) {
      alert('Please select or create an active Repair Request first.')
      return
    }

    const cleanImei = imeiInput.trim()
    setStatusMessage(null)

    if (isRemoveMode) {
      setImeiInput('')
      const { data: existingMatch, error: matchError } = await supabase
        .from('repair_request_items')
        .select('id')
        .eq('repair_request_id', selectedRequestId)
        .eq('imei', cleanImei)
        .maybeSingle()

      if (matchError || !existingMatch) {
        setStatusMessage({ text: 'IMEI is not assigned in this Repair Request.', type: 'error' })
        return
      }

      const { error: deleteError } = await supabase
        .from('repair_request_items')
        .delete()
        .eq('repair_request_id', selectedRequestId)
        .eq('imei', cleanImei)

      if (deleteError) {
        setStatusMessage({ text: `Error removing IMEI: ${deleteError.message}`, type: 'error' })
        return
      }

      setScannedItems(prev => prev.filter(item => item.imei !== cleanImei))
      setStatusMessage({ text: 'IMEI removed from current Repair Request', type: 'success' })
      return
    }

    if (!technicianId) {
      alert('Please select a technician.')
      return
    }
    if (selectedServices.length === 0) {
      alert('Please select at least one service before scanning.')
      return
    }

    const alreadyInQueue = queueRef.current.some(q => q.imei === cleanImei && (q.status === 'Queued' || q.status === 'Processing'))
    const alreadySaved = scannedItems.some(s => s.imei === cleanImei)

    if (alreadyInQueue || alreadySaved) {
      setStatusMessage({ text: `⚠️ IMEI ${cleanImei} is already queued or saved in this session.`, type: 'info' })
      setImeiInput('')
      if (imeiInputRef.current) imeiInputRef.current.focus()
      return
    }

    const newQueueItem: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      imei: cleanImei,
      technicianId: technicianId,
      services: [...selectedServices],
      status: 'Queued',
      time: new Date().toLocaleTimeString()
    }

    setQueue(prev => [newQueueItem, ...prev])
    setImeiInput('')
    if (imeiInputRef.current) {
      imeiInputRef.current.focus()
    }
  }

  async function processQueue() {
    if (processingRef.current) return
    
    const nextItem = queueRef.current.find(q => q.status === 'Queued')
    if (!nextItem) return

    processingRef.current = true

    setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'Processing' } : q))

    try {
      const { data: reqCheck, error: reqCheckErr } = await supabase
        .from('repair_requests')
        .select('status')
        .eq('id', selectedRequestId)
        .single()

      if (reqCheckErr || !reqCheck || reqCheck.status !== 'OPEN') {
        throw new Error('Repair Request is closed. Modifications are blocked.')
      }

      const { data: activeCheck, error: activeErr } = await supabase
        .from('repair_request_items')
        .select('id')
        .eq('imei', nextItem.imei)
        .ilike('current_status', 'Assigned')
        .maybeSingle()

      if (activeErr) {
        throw new Error(activeErr.message)
      }

      if (activeCheck) {
        throw new Error('IMEI is currently active (Assigned) in another repair flow.')
      }

      const res = await fetch(`/api/device?imei=${nextItem.imei}`)
      const apiResult = await res.json()

      if (!apiResult.success || !apiResult.device) {
        throw new Error(apiResult.error || 'IMEI not found in Master Database')
      }

      const serviceIdsArray = nextItem.services.map((s: any) => s.id)
      const { data: { user } } = await supabase.auth.getUser()

      const { error: itemError } = await supabase
        .from('repair_request_items')
        .insert({
          repair_request_id: selectedRequestId,
          technician_id: nextItem.technicianId,
          service_ids: serviceIdsArray,
          imei: nextItem.imei,
          model: apiResult.device.model,
          storage_gb: apiResult.device.gb,
          color: apiResult.device.color,
          current_status: 'Assigned',
          assigned_by: user ? user.id : null
        })

      if (itemError) {
        throw new Error(itemError.message)
      }

      setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'Saved' } : q))
      
      setScannedItems(prev => [{
        imei: nextItem.imei,
        services: nextItem.services.map((s: any) => s.name),
        time: nextItem.time
      }, ...prev])

    } catch (err: any) {
      console.error('Queue item processing error:', err)
      setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'Error', errorMsg: err.message || 'Processing failed' } : q))
    } finally {
      processingRef.current = false
      setTimeout(() => processQueue(), 50)
    }
  }

  function handleRetryItem(item: QueueItem) {
    setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'Queued', errorMsg: undefined } : q))
  }

  async function handleCloseRequest() {
    if (!selectedRequestId || !selectedRequestObj) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('You must be logged in.')
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isAdmin = profile?.role === 'admin'
    const isCreator = selectedRequestObj.user_id === user.id

    if (!isAdmin && !isCreator) {
      alert('Permission Denied: Only the request creator or an admin can close this repair request.')
      return
    }

    const pendingCount = queue.filter(q => q.status === 'Queued' || q.status === 'Processing').length
    if (pendingCount > 0) {
      alert(`Cannot close request while ${pendingCount} items are still processing or queued.`)
      return
    }

    const { error } = await supabase
      .from('repair_requests')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('id', selectedRequestId)

    if (error) {
      alert(`Error closing request: ${error.message}`)
      return
    }

    alert('Request closed successfully!')
    setSelectedRequestId(null)
    setSelectedRequestObj(null)
    setScannedItems([])
    setQueue([])
    setStatusMessage(null)
    await loadOpenRequests()
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-500">Loading Repair Requests...</div>
  }

  if (!selectedRequestId) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Active Repair Requests Hub</h2>
            <p className="text-sm text-gray-500 mt-1">Select any open request below to resume work, or create a new sequential batch.</p>
          </div>
          <button
            onClick={handleCreateNewRequest}
            disabled={actionLoading}
            className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium shadow transition-all cursor-pointer disabled:opacity-50"
          >
            {actionLoading ? 'Creating...' : '+ CREATE NEW REQUEST'}
          </button>
        </div>

        {fetchError && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg border text-sm">
            Database Error: {fetchError}
          </div>
        )}

        <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-900 text-sm">All Open Repair Requests</h3>
            <span className="bg-slate-900 text-white text-xs px-2.5 py-0.5 rounded-full font-semibold">
              {openRequests.length} Total
            </span>
          </div>
          {openRequests.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No open repair requests found. Click <span className="font-semibold text-gray-700">Create New Request</span> to begin.
            </div>
          ) : (
            <div className="divide-y">
              {openRequests.map((req) => (
                <div key={req.id} className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                  <div>
                    <span className="font-mono font-bold text-slate-900 text-base">{req.reference_number}</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Created: {new Date(req.created_at).toLocaleString()} | Creator: <span className="font-medium text-gray-800">{req.creator_name}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => handleSelectRequest(req)}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all shadow-sm"
                  >
                    [ SELECT & CONTINUE WORK ]
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border flex flex-wrap justify-between items-center gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { setSelectedRequestId(null); setSelectedRequestObj(null); loadOpenRequests(); }}
              className="text-xs text-slate-600 hover:text-slate-900 underline font-medium cursor-pointer mr-2"
            >
              ← Back to All Requests
            </button>
            <span className="bg-amber-100 text-amber-800 text-xs px-3 py-1 rounded-full font-semibold">Active Session</span>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mt-2">
            Reference: <span className="font-mono text-slate-900">{selectedRequestObj?.reference_number}</span>
          </h2>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleCloseRequest}
            className="bg-red-600 hover:bg-red-700 text-white text-xs px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer shadow"
          >
            Close Request
          </button>
        </div>
      </div>

      <div className={`bg-white p-6 rounded-lg shadow-sm border grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity ${isRemoveMode ? 'opacity-50 pointer-events-none' : ''}`}>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Technician / Vendor</label>
          <select
            className="w-full bg-white text-gray-900 border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none"
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
          >
            <option value="" className="text-gray-400">-- Choose Technician --</option>
            {technicians.map((tech) => (
              <option key={tech.id} value={tech.id} className="text-gray-900">
                {tech.name} ({tech.type})
              </option>
            ))}
          </select>
        </div>

        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">Select Active Services (Multi)</label>
          <div
            className="w-full bg-white border border-gray-300 p-3 rounded-lg flex items-center justify-between cursor-pointer focus-within:ring-2 focus-within:ring-slate-900"
            onClick={() => setIsServiceDropdownOpen(true)}
          >
            <input
              type="text"
              placeholder="Search services to include..."
              value={serviceSearch}
              onChange={(e) => {
                setServiceSearch(e.target.value)
                setIsServiceDropdownOpen(true)
              }}
              className="w-full bg-transparent text-gray-900 placeholder:text-gray-400 outline-none"
            />
            <span className="text-gray-400 text-xs">▼</span>
          </div>

          {isServiceDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsServiceDropdownOpen(false)}
              />
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredServices.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500">No services found</div>
                ) : (
                  filteredServices.map((srv) => {
                    const isChecked = selectedServices.some(s => s.id === srv.id)
                    return (
                      <div
                        key={srv.id}
                        onClick={() => handleToggleService(srv)}
                        className={`p-3 cursor-pointer text-sm flex justify-between items-center border-b last:border-none ${
                          isChecked ? 'bg-slate-100 text-slate-900 font-medium' : 'hover:bg-slate-50 text-gray-800'
                        }`}
                      >
                        <span>{srv.name}</span>
                        <span>{isChecked ? '☑' : '☐'}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!isRemoveMode && selectedServices.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow-sm border space-y-2">
          <label className="block text-sm font-medium text-gray-700">Services applied to incoming IMEI scans ({selectedServices.length}):</label>
          <div className="flex flex-wrap gap-2">
            {selectedServices.map((srv) => (
              <span
                key={srv.id}
                className="bg-slate-900 text-white px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-2"
              >
                <span>{srv.name}</span>
                <button
                  type="button"
                  onClick={() => handleToggleService(srv)}
                  className="ml-1 text-red-300 hover:text-white font-bold cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={`bg-white p-6 rounded-lg shadow-sm border transition-all ${isRemoveMode ? 'border-red-300 bg-red-50/20' : ''}`}>
        <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
          <div className="flex items-center space-x-2">
            {isRemoveMode && (
              <span className="bg-red-600 text-white text-[11px] px-2.5 py-0.5 rounded font-bold uppercase tracking-wide animate-pulse">
                REMOVE MODE ACTIVE
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs font-medium text-gray-700">Remove Assigned IMEI</span>
            <button
              type="button"
              onClick={() => {
                setIsRemoveMode(!isRemoveMode)
                setStatusMessage(null)
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                isRemoveMode ? 'bg-red-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isRemoveMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className={`p-3 mb-4 rounded-lg text-sm font-medium border ${
            statusMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
            statusMessage.type === 'error' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-blue-50 text-blue-800 border-blue-200'
          }`}>
            {statusMessage.text}
          </div>
        )}

        <form onSubmit={handleScanSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isRemoveMode ? 'Scan IMEI to Remove from This Request' : 'Scan or Type IMEI (Continuous High-Speed Mode)'}
            </label>
            <input
              ref={imeiInputRef}
              autoFocus
              type="text"
              placeholder={isRemoveMode ? 'Scan IMEI to remove...' : 'Scan barcode or type IMEI and press enter...'}
              value={imeiInput}
              onChange={(e) => setImeiInput(e.target.value)}
              disabled={!isRemoveMode && (!technicianId || selectedServices.length === 0)}
              className={`w-full bg-white text-gray-900 placeholder:text-gray-400 border p-3 rounded-lg focus:ring-2 outline-none font-mono disabled:bg-gray-100 disabled:cursor-not-allowed ${
                isRemoveMode ? 'border-red-300 focus:ring-red-600' : 'border-gray-300 focus:ring-slate-900'
              }`}
            />
            {!isRemoveMode && !technicianId && <p className="text-xs text-amber-600 mt-1">⚠️ Please select a technician above before scanning.</p>}
            {!isRemoveMode && technicianId && selectedServices.length === 0 && <p className="text-xs text-amber-600 mt-1">⚠️ Please select at least one service above before scanning.</p>}
          </div>
        </form>

        {queue.length > 0 && (
          <div className="mt-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-gray-800">Background Scan Processing Queue</h3>
              <span className="bg-amber-600 text-white text-xs px-3 py-1 rounded-full font-bold font-mono">
                Queue Total: {queue.length} ({queue.filter(q => q.status === 'Saved').length} Saved)
              </span>
            </div>
            <div className="border rounded-lg overflow-hidden max-h-56 overflow-y-auto mb-6 bg-slate-50/50">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 border-b sticky top-0">
                  <tr>
                    <th className="p-2.5 font-medium text-gray-600">IMEI</th>
                    <th className="p-2.5 font-medium text-gray-600">Status</th>
                    <th className="p-2.5 font-medium text-gray-600">Details / Error</th>
                    <th className="p-2.5 font-medium text-gray-600">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono text-xs">
                  {queue.map((item) => (
                    <tr key={item.id} className="bg-white hover:bg-gray-50">
                      <td className="p-2.5 font-bold text-gray-900">{item.imei}</td>
                      <td className="p-2.5">
                        {item.status === 'Queued' && <span className="bg-gray-200 text-gray-800 px-2 py-0.5 rounded font-sans font-semibold">Queued</span>}
                        {item.status === 'Processing' && <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-sans font-semibold animate-pulse">Processing...</span>}
                        {item.status === 'Saved' && <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-sans font-semibold">Saved ✓</span>}
                        {item.status === 'Error' && <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded font-sans font-semibold">Error ✕</span>}
                      </td>
                      <td className="p-2.5 font-sans text-gray-600">
                        {item.status === 'Error' ? (
                          <div className="flex items-center space-x-2">
                            <span className="text-red-600 font-medium">{item.errorMsg}</span>
                            <button
                              onClick={() => handleRetryItem(item)}
                              className="bg-slate-900 text-white px-2 py-0.5 rounded text-[10px] cursor-pointer"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          `${item.services.length} service(s) attached`
                        )}
                      </td>
                      <td className="p-2.5 text-gray-400 font-sans">{item.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-800">Successfully Saved IMEIs in this Request</h3>
            <span className="bg-slate-900 text-white text-xs px-3 py-1 rounded-full font-bold font-mono">
              Total Saved: {scannedItems.length}
            </span>
          </div>
          <div className="border rounded-lg overflow-hidden">
            {scannedItems.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">No IMEIs saved yet in this request session.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-3 font-medium text-gray-600">#</th>
                    <th className="p-3 font-medium text-gray-600">IMEI</th>
                    <th className="p-3 font-medium text-gray-600">Assigned Services Bundle</th>
                    <th className="p-3 font-medium text-gray-600">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono">
                  {scannedItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-500">{scannedItems.length - idx}</td>
                      <td className="p-3 font-bold text-gray-900">{item.imei}</td>
                      <td className="p-3 font-sans">
                        <div className="flex flex-wrap gap-1">
                          {item.services.map((s: string, i: number) => (
                            <span key={i} className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs font-semibold">
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-gray-500 font-sans text-xs">{item.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}