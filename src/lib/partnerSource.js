// Partner-mode data source (browser side). Calls /api/partner/* with the signed-in
// user's Supabase JWT; the server maps that to their SnapTrade user and reads data.
// Maps positions into the app's holding shape with the shared mapper.
import { supabase } from './supabaseClient.js'
import { mapPositionsToHoldings } from './mapPositions.js'

const API = '/api/partner/'

async function accessToken() {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  return (data.session && data.session.access_token) || ''
}

async function call(route, method = 'GET', body) {
  const token = await accessToken()
  const res = await fetch(API + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error('Partner backend returned an unexpected response')
  }
  if (!json || !json.ok) throw new Error((json && json.error) || 'Request failed')
  return json.data
}

// Is the partner backend wired up (env present)? Public, no auth needed.
export async function partnerConfigured() {
  try {
    const d = await call('status')
    return !!d.configured
  } catch {
    return false
  }
}

// Returns the Connection Portal URL the SnapTradeReact widget opens.
export const getConnectUrl = () => call('connect', 'POST', {}).then((d) => d.url)

export const listAccounts = () => call('accounts')

export async function getPartnerPortfolio(accountId) {
  const d = await call('portfolio' + (accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''))
  const fx = Number(d.fx) || 1.4
  return {
    holdings: mapPositionsToHoldings(d.positions, fx),
    cash: Number(d.cash) || 0,
    fx,
    accountId: d.accountId || null,
  }
}
