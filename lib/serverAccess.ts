// lib/serverAccess.ts
//
// Server-only: who is calling, what role they have, and which modules that
// role may open. Reads the Supabase session from the request cookies, verifies
// it with Supabase, then reads profiles/role_permissions with the service role
// so the answer does not depend on row-level-security policies.

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export type CallerAccess =
  | { ok: true; userId: string; role: string; isAdmin: boolean; modules: string[] }
  | { ok: false; status: 401 | 403; error: string }

export async function getCallerAccess(request: NextRequest): Promise<CallerAccess> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll() {
          // Route handlers here don't refresh the session cookie; proxy.ts does that.
        },
      },
    }
  )

  // getUser() asks Supabase to verify the token, so a forged cookie is rejected.
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized' }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_active === false) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  const role = String(profile.role || 'user')
  if (role === 'admin') {
    return { ok: true, userId: user.id, role, isAdmin: true, modules: ['*'] }
  }

  const { data: perms } = await supabaseAdmin
    .from('role_permissions')
    .select('module_id')
    .eq('role', role)

  const modules = (perms || []).map((p: { module_id: string }) => p.module_id)
  return { ok: true, userId: user.id, role, isAdmin: false, modules }
}
