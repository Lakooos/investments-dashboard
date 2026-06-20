// PARTNER-MODE SnapTrade service — the multi-user, "no keys for users" path.
// Runs only in the Vite dev/preview server (Node). Holds ONE partner key pair for
// the whole app; each end-user gets their own SnapTrade user (auto-registered) whose
// secret is stored in Supabase and NEVER sent to the browser.
//
// Flow per user:
//   1. user logs into YOUR app via Supabase Auth (browser, anon key)
//   2. browser calls /api/partner/* with their Supabase JWT
//   3. here: verify the JWT -> appUserId, ensure a SnapTrade user exists for them
//      (register once, store userSecret in Supabase via the service-role key),
//      then generate the Connection Portal URL / read their data.
//
// Required env (in .env.local, NOT committed):
//   SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY   (partner / Pay-as-you-go keys)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        (service role bypasses RLS)

const env = (k) => process.env[k] || ''
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export function isConfigured() {
  return !!(env('SNAPTRADE_CLIENT_ID') && env('SNAPTRADE_CONSUMER_KEY') && env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY'))
}
function assertConfigured() {
  if (!isConfigured()) {
    throw new Error('Partner mode is not configured. Set SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in app/.env.local — see PARTNER_MODE.md.')
  }
}

// ---- lazy clients ---------------------------------------------------------
let _sdk, _admin
async function sdk() {
  if (_sdk) return _sdk
  const m = await import('snaptrade-typescript-sdk')
  const Snaptrade = m.Snaptrade || (m.default && m.default.Snaptrade)
  _sdk = new Snaptrade({ clientId: env('SNAPTRADE_CLIENT_ID'), consumerKey: env('SNAPTRADE_CONSUMER_KEY') })
  return _sdk
}
async function admin() {
  if (_admin) return _admin
  const { createClient } = await import('@supabase/supabase-js')
  _admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

function niceError(e) {
  let body = e && (e.responseBody != null ? e.responseBody : e.response && e.response.data)
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* keep */ } }
  const status = (e && (e.status || (e.response && e.response.status))) || ''
  if (body && typeof body === 'object') {
    const msg = body.detail || body.message || JSON.stringify(body)
    return new Error(status ? `${msg} (HTTP ${status}${body.code ? ', code ' + body.code : ''})` : msg)
  }
  return e instanceof Error ? e : new Error(String(e))
}

// ---- auth: Supabase JWT -> app user id ------------------------------------
// Verifies the browser's Supabase access token and returns the authenticated user.
export async function verifyUser(jwt) {
  assertConfigured()
  if (!jwt) throw new Error('Not signed in')
  const { data, error } = await (await admin()).auth.getUser(jwt)
  if (error || !data || !data.user) throw new Error('Invalid or expired session')
  return data.user.id
}

// ---- per-user SnapTrade credential (auto-register once) -------------------
async function ensureSnaptradeUser(appUserId) {
  const a = await admin()
  const { data: existing } = await a
    .from('snaptrade_users')
    .select('snaptrade_user_id, snaptrade_user_secret')
    .eq('app_user_id', appUserId)
    .maybeSingle()
  if (existing) return { userId: existing.snaptrade_user_id, userSecret: existing.snaptrade_user_secret }

  const s = await sdk()
  const userId = appUserId // stable, unique per app user
  const registerAndStore = async () => {
    const res = await s.authentication.registerSnapTradeUser({ userId })
    const userSecret = res.data.userSecret
    const { error } = await a
      .from('snaptrade_users')
      .upsert({ app_user_id: appUserId, snaptrade_user_id: userId, snaptrade_user_secret: userSecret, updated_at: new Date().toISOString() })
    if (error) throw new Error('Could not store SnapTrade secret: ' + error.message)
    return { userId, userSecret }
  }
  try {
    return await registerAndStore()
  } catch (e) {
    // 1010 = user already exists on SnapTrade but not in our DB (e.g. row was cleared).
    // We can't recover the old secret, so delete + recreate (mirrors the official CLI).
    const code = (() => { try { return JSON.parse(e.responseBody).code } catch { return null } })()
    if (code === '1010') {
      await s.authentication.deleteSnapTradeUser({ userId })
      return registerAndStore()
    }
    throw niceError(e)
  }
}

// ---- public ops (all keyed by the authenticated app user) -----------------

// The Connection Portal URL — the user logs into Wealthsimple (+2FA) in SnapTrade's
// hosted widget. Deep-linked to Wealthsimple + read-only so it's one tap for them.
export async function connectionPortalUrl(appUserId, { customRedirect } = {}) {
  const { userId, userSecret } = await ensureSnaptradeUser(appUserId)
  const s = await sdk()
  try {
    const res = await s.authentication.loginSnapTradeUser({
      userId,
      userSecret,
      broker: 'WEALTHSIMPLETRADE', // deep-link straight to Wealthsimple (remove to show all brokers)
      connectionType: 'read', // read-only access
      ...(customRedirect ? { customRedirect } : {}),
    })
    return res.data.redirectURI || res.data.redirectUri || res.data
  } catch (e) {
    throw niceError(e)
  }
}

