// SnapTrade service — runs in the Vite DEV SERVER's Node process (see
// vite-plugin-snaptrade.js), never in the browser. This is the one place that
// holds your API secret and signs requests.
//
// Why a backend at all: the SnapTrade consumerKey signs every request and must
// never ship in browser code or be committed to git, and SnapTrade's API can't be
// called directly from a browser (no CORS + secret exposure). So the React app
// (localhost:5173) calls /api/snaptrade/* and THIS code talks to SnapTrade.
//
// Config (keys + the SnapTrade userSecret + which account to read) is stored in
// your HOME folder (~/.invdash-snaptrade.json), OUTSIDE the project, so secrets
// never touch source control regardless of where you run `npm run dev` from.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const CONFIG_PATH = path.join(os.homedir(), '.invdash-snaptrade.json')

// ---- config persistence ---------------------------------------------------
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
  return cfg
}
function patchConfig(patch) {
  return writeConfig({ ...readConfig(), ...patch })
}

// "Personal" SnapTrade keys (clientId prefixed `PERS-`) are provisioned with their
// own user at signup: you DON'T call registerUser (it 400s, code 1012) and DON'T
// run the brokerage-connect portal. Instead the personal key's request signature
// identifies the user implicitly — you pass empty userId/userSecret on user-scoped
// calls (the SDK still requires the params to be present, hence '' not undefined).
function isPersonalKeys(c = readConfig()) {
  return /^PERS/i.test(c.clientId || '')
}

// The user object to spread into user-scoped SDK calls.
// - personal keys → implicit user (empty strings)
// - partner keys  → the registered { userId, userSecret } (registers once if needed)
async function ensureUser() {
  if (isPersonalKeys()) return { userId: '', userSecret: '' }
  let c = readConfig()
  if (!c.userSecret) {
    await register()
    c = readConfig()
  }
  return { userId: c.userId, userSecret: c.userSecret }
}

// A non-secret summary the UI uses to decide which setup step to show.
export function configState() {
  const c = readConfig()
  const personal = isPersonalKeys(c)
  return {
    hasKeys: !!(c.clientId && c.consumerKey),
    isPersonal: personal,
    registered: personal || !!c.userSecret, // personal keys need no registration
    hasAccount: !!c.accountId,
    accountId: c.accountId || null,
    accountName: c.accountName || null,
  }
}

// ---- SDK loading ----------------------------------------------------------
let _Snaptrade
async function getSnaptradeClass() {
  if (_Snaptrade) return _Snaptrade
  const m = await import('snaptrade-typescript-sdk')
  _Snaptrade = m.Snaptrade || (m.default && m.default.Snaptrade)
  if (!_Snaptrade) throw new Error('Could not load snaptrade-typescript-sdk')
  return _Snaptrade
}

async function client() {
  const c = readConfig()
  if (!c.clientId || !c.consumerKey) throw new Error('SnapTrade API keys not set yet')
  const Snaptrade = await getSnaptradeClass()
  return new Snaptrade({ clientId: c.clientId, consumerKey: c.consumerKey })
}

// Surface the real SnapTrade reason. The SDK throws `SnaptradeError` with the body
// in `e.responseBody` (a JSON string) and the HTTP status in `e.status` — NOT the
// axios `e.response.data` shape — so without this the UI only saw "status code 401".
function niceError(e) {
  let body = e && (e.responseBody != null ? e.responseBody : e.response && e.response.data)
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      /* leave as string */
    }
  }
  const status = (e && (e.status || (e.response && e.response.status))) || ''
  if (body && typeof body === 'object') {
    const msg = body.detail || body.message || JSON.stringify(body)
    return new Error(status ? `${msg} (HTTP ${status}${body.code ? ', code ' + body.code : ''})` : msg)
  }
  if (typeof body === 'string' && body) return new Error(body)
  return e instanceof Error ? e : new Error(String(e))
}

// ---- setup steps ----------------------------------------------------------

// Step 1: save the developer keys (from dashboard.snaptrade.com).
export function saveKeys({ clientId, consumerKey } = {}) {
  if (!clientId || !consumerKey) throw new Error('Both Client ID and Consumer Key are required')
  patchConfig({ clientId: String(clientId).trim(), consumerKey: String(consumerKey).trim() })
  return configState()
}

// Step 2: register a SnapTrade user once (stable userId), store the userSecret.
// No-op for personal keys — they're provisioned with their user automatically.
export async function register() {
  const c = readConfig()
  if (isPersonalKeys(c)) return configState() // personal: user is implicit, never register
  if (c.userSecret) return configState() // already registered
  const userId = c.userId || 'invdash-' + crypto.randomUUID()
  const sdk = await client()
  try {
    const res = await sdk.authentication.registerSnapTradeUser({ userId })
    patchConfig({ userId, userSecret: res.data.userSecret })
  } catch (e) {
    throw niceError(e)
  }
  return configState()
}

