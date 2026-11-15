// Dr.Fone push endpoint check - pretends to be Dr.Fone so YOU can verify the
// live endpoint before sharing the address and key.
//
//   node --env-file=.env.local scripts/drfone-push-test.mjs https://your-site/api/drfone/push
//   node --env-file=.env.local scripts/drfone-push-test.mjs https://your-site/api/drfone/push --write
//
// Needs DRFONE_PUSH_KEY in .env.local (the same key as in Vercel). The key is
// never printed.
//
// Without --write NOTHING is saved (dry runs only).
// With --write it saves ONE fake test device (IMEI 999999999999999) so you can
// see a real row arrive. Delete it afterwards with the SQL printed at the end.

const url = (process.argv[2] || '').trim()
const doWrite = process.argv.includes('--write')
const key = (process.env.DRFONE_PUSH_KEY || '').trim()

if (!url.startsWith('http')) {
  console.error('\n✗ Give the full endpoint address, e.g.  node --env-file=.env.local scripts/drfone-push-test.mjs https://your-site/api/drfone/push\n')
  process.exit(1)
}
if (!key) {
  console.error('\n✗ DRFONE_PUSH_KEY is missing from .env.local\n')
  process.exit(1)
}
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)/.test(url)
if (!url.startsWith('https://') && !isLocal) {
  console.log('⚠ This address is not https:// - Dr.Fone must be given an https:// address.\n')
}

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${detail}`}`)
}

