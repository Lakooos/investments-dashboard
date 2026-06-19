// Vite plugin: adds a tiny SnapTrade backend to the dev server so the whole thing
// works with a single `npm run dev` (no Electron, no separate server process).
//
// It mounts /api/snaptrade/* as Node middleware running INSIDE the Vite process —
// the only place your SnapTrade secret lives. The React app (localhost:5173) calls
// these routes with fetch(); the secret is never sent to the browser or committed.
//
// Available during `vite dev` and `vite preview`. It does NOT exist on a static
// host (e.g. GitHub Pages) — there's no Node there — so the app falls back to its
// CSV/screenshot flow on the deployed site. Live brokerage data = local dev only.
import * as svc from './server/snaptradeService.js'
import * as partner from './server/partnerService.js'

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

// Map "METHOD /api/snaptrade/<route>" to a service call. Each returns plain data;
// errors become { ok:false, error } with a 200 so the UI can show the message.
const routes = {
  'GET state': () => svc.configState(),
  'POST keys': (body) => svc.saveKeys(body),
  'POST register': () => svc.register(),
  'POST connect': () => svc.connectUrl(), // returns the portal URL; the browser opens it
  'GET accounts': () => svc.listAccounts(),
  'POST account': (body) => svc.setAccount(body),
  'GET portfolio': () => svc.getPortfolio(),
  'POST reset': () => svc.reset(),
}

function snaptradeMiddleware() {
  return async (req, res, next) => {
    const url = (req.url || '').split('?')[0]
    if (!url.startsWith('/api/snaptrade/')) return next()
    const name = url.slice('/api/snaptrade/'.length).replace(/\/$/, '')
    const handler = routes[`${req.method} ${name}`]
    res.setHeader('Content-Type', 'application/json')
    if (!handler) {
      res.statusCode = 404
      res.end(JSON.stringify({ ok: false, error: 'Unknown SnapTrade route: ' + name }))
      return
    }
    try {
      const body = req.method === 'POST' ? await readBody(req) : undefined
      const data = await handler(body)
      res.end(JSON.stringify({ ok: true, data }))
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }))
    }
  }
}

// PARTNER mode (/api/partner/*): multi-user, keyless. Every route except `status`
// requires the caller's Supabase JWT (Authorization: Bearer <token>), which the
// partner service verifies into an app-user id. Secrets stay server-side.
function bearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}
function query(req) {
  const q = (req.url || '').split('?')[1] || ''
  return Object.fromEntries(new URLSearchParams(q))
}

function partnerMiddleware() {
  return async (req, res, next) => {
    const url = (req.url || '').split('?')[0]
    if (!url.startsWith('/api/partner/')) return next()
    const name = url.slice('/api/partner/'.length).replace(/\/$/, '')
    res.setHeader('Content-Type', 'application/json')
    try {
      // Public: lets the UI know whether partner mode is wired up server-side.
      if (req.method === 'GET' && name === 'status') {
        res.end(JSON.stringify({ ok: true, data: { configured: partner.isConfigured() } }))
        return
      }
      const uid = await partner.verifyUser(bearer(req)) // throws if not signed in
      let data
      if (req.method === 'POST' && name === 'connect') {
        const body = await readBody(req)
        data = { url: await partner.connectionPortalUrl(uid, { customRedirect: body.customRedirect }) }
      } else if (req.method === 'GET' && name === 'accounts') {
        data = await partner.listAccounts(uid)
      } else if (req.method === 'GET' && name === 'portfolio') {
        data = await partner.getPortfolio(uid, query(req).accountId)
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'Unknown partner route: ' + name }))
        return
      }
      res.end(JSON.stringify({ ok: true, data }))
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }))
    }
  }
}

export default function snaptradePlugin() {
  return {
    name: 'snaptrade-dev-api',
    configureServer(server) {
      server.middlewares.use(snaptradeMiddleware())
      server.middlewares.use(partnerMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(snaptradeMiddleware())
      server.middlewares.use(partnerMiddleware())
    },
  }
}