// Step 3: get the brokerage connection portal URL (user logs into Wealthsimple there).
// Personal keys can't open a portal here — they connect brokerages on the SnapTrade
// dashboard itself, so the accounts already exist; surface a clear message instead.
export async function connectUrl() {
  if (isPersonalKeys()) {
    throw new Error('Personal keys connect brokerages on the SnapTrade dashboard, not here. Connect Wealthsimple at app.snaptrade.com, then pick your account below.')
  }
  const c = readConfig()
  if (!c.userSecret) throw new Error('Register first')
  const sdk = await client()
  try {
    const res = await sdk.authentication.loginSnapTradeUser({ userId: c.userId, userSecret: c.userSecret })
    return res.data.redirectURI || res.data.redirectUri || res.data
  } catch (e) {
    throw niceError(e)
  }
}

// Step 4: list the connected accounts so the user can pick which one to track.
export async function listAccounts() {
  const sdk = await client()
  try {
    const res = await sdk.accountInformation.listUserAccounts(await ensureUser())
    return (res.data || []).map((a) => ({
      id: a.id,
      name: a.name || a.institution_name || 'Account',
      number: a.number || '',
      type: (a.meta && a.meta.type) || a.raw_type || '',
      currency: (a.meta && a.meta.currency) || (a.balance && a.balance.total && a.balance.total.currency) || '',
      total: a.balance && a.balance.total ? a.balance.total.amount : null,
      status: a.status || (a.meta && a.meta.status) || '',
    }))
  } catch (e) {
    throw niceError(e)
  }
}

export function setAccount({ accountId, accountName } = {}) {
  if (!accountId) throw new Error('No account selected')
  patchConfig({ accountId, accountName: accountName || null })
  return configState()
}

// ---- the live read --------------------------------------------------------

// Defensive readers — the positions payload shape varies slightly by SDK/API
// version (symbol.symbol.* vs instrument.*, average_purchase_price vs cost_basis).
function pickSymbol(p) {
  const s = (p.symbol && p.symbol.symbol) || p.symbol || {}
  const inst = p.instrument || {}
  return {
    symbol: (s.raw_symbol || s.symbol || inst.raw_symbol || inst.symbol || '').toString().toUpperCase(),
    name: s.description || inst.description || '',
    currency:
      (s.currency && s.currency.code) || inst.currency || (p.currency && p.currency.code) || p.currency || 'CAD',
  }
}

async function getCadPerUsd(sdk) {
  try {
    const res = await sdk.referenceData.getCurrencyExchangeRatePair({ currencyPair: 'USD-CAD' })
    const r = Number(res.data && res.data.exchange_rate)
    if (isFinite(r) && r > 0) return r
  } catch {
    /* fall through to default */
  }
  return 1.4
}

// Returns normalized data the renderer maps into the app's holding shape.
export async function getPortfolio() {
  const c = readConfig()
  if (!c.accountId) throw new Error('No account chosen yet')
  const sdk = await client()
  try {
    const user = await ensureUser()
    const [posRes, balRes, fx] = await Promise.all([
      sdk.accountInformation.getUserAccountPositions({ ...user, accountId: c.accountId }),
      sdk.accountInformation.getUserAccountBalance({ ...user, accountId: c.accountId }),
      getCadPerUsd(sdk),
    ])

    const positions = (posRes.data || [])
      .map((p) => {
        const s = pickSymbol(p)
        return {
          symbol: s.symbol,
          name: s.name,
          currency: s.currency,
          units: Number(p.units != null ? p.units : p.fractional_units) || 0,
          price: Number(p.price) || 0,
          costPerShare: Number(p.average_purchase_price != null ? p.average_purchase_price : p.cost_basis) || 0,
        }
      })
      .filter((p) => p.symbol)

    // Cash can be split across currencies; normalize everything to CAD.
    const cash = (balRes.data || []).reduce((sum, b) => {
      const code = (b.currency && b.currency.code) || 'CAD'
      const amt = Number(b.cash) || 0
      return sum + (code === 'USD' ? amt * fx : amt)
    }, 0)

    return {
      positions,
      cash: Math.round(cash * 100) / 100,
      fx: Math.round(fx * 10000) / 10000,
      accountName: c.accountName || null,
      asOf: new Date().toISOString(),
    }
  } catch (e) {
    throw niceError(e)
  }
}

// Wipe SnapTrade config (keys + secret + account) from this device.
export function reset() {
  try {
    fs.unlinkSync(CONFIG_PATH)
  } catch {
    /* already gone */
  }
  return configState()
}
