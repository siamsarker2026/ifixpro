import { NextResponse, type NextRequest } from 'next/server'
import { getCallerAccess, supabaseAdmin } from '@/lib/serverAccess'

// A user asks the admin to set a new password for them. Used by "Forgot
// password?" on the login page (no session) and by My Account (signed in).
//
// The reply is the same whether or not the email has an account, so this can't
// be used to find out which emails are registered. Unknown emails are ignored,
// and a second request while one is pending doesn't add another row.

const GENERIC_OK = {
  success: true,
  message: 'Your request has been sent to the administrator. They will set a new password and let you know.',
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : ''

  // Signed in: the request is always for the caller's own account
  let userId: string | null = null
  let email = ''
  const access = await getCallerAccess(request)
  if (access.ok) {
    userId = access.userId
    const { data } = await supabaseAdmin.auth.admin.getUserById(access.userId)
    email = (data.user?.email || '').toLowerCase()
  } else {
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
    }
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    if (!profile) return NextResponse.json(GENERIC_OK)
    userId = profile.id
  }

  if (!userId || !email) return NextResponse.json(GENERIC_OK)

  const { data: pending, error: lookupError } = await supabaseAdmin
    .from('password_reset_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .limit(1)
  if (lookupError) {
    console.error('password-requests: lookup failed', lookupError.message)
    return NextResponse.json({ error: 'Could not send the request. Please try again later.' }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    const { error } = await supabaseAdmin
      .from('password_reset_requests')
      .insert({ user_id: userId, email, note: note || null })
    if (error) {
      console.error('password-requests: insert failed', error.message)
      return NextResponse.json({ error: 'Could not send the request. Please try again later.' }, { status: 500 })
    }
  }

  return NextResponse.json(GENERIC_OK)
}

// Signed-in users: is there already a pending request for me?
export async function GET(request: NextRequest) {
  const access = await getCallerAccess(request)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data } = await supabaseAdmin
    .from('password_reset_requests')
    .select('created_at')
    .eq('user_id', access.userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
  return NextResponse.json({ pendingSince: data?.[0]?.created_at ?? null })
}
