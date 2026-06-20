// Vercel Serverless Function — the PARTNER-mode backend in production.
// Mirrors the dev-only Vite plugin (vite-plugin-snaptrade.js) so the deployed
// site has the same /api/partner/* endpoints. Wraps server/partnerService.js,
// which reads its secrets from process.env (set these in the Vercel project,
// NOT VITE_-prefixed): SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Routes (file is api/partner/[action].js → req.query.action):
//   GET  /api/partner/status     -> { configured }           (public)
//   POST /api/partner/connect    -> { url }                  (auth)
//   GET  /api/partner/accounts   -> [ accounts ]             (auth)
//   GET  /api/partner/portfolio  -> { positions, cash, ... } (auth)
import * as partner from '../../server/partnerService.js'

const bearer = (req) => {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  const action = String(req.query.action || '')
  try {
    // Public: lets the UI know whether partner mode is wired up server-side.
    if (req.method === 'GET' && action === 'status') {
      return res.status(200).json({ ok: true, data: { configured: partner.isConfigured() } })
    }

    const uid = await partner.verifyUser(bearer(req)) // throws if not signed in

    let data
    if (req.method === 'POST' && action === 'connect') {
      const body = req.body || {}
      data = { url: await partner.connectionPortalUrl(uid, { customRedirect: body.customRedirect }) }
    } else if (req.method === 'GET' && action === 'accounts') {
      data = await partner.listAccounts(uid)
    } else if (req.method === 'GET' && action === 'portfolio') {
      data = await partner.getPortfolio(uid, req.query.accountId)
    } else {
      return res.status(404).json({ ok: false, error: 'Unknown partner route: ' + action })
    }

    return res.status(200).json({ ok: true, data })
  } catch (e) {
    // Match the dev plugin: surface the message with a 200 so the UI can show it.
    return res.status(200).json({ ok: false, error: e && e.message ? e.message : String(e) })
  }
}
