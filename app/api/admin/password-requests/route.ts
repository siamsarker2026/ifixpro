import { NextResponse, type NextRequest } from 'next/server'
import { requireUserManager } from '@/lib/requireUserManager'
import { supabaseAdmin } from '@/lib/serverAccess'

// Admin side of password change requests: list pending ones, then either set
// the new password or dismiss the request.

export async function GET(request: NextRequest) {
  const gate = await requireUserManager(request)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data, error } = await supabaseAdmin
    .from('password_reset_requests')
    .select('id, user_id, email, note, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('admin/password-requests: list failed', error.message)
    return NextResponse.json({ error: 'Could not load requests' }, { status: 500 })
  }

  const ids = Array.from(new Set((data || []).map(r => r.user_id)))
  const names = new Map<string, { full_name: string | null; role: string | null }>()
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin.from('profiles').select('id, full_name, role').in('id', ids)
    ;(profiles || []).forEach(p => names.set(p.id, { full_name: p.full_name, role: p.role }))
  }

  return NextResponse.json({
    requests: (data || []).map(r => ({
      ...r,
      full_name: names.get(r.user_id)?.full_name ?? null,
      role: names.get(r.user_id)?.role ?? null,
    })),
  })
}

export async function POST(request: NextRequest) {
  const gate = await requireUserManager(request)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  let body: { id?: unknown; action?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  const { id, action, password } = body
  if (typeof id !== 'string' || (action !== 'set' && action !== 'dismiss')) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { data: req } = await supabaseAdmin
    .from('password_reset_requests')
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!req || req.status !== 'pending') {
    return NextResponse.json({ error: 'This request was already handled' }, { status: 409 })
  }

  if (action === 'set') {
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    const { data: target } = await supabaseAdmin.from('profiles').select('role').eq('id', req.user_id).maybeSingle()
    if (!gate.isAdmin && target?.role === 'admin') {
      return NextResponse.json({ error: "Only an admin can set an admin's password" }, { status: 403 })
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user_id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Close this request (and any duplicates for the same user)
  const { error: closeError } = await supabaseAdmin
    .from('password_reset_requests')
    .update({
      status: action === 'set' ? 'done' : 'dismissed',
      resolved_at: new Date().toISOString(),
      resolved_by: gate.userId,
    })
    .eq('user_id', req.user_id)
    .eq('status', 'pending')
  if (closeError) console.error('admin/password-requests: close failed', closeError.message)

  return NextResponse.json({ success: true })
}
