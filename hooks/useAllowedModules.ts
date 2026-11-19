'use client'

import { useState, useEffect } from 'react'
import { canAccessModule } from '@/lib/modules'

// Role and allowed modules come from /api/me/access, which reads them on the
// server. Reading them straight from Supabase in the browser failed for users
// whose profile row the row-level-security policies hide.
export function useAllowedModules() {
  const [role, setRole] = useState<string | null>(null)
  const [allowedModules, setAllowedModules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadPermissions() {
      try {
        const res = await fetch('/api/me/access', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            setRole(data.role ?? null)
            setAllowedModules(Array.isArray(data.modules) ? data.modules : [])
          }
        }
      } catch {
        // Leave access empty: nothing is shown rather than everything
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadPermissions()
    return () => { cancelled = true }
  }, [])

  function canAccess(moduleId: string) {
    if (role === 'admin') return true
    return canAccessModule(allowedModules, moduleId)
  }

  return { role, allowedModules, canAccess, loading }
}