async function call(method, { body, headers = {}, query = '', withKey = true, rawBody } = {}) {
  const h = { ...headers }
  if (withKey) h['x-api-key'] = key
  if (body !== undefined || rawBody !== undefined) h['Content-Type'] = 'application/json'
  const started = Date.now()
  try {
    const res = await fetch(url + query, {
      method,
      headers: h,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { status: res.status, json, text, ms: Date.now() - started, type: res.headers.get('content-type') || '' }
  } catch (e) {
    return { status: 0, json: null, text: String(e.cause?.code || e.message), ms: Date.now() - started, type: '' }
  }
}

// A record shaped like Dr.Fone's GetTesterData reply (note the trailing spaces)
const sample = (over = {}) => ({
  UserID: '', Udid: '', ModelNo: 'MWM02B/A', ModelName: 'iPhone 11', Color: 'BLACK', Memory: '128GB',
  Carrier: 'Unlocked', Serial: 'TESTSERIAL001', Imei: '999999999999999 ', Imei2: '999999999999998 ',
  Firmware: '17.4.1', Version: '5.00.00', Os: 'iOS', Fail: '', Pass: '', Wipe: 'NO', Fmi: 'Off',
  Jailbreak: 'NA', Regioncode: 'UK and Ireland', Batteryserial: 'TESTBATT', Batteryhealth: '86',
  Designcapacity: '3092', Currentcapacity: '2374', Cyclecount: '926', Grade: '',
  TesterName: 'TEST', Time: '2024-05-01T19:22:13Z', SimLock: 'Unlocked', OEMData: 'AAAA', ...over,
})

console.log(`Testing ${url.replace(/^(https?:\/\/[^/]+).*$/, '$1')} ${doWrite ? '(WRITE mode: saves one fake device)' : '(safe mode: nothing is saved)'}\n`)

// --- 1. Reachability and key handling
let r = await call('GET', { withKey: false })
if (r.status === 0) {
  console.log(`✗ Could not reach the server (${r.text}). Check the address.`)
  process.exit(1)
}
if (r.status === 503) {
  console.log('✗ The endpoint says it is not enabled: DRFONE_PUSH_KEY is missing or shorter than 32 characters in Vercel. Add it, then redeploy.')
  process.exit(1)
}
check('Reachable, and answers in JSON (not a login or error page)', !!r.json, `HTTP ${r.status}, content-type "${r.type}". If this is a Vercel login page, use the production address.`)
check('No key  -> refused (401)', r.status === 401, `got HTTP ${r.status} ${JSON.stringify(r.json)}`)

r = await call('GET', { headers: { 'x-api-key': 'wrong-' + 'x'.repeat(40) }, withKey: false })
check('Wrong key -> refused (401)', r.status === 401, `got HTTP ${r.status}`)

r = await call('GET')
if (r.status === 503) {
  console.log('✗ The endpoint says it is not enabled: DRFONE_PUSH_KEY is missing or shorter than 32 characters in Vercel. Add it and redeploy.')
  process.exit(1)
}
check('Right key -> ready (200)', r.status === 200 && r.json?.success === true, `got HTTP ${r.status} ${r.text.slice(0, 200)}. If 401, the key in Vercel differs from your .env.local, or you have not redeployed.`)
if (r.status !== 200) {
  console.log('\nStopping: fix the key first, then run this again.')
  process.exit(1)
}

// --- 2. Bad requests are rejected safely
r = await call('POST', { rawBody: 'this is not json' })
check('Non-JSON body -> 400', r.status === 400, `got HTTP ${r.status}`)

r = await call('POST', { body: { hello: 'world' } })
check('Wrong shape -> 400', r.status === 400, `got HTTP ${r.status}`)

// --- 3. Dry runs (nothing saved)
r = await call('POST', { body: { Data: [sample()], Total: 1 }, query: '?dry_run=1' })
check('Dr.Fone-style record, dry run -> accepted', r.status === 200 && r.json?.dry_run === true && (r.json.inserted + r.json.updated) === 1 && r.json.rejected_count === 0, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

r = await call('POST', { body: { Data: [sample({ Imei: '12345' }), sample()] }, query: '?dry_run=1' })
check('Invalid IMEI is rejected, valid one still accepted', r.status === 200 && r.json?.rejected_count === 1 && (r.json.inserted + r.json.updated) === 1, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

r = await call('POST', { body: { Data: [sample(), sample({ Time: '2024-06-01T00:00:00Z', ModelName: 'iPhone 11 NEWER' })] }, query: '?dry_run=1' })
check('Same IMEI twice in one request -> newest kept', r.status === 200 && r.json?.duplicates_in_request === 1, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

check('Response time is reasonable (under 10 s)', r.ms < 10000, `took ${r.ms} ms`)

// --- 4. Optional real write
if (doWrite) {
  console.log('\nWRITE tests (one fake device, IMEI 999999999999999):')
  r = await call('POST', { body: { Data: [sample({ ModelName: 'TEST - DELETE ME' })] } })
  check('Save the fake device', r.status === 200 && r.json?.success && (r.json.inserted + r.json.updated) === 1, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

  r = await call('POST', { body: { Data: [sample({ ModelName: 'TEST - DELETE ME' })] } })
  check('Send it again -> harmless (no duplicate row)', r.status === 200 && r.json?.updated === 1 && r.json?.inserted === 0, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

  r = await call('POST', { body: { Data: [sample({ ModelName: 'TEST OLDER', Time: '2020-01-01T00:00:00Z' })] } })
  check('An OLDER test does not replace the newer one', r.status === 200 && r.json?.skipped_older === 1, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

  r = await call('POST', { body: { Data: [sample({ ModelName: 'TEST - DELETE ME', Time: '2024-07-01T00:00:00Z', Fail: 'Camera: FAIL' })] } })
  check('A NEWER failing test replaces it', r.status === 200 && r.json?.updated === 1, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

  r = await call('POST', { body: { Data: [sample({ ModelName: 'TEST - DELETE ME', Time: '2024-08-01T00:00:00Z', Fail: '' })] } })
  check('A NEWER passing retest clears the fail', r.status === 200 && r.json?.updated === 1, `got HTTP ${r.status} ${r.text.slice(0, 300)}`)

  console.log(`
Now open your Master Supabase project -> Table Editor -> device_master and look for IMEI 999999999999999.
It should show model "TEST - DELETE ME", fail empty, test_time 2024-08-01...
Then DELETE the test row in the Master project's SQL Editor:

    delete from device_master where imei = '999999999999999';
`)
}

console.log(`\n${passed} passed, ${failed} failed.`)
if (failed === 0) console.log(doWrite ? '✓ The endpoint works end to end.' : '✓ Looks good. Run again with --write to also test saving.')
process.exit(failed ? 1 : 0)