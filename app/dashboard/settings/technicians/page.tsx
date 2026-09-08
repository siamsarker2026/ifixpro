'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function TechniciansPage() {
  const [staffList, setStaffList] = useState<any[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('internal')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    fetchStaff()
  }, [])

  async function fetchStaff() {
    const { data } = await supabase.from('technicians_vendors').select('*').order('name', { ascending: true })
    if (data) setStaffList(data)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const { error } = await supabase.from('technicians_vendors').insert([{
      name: name.trim(),
      type: type,
      is_active: true
    }])

    if (error) setErrorMsg(error.message)
    else {
      setName('')
      setErrorMsg('')
      fetchStaff()
    }
  }

  async function toggleStatus(id: string, currentStatus: boolean) {
    const { error } = await supabase.from('technicians_vendors').update({ is_active: !currentStatus }).eq('id', id)
    if (!error) fetchStaff()
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this entry?')) return
    const { error } = await supabase.from('technicians_vendors').delete().eq('id', id)
    if (!error) fetchStaff()
  }

  function toggleTeamMember(techName: string) {
    if (selectedMembers.includes(techName)) {
      setSelectedMembers(selectedMembers.filter(m => m !== techName))
    } else {
      setSelectedMembers([...selectedMembers, techName])
    }
  }

  async function handleCreateTeam() {
    if (selectedMembers.length === 0) return
    const combinedName = selectedMembers.join('+')

    const { error } = await supabase.from('technicians_vendors').insert([{
      name: combinedName,
      type: 'internal',
      is_active: true
    }])

    if (error) setErrorMsg(error.message)
    else {
      setSelectedMembers([])
      setErrorMsg('')
      fetchStaff()
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Manage Technicians & Teams</h2>
        <p className="text-sm text-gray-600">All staff, active states, and teams managed in one table.</p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border text-sm">{errorMsg}</div>
      )}

      {/* Add Individual */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="font-bold text-gray-900 text-sm uppercase">Add Individual Staff</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input 
            type="text" 
            placeholder="Name (e.g. Mehdi)" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none"
            required 
          />
          <select 
            value={type} 
            onChange={(e) => setType(e.target.value)}
            className="bg-white text-gray-900 border border-gray-300 p-2.5 rounded-lg text-sm outline-none"
          >
            <option value="internal">Internal</option>
            <option value="vendor">Vendor</option>
          </select>
          <button type="submit" className="bg-slate-900 text-white p-2.5 rounded-lg font-medium text-sm hover:bg-slate-800">
            Add Staff
          </button>
        </form>
      </div>

      {/* Make a Team */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="font-bold text-gray-900 text-sm uppercase">Make a Team</h3>
        <p className="text-xs text-gray-500">Select active individuals to combine them into a team:</p>
        <div className="flex flex-wrap gap-2 p-3 border rounded-lg bg-gray-50">
          {staffList.filter(s => s.is_active !== false && !s.name.includes('+')).map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => toggleTeamMember(s.name)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                selectedMembers.includes(s.name)
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {s.name} {selectedMembers.includes(s.name) && '✓'}
            </button>
          ))}
        </div>
        {selectedMembers.length > 0 && (
          <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border">
            <span className="text-sm font-medium text-gray-800">
              Team Preview: <span className="font-bold text-slate-900">{selectedMembers.join('+')}</span>
            </span>
            <button 
              type="button" 
              onClick={handleCreateTeam} 
              className="bg-green-700 text-white px-4 py-2 rounded-lg font-medium text-xs hover:bg-green-800"
            >
              Save Team
            </button>
          </div>
        )}
      </div>

      {/* Staff & Teams Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-gray-50 font-semibold text-sm text-gray-900">Staff & Teams List ({staffList.length})</div>
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50/50">
            <tr>
              <th className="p-3 text-gray-900">Name / Team</th>
              <th className="p-3 text-gray-900">Type</th>
              <th className="p-3 text-gray-900">Status</th>
              <th className="p-3 text-gray-900 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {staffList.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="p-3 font-bold text-gray-900">{s.name}</td>
                <td className="p-3 text-gray-600 capitalize">{s.type}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${s.is_active !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {s.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-3 text-right space-x-3">
                  <button onClick={() => toggleStatus(s.id, s.is_active !== false)} className="text-blue-600 text-xs font-medium hover:underline">
                    {s.is_active !== false ? 'Make Inactive' : 'Make Active'}
                  </button>
                  <button onClick={() => deleteEntry(s.id)} className="text-red-600 text-xs font-medium hover:underline">
                    {s.name.includes('+') ? 'Break Team' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}