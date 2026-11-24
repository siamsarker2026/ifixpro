import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'node:crypto'
import { decide, newestPerImei, normalizeRecord, type DeviceRow } from '@/lib/drfone'

// Dr.Fone -> this endpoint -> Master database (device_master)
//
// Dr.Fone sends each completed test as a POST with the secret key in the
// "x-api-key" header (or "Authorization: Bearer <key>"). The body is JSON in the
// same shape as their GetTesterData reply: { "Data": [ {...}, {...} ] }.
// A bare array, or a single record, is accepted too.
//
// Safe to call twice with the same data. Dry run: add ?dry_run=1 to see what
// WOULD change without writing anything.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BODY_BYTES = 5 * 1024 * 1024
const MAX_RECORDS = 1000
const UPSERT_BATCH = 500
const LOOKUP_BATCH = 200
const MIN_KEY_LENGTH = 32

function sha256(value: string) {
  return createHash('sha256').update(value).digest()
}

function checkKey(request: Request): 'ok' | 'not_configured' | 'denied' {
  const expected = process.env.DRFONE_PUSH_KEY || ''
  // Fail closed: with no (or a weak) key configured, every request is refused.
  if (expected.length < MIN_KEY_LENGTH) return 'not_configured'

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const provided = request.headers.get('x-api-key') || bearer || ''
  // Compare hashes so the check takes the same time whatever is sent.
  return timingSafeEqual(sha256(provided), sha256(expected)) ? 'ok' : 'denied'
}

function denyResponse(state: 'not_configured' | 'denied') {
  if (state === 'not_configured') {
    return NextResponse.json({ success: false, error: 'Endpoint is not enabled' }, { status: 503 })
  }
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_MASTER_SUPABASE_URL!,
    process.env.MASTER_SUPABASE_SERVICE_ROLE_KEY!
  )
}

type LogEntry = {
  status: number
  dry_run?: boolean
  received?: number
  inserted?: number
  updated?: number
  skipped_older?: number
  rejected?: number
  imeis?: string[]
  error?: string
}

// One row per push in drfone_push_log, for the Dr.Fone Pushes page. A failure
// here (e.g. the table not created yet) never fails the push itself.
async function logPush(request: Request, entry: LogEntry) {
  try {
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
    const { error } = await adminClient().from('drfone_push_log').insert({ ...entry, source_ip: ip })
    if (error) console.error('drfone push: log failed', error.message)
  } catch (err: any) {
    console.error('drfone push: log failed', err?.message)
  }
}

// Answer and record the call in one step.
async function reply(request: Request, body: any, status: number, extra: Partial<LogEntry> = {}) {
  await logPush(request, {
    status,
    error: status >= 400 ? String(body?.error || '') : undefined,
    ...extra,
  })
  return NextResponse.json(body, { status })
}

// Lets Dr.Fone (or you) check that the address and key work, without sending data.
export async function GET(request: Request) {
  const state = checkKey(request)
  if (state !== 'ok') return denyResponse(state)
  return NextResponse.json({ success: true, message: 'Dr.Fone push endpoint is ready' })
}

export async function POST(request: Request) {
  const state = checkKey(request)
  if (state !== 'ok') {
    // Record refused calls too (no body is read), so wrong-key attempts show up
    await logPush(request, { status: state === 'denied' ? 401 : 503, error: state === 'denied' ? 'Unauthorized' : 'Endpoint is not enabled' })
    return denyResponse(state)
  }

  try {
    const declared = Number(request.headers.get('content-length') || 0)
    if (declared > MAX_BODY_BYTES) {
      return reply(request, { success: false, error: 'Request too large' }, 413)
    }
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) {
      return reply(request, { success: false, error: 'Request too large' }, 413)
    }

    let body: any
    try {
      body = JSON.parse(text)
    } catch {
      return reply(request, { success: false, error: 'Body must be JSON' }, 400)
    }

    let records: unknown[] | null = null
    if (Array.isArray(body)) records = body
    else if (body && Array.isArray(body.Data)) records = body.Data
    else if (body && typeof body === 'object' && ('Imei' in body || 'imei' in body)) records = [body]

    if (!records) {
      return reply(request, { success: false, error: 'Expected { "Data": [ ... ] }, an array, or a single record' }, 400)
    }
    if (records.length > MAX_RECORDS) {
      return reply(request, { success: false, error: `Max ${MAX_RECORDS} records per request - send in smaller batches` }, 400, { received: records ? records.length : 0 })
    }

    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1'

    // 1) Convert + validate
    const valid: DeviceRow[] = []
    const rejected: { index: number; reason: string }[] = []
    records.forEach((raw, index) => {
      const { row, error } = normalizeRecord(raw)
      if (row) valid.push(row)
      else rejected.push({ index, reason: error || 'Invalid record' })
    })

    // 2) Same IMEI twice in one request -> keep the newest test
    const candidates = newestPerImei(valid)

    // 3) Look up what is already stored for these IMEIs
    const db = adminClient()
    const existingByImei = new Map<string, Record<string, any>>()
    for (let i = 0; i < candidates.length; i += LOOKUP_BATCH) {
      const chunk = candidates.slice(i, i + LOOKUP_BATCH).map(r => r.imei as string)
      const { data, error } = await db.from('device_master').select('*').in('imei', chunk)
      if (error) {
        console.error('drfone push: lookup failed', error.message)
        return reply(request, { success: false, error: 'Database error' }, 500)
      }
      ;(data || []).forEach((r: any) => existingByImei.set(r.imei, r))
    }

    // 4) Decide per device
    const toWrite: DeviceRow[] = []
    let inserted = 0
    let updated = 0
    let skippedOlder = 0
    const now = new Date().toISOString()
    for (const candidate of candidates) {
      const result = decide(candidate, existingByImei.get(candidate.imei as string))
      if (result.action === 'skip_older') {
        skippedOlder++
        continue
      }
      if (result.action === 'insert') inserted++
      else updated++
      toWrite.push({ ...(result.row as DeviceRow), updated_at: now })
    }

    const summary = {
      success: true,
      dry_run: dryRun,
      received: records.length,
      rejected_count: rejected.length,
      rejected: rejected.slice(0, 20),
      duplicates_in_request: valid.length - candidates.length,
      inserted,
      updated,
      skipped_older: skippedOlder,
    }

    const counts = {
      dry_run: dryRun,
      received: records.length,
      inserted,
      updated,
      skipped_older: skippedOlder,
      rejected: rejected.length,
    }

    if (dryRun || toWrite.length === 0) {
      return reply(request, summary, 200, counts)
    }

    // 5) Save (idempotent: same data twice gives the same result)
    for (let i = 0; i < toWrite.length; i += UPSERT_BATCH) {
      const batch = toWrite.slice(i, i + UPSERT_BATCH)
      const { error } = await db.from('device_master').upsert(batch, { onConflict: 'imei' })
      if (error) {
        console.error('drfone push: save failed', error.message)
        // 500 so Dr.Fone retries; nothing here is half-applied that a retry can't repair
        return reply(request, { success: false, error: 'Database error' }, 500, counts)
      }
    }

    // Counts only - never log the key or device data
    console.log(`drfone push: received=${records.length} inserted=${inserted} updated=${updated} skipped_older=${skippedOlder} rejected=${rejected.length}`)
    return reply(request, summary, 200, { ...counts, imeis: toWrite.map(r => r.imei as string) })
  } catch (err: any) {
    console.error('drfone push: unexpected error', err?.message)
    return reply(request, { success: false, error: 'Server error' }, 500)
  }
}