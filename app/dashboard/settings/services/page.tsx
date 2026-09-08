'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function ServicesSettingsPage() {
  const [services, setServices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [serviceName, setServiceName] = useState('')
  const [statusMapping, setStatusMapping] = useState('Repaired')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    fetchServices()
  }, [])

  async function fetchServices() {
    setLoading(true)
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      setErrorMsg(error.message)
    } else {
      setServices(data || [])
    }
    setLoading(false)
  }

  async function handleAddService(e: React.FormEvent) {
    e.preventDefault()
    if (!serviceName.trim()) return

    setErrorMsg('')
    const { error } = await supabase
      .from('services')
      .insert([{ 
        name: serviceName.trim(), 
        status_mapping: statusMapping,
        is_active: true 
      }])

    if (error) {
      setErrorMsg('Error adding service: ' + error.message)
    } else {
      setServiceName('')
      fetchServices()
    }
  }

  async function toggleActive(id: string, currentStatus: boolean) {
    const { error } = await supabase
      .from('services')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      setErrorMsg('Error updating status: ' + error.message)
    } else {
      fetchServices()
    }
  }

  async function deleteService(id: string) {
    if (!confirm('Are you sure you want to delete this service?')) return
    const { error } = await supabase.from('services').delete().eq('id', id)
    if (error) {
      setErrorMsg('Error deleting service: ' + error.message)
    } else {
      fetchServices()
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">Manage Services</h2>
        <p className="text-sm text-gray-600">Add and manage repair service types that appear in the Repair Request workflow.</p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Add Service Form */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <form onSubmit={handleAddService} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input 
            type="text"
            placeholder="Service name (e.g. Back Glass)..."
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            className="md:col-span-2 bg-white text-gray-900 placeholder:text-gray-400 border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-sm"
          />
          <select
            value={statusMapping}
            onChange={(e) => setStatusMapping(e.target.value)}
            className="bg-white text-gray-900 border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-sm"
          >
            <option value="Repaired">Repaired</option>
            <option value="Opened">Opened</option>
            <option value="Closed">Closed</option>
            <option value="Reworked">Reworked</option>
            <option value="Checked">Checked</option>
          </select>
          <button 
            type="submit"
            className="md:col-span-3 bg-slate-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-slate-800 transition text-sm"
          >
            Add Service
          </button>
        </form>
      </div>

      {/* Services List Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-gray-50 font-semibold text-sm text-gray-900">
          Existing Services ({services.length})
        </div>
        {loading ? (
          <p className="p-6 text-center text-sm text-gray-500">Loading services...</p>
        ) : services.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No services found. Add your first service above.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50/50">
              <tr>
                <th className="p-3 font-medium text-gray-900">Service Name</th>
                <th className="p-3 font-medium text-gray-900">Status Mapping</th>
                <th className="p-3 font-medium text-gray-900">Status</th>
                <th className="p-3 font-medium text-gray-900 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {services.map((srv) => (
                <tr key={srv.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-900">{srv.name}</td>
                  <td className="p-3 text-gray-600">{srv.status_mapping}</td>
                  <td className="p-3">
                    <button 
                      onClick={() => toggleActive(srv.id, srv.is_active)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        srv.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {srv.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="p-3 text-right">
                    <button 
                      onClick={() => deleteService(srv.id)}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
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