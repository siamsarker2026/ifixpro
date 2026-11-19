// lib/requireUserManager.ts
//
// Server-side gate for the admin APIs (/api/admin/*).
// Allowed: active users whose role is 'admin', or whose role has the
// 'settings/users' module (the same rule the User Management page uses).

import type { NextRequest } from 'next/server'
import { getCallerAccess } from '@/lib/serverAccess'
import { canAccessModule } from '@/lib/modules'

export type GateResult =
  | { ok: true; userId: string; role: string; isAdmin: boolean }
  | { ok: false; status: 401 | 403; error: string }

export async function requireUserManager(request: NextRequest): Promise<GateResult> {
  const access = await getCallerAccess(request)
  if (!access.ok) return access
  if (!access.isAdmin && !canAccessModule(access.modules, 'settings/users')) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, userId: access.userId, role: access.role, isAdmin: access.isAdmin }
}
