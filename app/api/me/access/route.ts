import { NextResponse, type NextRequest } from 'next/server'
import { getCallerAccess } from '@/lib/serverAccess'

// The signed-in user's role and allowed modules, for the sidebar and page guards.
export async function GET(request: NextRequest) {
  const access = await getCallerAccess(request)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json({ role: access.role, modules: access.modules })
}