export async function listAccounts(appUserId) {
  const { userId, userSecret } = await ensureSnaptradeUser(appUserId)
  const s = await sdk()
  try {
    const res = await s.accountInformation.listUserAccounts({ userId, userSecret })
    return (res.data || []).map((acc) => ({
      id: acc.id,
      name: acc.name || acc.institution_name || 'Account',
      number: acc.number || '',
      type: (acc.meta && acc.meta.type) || acc.raw_type || '',
      currency: (acc.meta && acc.meta.currency) || (acc.balance && acc.balance.total && acc.balance.total.currency) || '',
      total: acc.balance && acc.balance.total ? acc.balance.total.amount : null,
      status: acc.status || (acc.meta && acc.meta.status) || '',
    }))
  } catch (e) {
    throw niceError(e)
  }
}

function pickSymbol(p) {
  const sym = (p.symbol && p.symbol.symbol) || p.symbol || {}
  const inst = p.instrument || {}
  return {
    symbol: (sym.raw_symbol || sym.symbol || inst.raw_symbol || inst.symbol || '').toString().toUpperCase(),
    name: sym.description || inst.description || '',
    currency: (sym.currency && sym.currency.code) || inst.currency || (p.currency && p.currency.code) || p.currency || 'CAD',
  }
}
async function getCadPerUsd(s) {
  try {
    const res = await s.referenceData.getCurrencyExchangeRatePair({ currencyPair: 'USD-CAD' })
    const r = Number(res.data && res.data.exchange_rate)
    if (isFinite(r) && r > 0) return r
  } catch { /* default */ }
  return 1.4
}

// Pick the account to show by default: the registered account (TFSA/RRSP) with the
// MOST money, so most users land on the one they actually use. Falls back to the
// richest open account, then any account.
const acctTotal = (a) => Number(a.total) || 0
function chooseDefaultAccount(accts) {
  if (!accts || !accts.length) return null
  const open = accts.filter((a) => {
    const st = (a.status || '').toLowerCase()
    return !st || st === 'open'
  })
  const pool = open.length ? open : accts
  const byMoney = (list) => list.slice().sort((x, y) => acctTotal(y) - acctTotal(x))
  const registered = pool.filter((a) => /tfsa|rrsp/i.test(`${a.type || ''} ${a.name || ''}`))
  return registered.length ? byMoney(registered)[0] : byMoney(pool)[0]
}

// Lifetime dividends, interest and fees from the account's transaction history, so
// the dashboard can show a true "total return" like Wealthsimple does. USD amounts
// are converted to CAD at the current rate. Best-effort: any failure → zeros + a flag.
async function getIncomeAndFees(s, userId, userSecret, accountId, fx) {
  try {
    const res = await s.accountInformation.getAccountActivities({
      userId, userSecret, accountId, type: 'DIVIDEND,FEE,INTEREST', limit: 1000,
    })
    const rows = (res && res.data && (Array.isArray(res.data) ? res.data : res.data.data)) || []
    let dividends = 0, fees = 0, interest = 0
    for (const t of rows) {
      const type = (t.type || '').toUpperCase()
      const code = (t.currency && t.currency.code) || 'CAD'
      const cad = (Number(t.amount) || 0) * (code === 'USD' ? fx : 1)
      if (type === 'DIVIDEND') dividends += cad
      else if (type === 'INTEREST') interest += cad
      else if (type === 'FEE') fees += Math.abs(cad)
    }
    return { dividends: round2(dividends), fees: round2(fees), interest: round2(interest) }
  } catch {
    return { dividends: 0, fees: 0, interest: 0, incomeUnavailable: true }
  }
}

// Live positions + cash + FX for one of the user's accounts. With no accountId it
// defaults to the richer of the user's TFSA/RRSP (see chooseDefaultAccount).
export async function getPortfolio(appUserId, accountId) {
  const { userId, userSecret } = await ensureSnaptradeUser(appUserId)
  const s = await sdk()
  try {
    const accts = await listAccounts(appUserId)
    const chosen = accountId ? accts.find((a) => a.id === accountId) : chooseDefaultAccount(accts)
    if (!chosen) {
      return { positions: [], cash: 0, fx: await getCadPerUsd(s), accountId: null, accountName: null, accountType: null, dividends: 0, fees: 0, interest: 0, asOf: new Date().toISOString() }
    }
    accountId = chosen.id
    const [posRes, balRes, fx] = await Promise.all([
      s.accountInformation.getUserAccountPositions({ userId, userSecret, accountId }),
      s.accountInformation.getUserAccountBalance({ userId, userSecret, accountId }),
      getCadPerUsd(s),
    ])
    const positions = (posRes.data || [])
      .map((p) => {
        const sm = pickSymbol(p)
        return {
          symbol: sm.symbol,
          name: sm.name,
          currency: sm.currency,
          units: Number(p.units != null ? p.units : p.fractional_units) || 0,
          price: Number(p.price) || 0,
          costPerShare: Number(p.average_purchase_price != null ? p.average_purchase_price : p.cost_basis) || 0,
        }
      })
      .filter((p) => p.symbol)
    const cash = (balRes.data || []).reduce((sum, b) => {
      const code = (b.currency && b.currency.code) || 'CAD'
      return sum + ((Number(b.cash) || 0) * (code === 'USD' ? fx : 1))
    }, 0)
    const income = await getIncomeAndFees(s, userId, userSecret, accountId, fx)
    return {
      positions,
      cash: Math.round(cash * 100) / 100,
      fx: Math.round(fx * 1e6) / 1e6, // keep full FX precision for the exact USD readout
      accountId,
      accountName: chosen.name || null,
      accountType: chosen.type || null,
      ...income,
      asOf: new Date().toISOString(),
    }
  } catch (e) {
    throw niceError(e)
  }
}
