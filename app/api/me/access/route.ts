import { NextResponse, type NextRequest } from 'next/server'
import { getCallerAccess, supabaseAdmin } from '@/lib/serverAccess'

// The signed-in user's role and allowed modules, for the sidebar and page guards.
export async function GET(request: NextRequest) {
  const access = await getCallerAccess(request)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', access.userId)
    .single()
  return NextResponse.json({
    role: access.role,
    modules: access.modules,
    fullName: profile?.full_name ?? null,
    email: profile?.email ?? null,
  })
}
