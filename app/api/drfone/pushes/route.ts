import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCallerAccess } from '@/lib/serverAccess'
import { canAccessModule } from '@/lib/modules'

// GET /api/drfone/pushes?date=YYYY-MM-DD
// For the Dr.Fone Pushes page: daily counts, the push log for one day, and the
// devices those pushes wrote. Days are Dubai days (UTC+4, no daylight saving).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TZ = '+04:00'
const DAY_MS = 86_400_000

function master() {
  return createClient(
    process.env.NEXT_PUBLIC_MASTER_SUPABASE_URL!,
    process.env.MASTER_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Today's date in Dubai as YYYY-MM-DD
function dubaiToday() {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10)
}
const dayStart = (d: string) => new Date(`${d}T00:00:00${TZ}`)

type Log = {
  id: number; created_at: string; status: number; dry_run: boolean; received: number
  inserted: number; updated: number; skipped_older: number; rejected: number
  imeis: string[]; error: string | null; source_ip: string | null
}

function summarise(logs: Log[]) {
  const devices = new Set<string>()
  let calls = 0, failed = 0, inserted = 0, updated = 0
  for (const l of logs) {
    calls++
    if (l.status >= 400) failed++
    if (l.status === 200 && !l.dry_run) {
      inserted += l.inserted; updated += l.updated
      l.imeis.forEach(i => devices.add(i))
    }
  }
  return { devices: devices.size, calls, failed, inserted, updated }
}

export async function GET(request: NextRequest) {
  const access = await getCallerAccess(request)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!canAccessModule(access.modules, 'stock-master')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = dubaiToday()
  const asked = new URL(request.url).searchParams.get('date') || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked) || isNaN(dayStart(asked).getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const db = master()
  const todayStart = dayStart(today).getTime()
  const weekFrom = new Date(todayStart - 6 * DAY_MS).toISOString()
  const from = dayStart(asked)
  const to = new Date(from.getTime() + DAY_MS)

  const [week, day, last] = await Promise.all([
    db.from('drfone_push_log').select('*').gte('created_at', weekFrom).order('created_at', { ascending: false }).limit(5000),
    db.from('drfone_push_log').select('*').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('created_at', { ascending: false }).limit(1000),
    db.from('drfone_push_log').select('created_at').eq('status', 200).eq('dry_run', false).order('created_at', { ascending: false }).limit(1),
  ])

  if (week.error || day.error) {
    const msg = (week.error || day.error)!.message
    // Table not created yet: tell the page so it can show the setup step
    if (/drfone_push_log/.test(msg)) return NextResponse.json({ setupNeeded: true })
    console.error('drfone pushes: read failed', msg)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const weekLogs = (week.data || []) as Log[]
  const dayLogs = (day.data || []) as Log[]
  const yStart = todayStart - DAY_MS
  const inRange = (l: Log, a: number, b: number) => {
    const t = new Date(l.created_at).getTime()
    return t >= a && t < b
  }

  // Devices written on the chosen day, newest push first, each IMEI once
  const imeis: string[] = []
  const pushedAt = new Map<string, string>()
  for (const l of dayLogs) {
    if (l.status !== 200 || l.dry_run) continue
    for (const i of l.imeis) if (!pushedAt.has(i)) { pushedAt.set(i, l.created_at); imeis.push(i) }
  }
  const devices: any[] = []
  for (let i = 0; i < imeis.length; i += 200) {
    const { data } = await db
      .from('device_master')
      .select('imei,model,gb,color,carrier,grade,tester_name,test_time,battery_health,fail,created_at')
      .in('imei', imeis.slice(i, i + 200))
    ;(data || []).forEach(d => devices.push({ ...d, pushed_at: pushedAt.get(d.imei) }))
  }
  devices.sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)))

  return NextResponse.json({
    date: asked,
    today,
    stats: {
      today: summarise(weekLogs.filter(l => inRange(l, todayStart, todayStart + DAY_MS))),
      yesterday: summarise(weekLogs.filter(l => inRange(l, yStart, todayStart))),
      week: summarise(weekLogs),
      day: summarise(dayLogs),
    },
    lastPushAt: last.data?.[0]?.created_at || null,
    logs: dayLogs,
    devices,
  })
}
