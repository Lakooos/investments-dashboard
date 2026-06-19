// Renderer-side SnapTrade helper. Calls the dev server's /api/snaptrade/* routes
// (see vite-plugin-snaptrade.js) and maps live brokerage positions into the SAME
// holding shape the rest of the app uses, so the allocation pie, recommendations
// and P&L math work unchanged.
//
// The backend only exists under `npm run dev` / `vite preview`. On a static host
// (GitHub Pages) the routes 404, so isAvailable() resolves false and the app keeps
// its CSV/screenshot behaviour.
import { mapPositionsToHoldings } from './mapPositions.js'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const API = '/api/snaptrade/'

// Unwrap the { ok, data, error } envelope the API returns.
async function call(route, method = 'GET', body) {
  const res = await fetch(API + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status === 404) throw new Error('SnapTrade backend not running (start it with `npm run dev`)')
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error('SnapTrade backend returned an unexpected response')
  }
  if (!json || !json.ok) throw new Error((json && json.error) || 'SnapTrade request failed')
  return json.data
}

// True only when the dev backend answers — i.e. we're running under `npm run dev`.
export async function isAvailable() {
  try {
    await call('state')
    return true
  } catch {
    return false
  }
}

export const getState = () => call('state')
export const saveKeys = (keys) => call('keys', 'POST', keys)
export const register = () => call('register', 'POST', {})
export const listAccounts = () => call('accounts')
export const setAccount = (acct) => call('account', 'POST', acct)
export const reset = () => call('reset', 'POST', {})

// Get the Wealthsimple connection portal URL and open it in a new browser tab.
export async function connect() {
  const url = await call('connect', 'POST', {})
  if (url) window.open(url, '_blank', 'noopener')
  return url
}

// Fetch live data and return it in the app's vocabulary.
// { holdings, cash, fx, asOf, accountName }
export async function getLivePortfolio() {
  const data = await call('portfolio')
  const fx = Number(data.fx) || 1.4
  const holdings = mapPositionsToHoldings(data.positions, fx)
  return {
    holdings,
    cash: round2(data.cash),
    fx,
    asOf: (data.asOf || new Date().toISOString()).slice(0, 10),
    accountName: data.accountName || null,
  }
}
