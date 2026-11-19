import { NextResponse, type NextRequest } from 'next/server'
import { getCallerAccess, supabaseAdmin } from '@/lib/serverAccess'

// Lets any signed-in user change their own display name. Nothing else on the
// profile (role, active flag) can be changed here.
export async function PATCH(request: NextRequest) {
  const access = await getCallerAccess(request)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { fullName?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
  if (fullName.length < 1 || fullName.length > 80) {
    return NextResponse.json({ error: 'Name must be 1 to 80 characters' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('profiles').update({ full_name: fullName }).eq('id', access.userId)
  if (error) {
    console.error('me/profile: update failed', error.message)
    return NextResponse.json({ error: 'Could not save your name' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
