'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export function useAllowedModules() {
  const [role, setRole] = useState<string | null>(null)
  const [allowedModules, setAllowedModules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadPermissions() {
      // 1. Get logged-in user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // 2. Fetch user's role from profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const userRole = profile?.role || 'user'
      setRole(userRole)

      // 3. Admin gets access to everything
      if (userRole === 'admin') {
        setAllowedModules(['*'])
        setLoading(false)
        return
      }

      // 4. Fetch permissions for user's role
      const { data: perms } = await supabase
        .from('role_permissions')
        .select('module_id')
        .eq('role', userRole)

      if (perms) {
        setAllowedModules(perms.map(p => p.module_id))
      }
      setLoading(false)
    }

    loadPermissions()
  }, [])

  function canAccess(moduleId: string) {
    if (role === 'admin' || allowedModules.includes('*')) return true
    // Matches top-level module or category (e.g., 'reports' matches 'reports/diagnostics-report')
    return allowedModules.some(m => m === moduleId || m.startsWith(`${moduleId}/`))
  }

  return { role, allowedModules, canAccess, loading }
}