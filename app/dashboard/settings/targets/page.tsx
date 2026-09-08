'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function DailyTargetPage() {
  const [targets, setTargets] = useState<any[]>([])
  const [services, setServices] = useState<any[]>([])
  const [technicians, setTechnicians] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Time Parameters State
  const [startTime, setStartTime] = useState('09:45')
  const [endTime, setEndTime] = useState('19:30')
  const [lunchMins, setLunchMins] = useState(60)
  const [prayerMins, setPrayerMins] = useState(30)
  const [cleaningMins, setCleaningMins] = useState(30)

  // Job Entry Form State
  const [selectedService, setSelectedService] = useState('')
  const [model, setModel] = useState('')
  const [selectedTechs, setSelectedTechs] = useState<string[]>([])
  const [batchQty, setBatchQty] = useState('')
  const [totalBatchTime, setTotalBatchTime] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    fetchInitialData()
  }, [])

  async function fetchInitialData() {
    setLoading(true)
    const [servicesRes, techsRes, targetsRes] = await Promise.all([
      supabase.from('services').select('id, name'),
      // FIX: Fetch from technicians_vendors table
      supabase.from('technicians_vendors').select('id, name, is_active').eq('is_active', true),
      supabase.from('daily_targets').select('*').order('created_at', { ascending: false })
    ])

    if (servicesRes.data) setServices(servicesRes.data)
    if (techsRes.data) setTechnicians(techsRes.data)
    if (targetsRes.data) setTargets(targetsRes.data)
    setLoading(false)
  }

  function timeToMinutes(timeStr: string) {
    const [hours, mins] = timeStr.split(':').map(Number)
    return hours * 60 + (mins || 0)
  }

  const startMins = timeToMinutes(startTime)
  const endMins = timeToMinutes(endTime)
  const totalOfficeMins = endMins - startMins
  const totalTableTimeMins = Math.max(0, totalOfficeMins - (Number(lunchMins) + Number(prayerMins) + Number(cleaningMins)))

  function toggleTechnician(techName: string) {
    if (selectedTechs.includes(techName)) {
      setSelectedTechs(selectedTechs.filter(t => t !== techName))
    } else {
      setSelectedTechs([...selectedTechs, techName])
    }
  }

 async function handleAddTarget(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedService || !model.trim() || !batchQty || !totalBatchTime) return

    const qty = parseInt(batchQty)
    const timeMins = parseFloat(totalBatchTime)
    
    // Count head count for reference (e.g. Mehdi+Riduan = 2)
    const totalMembersCount = selectedTechs.reduce((acc, techName) => {
      return acc + techName.split('+').length
    }, 0)
    const headCount = Math.max(1, totalMembersCount)

    const timePerUnit = qty > 0 ? timeMins / qty : 0
    
    // Pure benchmark capacity (no head count multiplication)
    const dailyCapacity = timePerUnit > 0 ? totalTableTimeMins / timePerUnit : 0

    const techNamesStr = selectedTechs.join(', ') || 'Solo'

    const { error } = await supabase.from('daily_targets').insert([{
      job_name: selectedService,
      model: model.trim(),
      technician_head_count: headCount,
      technician_names: techNamesStr,
      batch_quantity: qty,
      total_batch_time_minutes: timeMins,
      time_per_unit_minutes: timePerUnit,
      daily_capacity_pieces: dailyCapacity
    }])

    if (error) {
      setErrorMsg('Error adding target: ' + error.message)
    } else {
      setSelectedService('')
      setModel('')
      setSelectedTechs([])
      setBatchQty('')
      setTotalBatchTime('')
      setErrorMsg('')
      fetchInitialData()
    }
  }
  async function deleteTarget(id: string) {
    if (!confirm('Delete this target entry?')) return
    const { error } = await supabase.from('daily_targets').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    else fetchInitialData()
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Daily Target & Capacity Planning</h2>
        <p className="text-sm text-gray-600">Configure work hours, select technician teams, and calculate capacities.</p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">{errorMsg}</div>
      )}

      {/* Time Parameters Card */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Working Hours & Parameters</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="block text-gray-500 text-xs mb-1">Start Time</label>
            <input 
              type="time" 
              value={startTime} 
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2 rounded-lg outline-none" 
            />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">End Time</label>
            <input 
              type="time" 
              value={endTime} 
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2 rounded-lg outline-none" 
            />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">Lunch Time (Minutes)</label>
            <input 
              type="number" 
              value={lunchMins} 
              onChange={(e) => setLunchMins(Number(e.target.value))}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2 rounded-lg outline-none" 
            />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">Prayer Time (Minutes)</label>
            <input 
              type="number" 
              value={prayerMins} 
              onChange={(e) => setPrayerMins(Number(e.target.value))}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2 rounded-lg outline-none" 
            />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">Cleaning + Checking (Minutes)</label>
            <input 
              type="number" 
              value={cleaningMins} 
              onChange={(e) => setCleaningMins(Number(e.target.value))}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2 rounded-lg outline-none" 
            />
          </div>
          <div className="col-span-2 md:col-span-3 bg-slate-50 p-3 rounded-lg flex items-center justify-between border">
            <span className="text-gray-700 font-medium text-xs">Total Table Time in Minutes:</span>
            <span className="font-bold text-slate-900 text-base">{totalTableTimeMins} Min</span>
          </div>
        </div>
      </div>

      {/* Add Job Entry Form */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Job Entry / Cycle Count</h3>
        <form onSubmit={handleAddTarget} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-gray-500 text-xs mb-1">Job Name</label>
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none"
              required
            >
              <option value="">Select Service...</option>
              {services.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-500 text-xs mb-1">Model</label>
            <input 
              type="text"
              placeholder="e.g. iPhone 14 Pro"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-gray-500 text-xs mb-1">Qty (Units)</label>
            <input 
              type="number"
              min="1"
              placeholder="Units"
              value={batchQty}
              onChange={(e) => setBatchQty(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-gray-500 text-xs mb-1">Total Batch Time (Minutes)</label>
            <input 
              type="number"
              step="0.1"
              placeholder="Minutes"
              value={totalBatchTime}
              onChange={(e) => setTotalBatchTime(e.target.value)}
              className="w-full bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-gray-500 text-xs mb-1">Select Technicians (Team Head Count: {selectedTechs.length || 1})</label>
            <div className="flex flex-wrap gap-2 p-2 border rounded-lg bg-gray-50 max-h-32 overflow-y-auto">
              {technicians.length === 0 ? (
                <span className="text-xs text-gray-400">No technicians found. Add them in Technicians module.</span>
              ) : (
                technicians.map((tech) => (
                  <button
                    type="button"
                    key={tech.id}
                    onClick={() => toggleTechnician(tech.name)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedTechs.includes(tech.name)
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {tech.name} {selectedTechs.includes(tech.name) && '✓'}
                  </button>
                ))
              )}
            </div>
          </div>

          <button 
            type="submit"
            className="md:col-span-3 bg-slate-900 text-white p-3 rounded-lg font-medium hover:bg-slate-800 text-sm mt-2"
          >
            Calculate & Add Target Entry
          </button>
        </form>
      </div>

      {/* Targets Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-gray-50 font-semibold text-sm text-gray-900">
          Job Target List ({targets.length})
        </div>
        {loading ? (
          <p className="p-6 text-center text-sm text-gray-500">Loading targets...</p>
        ) : targets.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No job targets added yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50/50">
              <tr>
                <th className="p-3 font-medium text-gray-900">Job Name</th>
                <th className="p-3 font-medium text-gray-900">Model</th>
                <th className="p-3 font-medium text-gray-900">Team / Techs</th>
                <th className="p-3 font-medium text-gray-900">Qty (Units)</th>
                <th className="p-3 font-medium text-gray-900">Batch Time</th>
                <th className="p-3 font-medium text-gray-900">Time/Unit</th>
                <th className="p-3 font-medium text-gray-900">Daily Capacity</th>
                <th className="p-3 font-medium text-gray-900 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {targets.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-900">{t.job_name}</td>
                  <td className="p-3 text-gray-800">{t.model}</td>
                  <td className="p-3 text-gray-800">{t.technician_names || `${t.technician_head_count} Tech(s)`}</td>
                  <td className="p-3 text-gray-800">{t.batch_quantity} Units</td>
                  <td className="p-3 text-gray-800">{t.total_batch_time_minutes} Min</td>
                  <td className="p-3 text-gray-800">{Number(t.time_per_unit_minutes).toFixed(2)} Min</td>
                  <td className="p-3 font-bold text-green-700">{Math.round(t.daily_capacity_pieces)} Pcs</td>
                  <td className="p-3 text-right">
                    <button onClick={() => deleteTarget(t.id)} className="text-red-600 text-xs font-medium hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}