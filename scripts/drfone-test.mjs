// Dr.Fone connection test - READ ONLY. Writes nothing to any database.
//
// Run from your project folder:
//   node --env-file=.env.local scripts/drfone-test.mjs "TesterName"
//
// Needs two lines in .env.local (values never go in chat or in code):
//   DRFONE_ENDPOINT=http://their-server-address        (no trailing /GetTesterData)
//   DRFONE_USERID=your-user-id
//
// It prints counts, field names and a masked summary only - never full IMEIs
// and never the USERID.

const endpoint = (process.env.DRFONE_ENDPOINT || '').trim().replace(/\/+$/, '')
const userId = (process.env.DRFONE_USERID || '').trim()
const tester = (process.argv[2] || '').trim()

function fail(msg) {
  console.error('\n✗ ' + msg + '\n')
  process.exit(1)
}

if (!endpoint) fail('DRFONE_ENDPOINT is missing from .env.local')
if (!userId) fail('DRFONE_USERID is missing from .env.local')
if (!tester) fail('Give the tester name, e.g.  node --env-file=.env.local scripts/drfone-test.mjs "TesterName"')

const mask = (v) => {
  const s = String(v ?? '').trim()
  return s.length > 4 ? '*'.repeat(s.length - 4) + s.slice(-4) : s
}

console.log(`Connecting to ${endpoint.replace(/^(https?:\/\/[^/]+).*$/, '$1')}/GetTesterData`)
if (endpoint.startsWith('http://')) {
  console.log('⚠ This address is plain http:// - your USERID travels unencrypted. Ask Dr.Fone for an https:// address.')
}

const started = Date.now()
let res
try {
  res = await fetch(`${endpoint}/GetTesterData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ USERID: userId, TesterName: tester }),
    signal: AbortSignal.timeout(120000),
  })
} catch (e) {
  fail(`Could not reach the server: ${e.cause?.code || e.message}`)
}

const ms = Date.now() - started
const text = await res.text()
console.log(`HTTP ${res.status} in ${ms} ms, ${(text.length / 1024).toFixed(1)} KB`)

let json
try {
  json = JSON.parse(text)
} catch {
  console.log('Response is not JSON. First 300 characters:')
  console.log(text.slice(0, 300).replace(userId, '[USERID]'))
  fail('Unexpected response format')
}

if (!res.ok) fail('The server answered with an error status (see above).')

const rows = Array.isArray(json.Data) ? json.Data : []
console.log(`\nTotal reported by server: ${json.Total}`)
console.log(`Records in Data:          ${rows.length}`)
if (json.Total != null && Number(json.Total) !== rows.length) {
  console.log('⚠ Total and Data length differ - the response may be cut off or paged.')
}

if (rows.length === 0) {
  console.log('\nNo devices returned. Check the tester name spelling, or whether this tester has tests.')
  process.exit(0)
}

const keys = Object.keys(rows[0])
console.log(`\nFields in each record (${keys.length}):\n  ${keys.join(', ')}`)

// Retests: same IMEI appearing more than once
const byImei = new Map()
let badImei = 0
for (const r of rows) {
  const imei = String(r.Imei ?? '').trim()
  if (!/^\d{15}$/.test(imei)) { badImei++; continue }
  byImei.set(imei, (byImei.get(imei) || 0) + 1)
}
const repeated = [...byImei.values()].filter((n) => n > 1).length
console.log(`\nDistinct valid 15-digit IMEIs: ${byImei.size}`)
console.log(`IMEIs tested more than once:   ${repeated}`)
console.log(`Records without a valid IMEI:  ${badImei}`)

const times = rows.map((r) => r.Time).filter(Boolean).sort()
if (times.length) console.log(`Test time range: ${times[0]}  ->  ${times[times.length - 1]}`)

const count = (f) => rows.filter((r) => String(r[f] ?? '').trim() !== '').length
console.log('\nHow many records have a value in:')
for (const f of ['Fail', 'Pass', 'Grade', 'IsLatest', 'Status', 'ESN', 'ESNR', 'Extras', 'Comments']) {
  if (f in rows[0]) console.log(`  ${f.padEnd(10)} ${count(f)}`)
}
const testers = new Set(rows.map((r) => r.TesterName))
console.log(`Distinct TesterName values: ${testers.size}`)

const pick = ['ModelName', 'Memory', 'Color', 'Time', 'Fail', 'Pass', 'Grade', 'IsLatest', 'Count', 'Batteryhealth', 'Cyclecount', 'SimLock']
console.log('\nFirst record (masked, safe fields only):')
console.log('  Imei: ' + mask(rows[0].Imei))
for (const f of pick) if (f in rows[0]) console.log(`  ${f}: ${JSON.stringify(rows[0][f])}`)

// Show one record with a non-empty Fail, so we can see how failures look
const failed = rows.find((r) => String(r.Fail ?? '').trim() !== '')
if (failed) {
  console.log('\nA record with a Fail value (masked):')
  console.log('  Imei: ' + mask(failed.Imei))
  console.log('  ModelName: ' + JSON.stringify(failed.ModelName))
  console.log('  Fail: ' + JSON.stringify(String(failed.Fail).slice(0, 300)))
  console.log('  Pass: ' + JSON.stringify(failed.Pass))
}
console.log('\n✓ Connection works. Nothing was saved anywhere.')