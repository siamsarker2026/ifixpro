import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Service role key — server-side only, never sent to the browser. This is
// what's allowed to write to device_master; the anon key (used by
// /api/device and the dashboard) is read-only now that RLS is on.
const masterSupabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_MASTER_SUPABASE_URL!,
  process.env.MASTER_SUPABASE_SERVICE_ROLE_KEY!
)

// Only these columns are ever written — anything else in a request body is
// ignored, same rule as "skip extra Excel columns" on the client side.
const ALLOWED_COLUMNS = new Set([
  'imei', 'model', 'gb', 'color', 'model_no', 'carrier', 'serial', 'imei2',
  'firmware', 'version', 'os', 'fail', 'pass', 'wipe', 'fmi', 'jailbreak',
  'region_code', 'battery_serial', 'battery_health', 'design_capacity',
  'current_capacity', 'cycle_count', 'mdm_lock', 'grade', 'tester_name',
  'test_time', 'sim_lock'
])

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const rows = Array.isArray(body?.rows) ? body.rows : null

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'No rows provided' }, { status: 400 })
    }
    if (rows.length > 1000) {
      return NextResponse.json({ success: false, error: 'Max 1000 rows per request — send in smaller batches' }, { status: 400 })
    }

    // Keyed by imei so a batch can never contain the same IMEI twice —
    // Postgres rejects an upsert where one statement updates the same row
    // more than once. Last occurrence in the batch wins.
    const byImei = new Map<string, Record<string, string>>()
    for (const row of rows) {
      const imei = String(row.imei || '').trim()
      if (!imei) continue // IMEI is mandatory — row is skipped, not errored

      const clean: Record<string, string> = { imei }
      for (const key of Object.keys(row)) {
        if (key === 'imei') continue
        if (!ALLOWED_COLUMNS.has(key)) continue
        const value = row[key]
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          clean[key] = String(value).trim()
        }
      }
      byImei.set(imei, clean)
    }
    const cleanRows = Array.from(byImei.values())

    const skipped = rows.length - cleanRows.length

    if (cleanRows.length === 0) {
      return NextResponse.json({ success: true, upserted: 0, skipped })
    }

    const { error } = await masterSupabaseAdmin
      .from('device_master')
      .upsert(cleanRows, { onConflict: 'imei' })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, upserted: cleanRows.length, skipped })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Server error' }, { status: 500 })
  }
}