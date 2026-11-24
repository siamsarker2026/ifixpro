'use client'

import { useState, useEffect } from 'react'
import { canAccessModule } from '@/lib/modules'
import { supabase } from '@/lib/supabase'

// Role and allowed modules come from /api/me/access, which reads them on the
// server. Reading them straight from Supabase in the browser failed for users
// whose profile row the row-level-security policies hide.
//
// The answer is shared by every component and kept for a short time, so going
// from one module to another does not wait on the server again. It is dropped
// when the user signs in or out, and refreshed in the background once stale.
// The server still checks access on every API call; this cache only decides
// what the sidebar and pages show.

type Access = { role: string | null; modules: string[] }

const FRESH_MS = 60_000
let cached: Access | null = null
let cachedAt = 0
let inflight: Promise<Access> | null = null
const listeners = new Set<(a: Access) => void>()

async function fetchAccess(): Promise<Access> {
  try {
    const res = await fetch('/api/me/access', { cache: 'no-store' })
    if (!res.ok) return { role: null, modules: [] }
    const data = await res.json()
    return { role: data.role ?? null, modules: Array.isArray(data.modules) ? data.modules : [] }
  } catch {
    // Leave access empty: nothing is shown rather than everything
    return { role: null, modules: [] }
  }
}

function loadAccess(): Promise<Access> {
  if (!inflight) {
    inflight = fetchAccess().then(a => {
      cached = a
      cachedAt = Date.now()
      inflight = null
      listeners.forEach(fn => fn(a))
      return a
    })
  }
  return inflight
}

let authWatching = false
function watchAuth() {
  if (authWatching || typeof window === 'undefined') return
  authWatching = true
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      cached = null
      cachedAt = 0
      if (event !== 'SIGNED_OUT') loadAccess()
    }
  })
}

export function useAllowedModules() {
  const [access, setAccess] = useState<Access | null>(cached)

  useEffect(() => {
    watchAuth()
    listeners.add(setAccess)
    // Fresh enough: use it. Stale: show it and refresh behind it. None: load.
    if (!cached || Date.now() - cachedAt > FRESH_MS) loadAccess().then(setAccess)
    return () => { listeners.delete(setAccess) }
  }, [])

  const role = access?.role ?? null
  const allowedModules = access?.modules ?? []

  function canAccess(moduleId: string) {
    if (role === 'admin') return true
    return canAccessModule(allowedModules, moduleId)
  }

  return { role, allowedModules, canAccess, loading: access === null }
}
