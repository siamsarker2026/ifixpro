import { NextResponse, type NextRequest } from 'next/server'
import { getCallerAccess, supabaseAdmin } from '@/lib/serverAccess'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Display names for user ids (e.g. "entered by" on records). Any signed-in,
// active user may call it; it returns only names, nothing else.
// GET /api/user-names?ids=<uuid>,<uuid>
export async function GET(request: NextRequest) {
  const access = await getCallerAccess(request)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const ids = Array.from(new Set(
    (request.nextUrl.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => UUID.test(s))
  )).slice(0, 500)
  if (ids.length === 0) return NextResponse.json({ names: {} })

  const { data, error } = await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const names: Record<string, string> = {}
  for (const p of data || []) names[p.id] = p.full_name || (p.email ? String(p.email).split('@')[0] : 'Unknown')
  return NextResponse.json({ names })
}
