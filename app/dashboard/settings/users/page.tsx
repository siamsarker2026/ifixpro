'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAllowedModules } from '@/hooks/useAllowedModules'

interface UserProfile {
  id: string
  email: string
  role: string
  is_active: boolean
  full_name?: string
}

interface ModuleItem {
  id: string
  name: string
  category: string
}

interface RolePermission {
  role: string
  module_id: string
}

const ROLES = ['user', 'operator', 'supervisor', 'manager', 'admin']

export default function UsersManagementPage() {
  const { canAccess, loading: permissionsLoading } = useAllowedModules()

  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // User Creation State
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState('user')

  // Password Reset State
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  // Permissions State
  const [modules, setModules] = useState<ModuleItem[]>([])
  const [permissions, setPermissions] = useState<Record<string, string[]>>({})
  const [selectedRole, setSelectedRole] = useState('operator')
  const [savingPerms, setSavingPerms] = useState(false)

  // Messages
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function fetchUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('id')
    if (data) setUsers(data as UserProfile[])
    setLoading(false)
  }

  async function fetchPermissions() {
    const res = await fetch('/api/admin/permissions')
    const data = await res.json()
    if (res.ok) {
      setModules(data.modules || [])
      const map: Record<string, string[]> = {}
      ROLES.forEach(r => { map[r] = [] })
      ;(data.permissions || []).forEach((p: RolePermission) => {
        if (!map[p.role]) map[p.role] = []
        map[p.role].push(p.module_id)
      })
      setPermissions(map)
    }
  }

  useEffect(() => {
    fetchUsers()
    fetchPermissions()
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
        body: JSON.stringify({ action: 'create', name: fullName, email, password, role }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to create user')
      } else {
        setSuccessMsg('User successfully created!')
        setFullName('')
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
    }
  }

  function toggleModulePermission(moduleId: string) {
    const currentList = permissions[selectedRole] || []
    const updated = currentList.includes(moduleId)
      ? currentList.filter(id => id !== moduleId)
      : [...currentList, moduleId]

    setPermissions({ ...permissions, [selectedRole]: updated })
  }

  async function handleSavePermissions() {
    setSavingPerms(true)
    const res = await fetch('/api/admin/permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: selectedRole, moduleIds: permissions[selectedRole] || [] }),
    })
    if (res.ok) setSuccessMsg(`Module access for "${selectedRole}" updated successfully!`)
    setSavingPerms(false)
  }

  // Route Protection Check
  if (permissionsLoading) {
    return <div className="p-8 text-sm text-gray-500">Checking permissions...</div>
  }

  if (!canAccess('settings/users') && !canAccess('settings')) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-semibold max-w-2xl mx-auto mt-8">
        Access Denied: You do not have permission to access User Management.
      </div>
    )
  }

  // Group modules by category for UI layout
  const categories = Array.from(new Set(modules.map(m => m.category)))

  return (
    <div className="max-w-5xl space-y-8 pb-12">
      <div>
        <h2 className="text-xl font-bold text-gray-900">User Access Management</h2>
        <p className="text-sm text-gray-600">Manage user accounts, passwords, and module access matrix.</p>
      </div>

      {errorMsg && <div className="bg-red-50 text-red-700 text-xs p-3 rounded-lg border border-red-200">{errorMsg}</div>}
      {successMsg && <div className="bg-emerald-50 text-emerald-700 text-xs p-3 rounded-lg border border-emerald-200">{successMsg}</div>}

      {/* --- CREATE USER FORM --- */}
      <form onSubmit={handleCreateUser} className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Create New User</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input 
            type="text" 
            value={fullName} 
            onChange={e => setFullName(e.target.value)} 
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
            className="border rounded-lg p-2 text-sm font-semibold bg-white outline-none focus:border-blue-600 capitalize"
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
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

      {/* --- MODULE ACCESS CONTROL BY ROLE --- */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Role-Based Module Access</h3>
            <p className="text-xs text-gray-500">Configure which sidebar modules each role can access.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-700">Select Role:</span>
            <select 
              value={selectedRole} 
              onChange={e => setSelectedRole(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-xs font-bold bg-gray-50 capitalize outline-none"
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {selectedRole === 'admin' ? (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 font-medium">
            <strong>Admin Role:</strong> Admins automatically have unrestricted access to all modules across the application.
          </div>
        ) : (
          <div className="space-y-6">
            {categories.map(category => (
              <div key={category} className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{category}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {modules.filter(m => m.category === category).map(mod => {
                    const isChecked = (permissions[selectedRole] || []).includes(mod.id)
                    return (
                      <label 
                        key={mod.id} 
                        className={`flex items-center gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                          isChecked ? 'bg-blue-50 border-blue-500 font-bold text-blue-900 shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleModulePermission(mod.id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        {mod.name}
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={handleSavePermissions}
              disabled={savingPerms}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
            >
              {savingPerms ? 'Saving...' : `Save Module Access for ${selectedRole.toUpperCase()}`}
            </button>
          </div>
        )}
      </div>

      {/* --- EXISTING USERS TABLE --- */}
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Existing Users</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading users...</p>
        ) : (
          <div className="divide-y">
            {users.map(u => (
              <div key={u.id} className="py-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-bold text-gray-900">{u.full_name || 'No Name'}</p>
                    <p className="font-mono text-xs text-gray-500">{u.email}</p>
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
                      className="border rounded p-1.5 text-xs font-bold bg-white capitalize"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
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
                  <div className="flex gap-2 p-2 bg-gray-50 rounded-lg border items-center">
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