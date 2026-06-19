// Quick "are my SnapTrade keys valid?" check — no Wealthsimple needed.
// Run:  node server/check-keys.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'
const f = path.join(os.homedir(), '.invdash-snaptrade.json')
let c; try { c = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { console.log('No keys saved yet. Enter them in the app first.'); process.exit(1) }
const mask = (s) => (s ? `${s.slice(0,6)}…${s.slice(-4)} (len ${s.length})` : '(empty)')
console.log('clientId   :', mask(c.clientId))
console.log('consumerKey:', mask(c.consumerKey))
const { Snaptrade } = await import('snaptrade-typescript-sdk')
const sdk = new Snaptrade({ clientId: c.clientId, consumerKey: c.consumerKey })
try { await sdk.referenceData.getPartnerInfo(); console.log('\n✅ KEYS ARE VALID — you can connect Wealthsimple now.') }
catch (e) { console.log('\n❌ Rejected:', (()=>{try{return JSON.parse(e.responseBody).detail}catch{return e.responseBody||e.message}})()) }
