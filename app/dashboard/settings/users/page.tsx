'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface UserProfile {
  id: string
  email: string
  role: string
  is_active: boolean
  name?: string
}

export default function UsersManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Form States
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState('user')

  // Password reset inline state
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  // Messages
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').order('id')
    if (!error && data) setUsers(data as UserProfile[])
    setLoading(false)
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, email, password, role }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to create user')
      } else {
        setSuccessMsg('User successfully created!')
        setName('')
        setEmail('')
        setPassword('')
        setRole('user')
        fetchUsers()
      }
    } catch {
      setErrorMsg('An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUpdateUser(userId: string, newRole: string, newIsActive: boolean) {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', userId, role: newRole, isActive: newIsActive }),
    })
    if (res.ok) fetchUsers()
  }

  async function handleResetPassword(userId: string) {
    if (!newPassword) return
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', userId, password: newPassword }),
    })
    if (res.ok) {
      setSuccessMsg('Password updated successfully!')
      setResetPwdUserId(null)
      setNewPassword('')
    } else {
      const data = await res.json()
      setErrorMsg(data.error || 'Failed to update password')
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border">
        <h2 className="text-xl font-bold text-gray-900">User Access Management</h2>
        <p className="text-sm text-gray-600 mt-1">Manage user roles, account status, and passwords.</p>
      </div>

      <form onSubmit={handleCreateUser} className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="text-sm font-bold text-gray-800 uppercase">Create New User</h3>
        
        {errorMsg && <div className="bg-red-50 text-red-700 text-xs p-3 rounded">{errorMsg}</div>}
        {successMsg && <div className="bg-emerald-50 text-emerald-700 text-xs p-3 rounded">{successMsg}</div>}
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input 
            type="text" 
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="Full Name" 
            required 
            className="border rounded-lg p-2 text-sm outline-none focus:border-blue-600" 
          />
          <input 
            type="email" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            placeholder="Email Address" 
            required 
            className="border rounded-lg p-2 text-sm outline-none focus:border-blue-600" 
          />
          
          <div className="relative">
            <input 
              type={showPassword ? "text" : "password"} 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="Password" 
              required 
              className="w-full border rounded-lg p-2 pr-14 text-sm outline-none focus:border-blue-600" 
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <select 
            value={role} 
            onChange={e => setRole(e.target.value)} 
            className="border rounded-lg p-2 text-sm font-semibold bg-white outline-none focus:border-blue-600"
          >
            <option value="user">User</option>
            <option value="operator">Operator</option>
            <option value="supervisor">Supervisor</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : 'Create User'}
        </button>
      </form>

      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="text-sm font-bold text-gray-800 uppercase">Existing Users</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading users...</p>
        ) : (
          <div className="divide-y">
            {users.map(u => (
              <div key={u.id} className="py-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-mono font-medium text-gray-900">{u.email || u.id}</p>
                    <p className="text-xs text-gray-500">Status: {u.is_active ? 'Active' : 'Deactivated'}</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      type="button"
                      onClick={() => setResetPwdUserId(resetPwdUserId === u.id ? null : u.id)}
                      className="px-2.5 py-1.5 rounded text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 border"
                    >
                      {resetPwdUserId === u.id ? 'Cancel' : 'Change Password'}
                    </button>
                    <select 
                      value={u.role || 'user'} 
                      onChange={e => handleUpdateUser(u.id, e.target.value, u.is_active)}
                      className="border rounded p-1.5 text-xs font-bold bg-white"
                    >
                      <option value="user">User</option>
                      <option value="operator">Operator</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button 
                      type="button"
                      onClick={() => handleUpdateUser(u.id, u.role, !u.is_active)}
                      className={`px-3 py-1.5 rounded text-xs font-bold text-white transition-colors ${
                        u.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>

                {resetPwdUserId === u.id && (
                  <div className="flex gap-2 pt-2 items-center bg-gray-50 p-2 rounded-lg border">
                    <input
                      type="text"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="border rounded p-1.5 text-xs bg-white w-64 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleResetPassword(u.id)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold"
                    >
                      Save Password
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}