// lib/drfone.ts
//
// Pure helpers for turning Dr.Fone test records into device_master rows.
// No network or database code lives here, so it is easy to test.

// Dr.Fone field name (lower-case) -> device_master column
export const FIELD_MAP: Record<string, string> = {
  imei: 'imei',
  imei2: 'imei2',
  modelno: 'model_no',
  modelname: 'model',
  color: 'color',
  memory: 'gb',
  carrier: 'carrier',
  serial: 'serial',
  firmware: 'firmware',
  version: 'version',
  os: 'os',
  fail: 'fail',
  pass: 'pass',
  wipe: 'wipe',
  fmi: 'fmi',
  jailbreak: 'jailbreak',
  regioncode: 'region_code',
  batteryserial: 'battery_serial',
  batteryhealth: 'battery_health',
  designcapacity: 'design_capacity',
  currentcapacity: 'current_capacity',
  cyclecount: 'cycle_count',
  mdmlock: 'mdm_lock', // not in the sample response; used only if Dr.Fone adds it
  grade: 'grade',
  testername: 'tester_name',
  time: 'test_time',
  simlock: 'sim_lock',
}

export const COLUMNS = Array.from(new Set(Object.values(FIELD_MAP)))

// Columns kept from the existing row when the new test leaves them empty.
// mdm_lock is not sent by Dr.Fone at all; grade is usually blank in their data.
// Everything else is taken from the newest test exactly as sent, so a phone that
// failed once and passes on the retest does not keep a stale "fail".
export const PRESERVE_IF_EMPTY = ['mdm_lock', 'grade']

const MAX_VALUE_LENGTH = 500

export type DeviceRow = Record<string, string | null>

export function normalizeRecord(raw: unknown): { row?: DeviceRow; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Record is not an object' }
  }

  // Dr.Fone's field names are not consistently cased, so compare in lower case.
  const lower = new Map<string, unknown>()
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.toLowerCase()
    if (!lower.has(k) || (lower.get(k) === '' && value !== '')) lower.set(k, value)
  }

  const row: DeviceRow = {}
  for (const col of COLUMNS) row[col] = null

  for (const [source, column] of Object.entries(FIELD_MAP)) {
    const value = lower.get(source)
    if (value === undefined || value === null) continue
    if (typeof value === 'object') continue
    const text = String(value).trim().slice(0, MAX_VALUE_LENGTH)
    if (text !== '') row[column] = text
  }

  if (!row.imei || !/^\d{15}$/.test(row.imei)) {
    return { error: 'Missing or invalid IMEI (must be 15 digits)' }
  }
  return { row }
}

export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

// One request can carry the same IMEI more than once (retests). Keep the newest.
export function newestPerImei(rows: DeviceRow[]): DeviceRow[] {
  const byImei = new Map<string, DeviceRow>()
  for (const row of rows) {
    const imei = row.imei as string
    const current = byImei.get(imei)
    if (!current) {
      byImei.set(imei, row)
      continue
    }
    const a = parseTime(row.test_time)
    const b = parseTime(current.test_time)
    // Later position wins on a tie or when times can't be compared
    if (a === null || b === null || a >= b) byImei.set(imei, row)
  }
  return Array.from(byImei.values())
}

// Decide what to do with an incoming test given what is already stored.
export function decide(
  incoming: DeviceRow,
  existing: Record<string, any> | undefined
): { action: 'insert' | 'update' | 'skip_older'; row?: DeviceRow } {
  if (!existing) return { action: 'insert', row: incoming }

  const incomingTime = parseTime(incoming.test_time)
  const existingTime = parseTime(existing.test_time)
  if (incomingTime !== null && existingTime !== null && incomingTime < existingTime) {
    return { action: 'skip_older' }
  }

  const merged: DeviceRow = { ...incoming }
  for (const col of PRESERVE_IF_EMPTY) {
    if (merged[col] === null && existing[col] !== null && existing[col] !== undefined && existing[col] !== '') {
      merged[col] = existing[col]
    }
  }
  return { action: 'update', row: merged }
}