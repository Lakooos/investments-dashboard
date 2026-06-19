// PARTNER MODE entry — the multi-user, "no keys for users" experience.
// Enabled by VITE_SNAPTRADE_MODE=partner (see main.jsx). Flow:
//   sign in (Supabase Auth) → "Connect Wealthsimple" (SnapTrade Connection Portal,
//   handles brokerage login + 2FA) → live portfolio. Users never touch API keys.
import { useEffect, useMemo, useState } from 'react'
import { SnapTradeReact } from 'snaptrade-react'
import AllocationPie from './components/AllocationPie.jsx'
import { enrich, summarize } from './lib/portfolio.js'
import { supabase } from './lib/supabaseClient.js'
import { partnerConfigured, getConnectUrl, getPartnerPortfolio, listAccounts } from './lib/partnerSource.js'

const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (n) => '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-CA')
const pct = (n) => (n >= 0 ? '+' : '') + (Number(n) * 100).toFixed(1) + '%'

export default function PartnerApp() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [backendOk, setBackendOk] = useState(null)
  const [portfolio, setPortfolio] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [loginLink, setLoginLink] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // --- auth session ---
  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) partnerConfigured().then(setBackendOk)
  }, [session])

  useEffect(() => {
    if (session && backendOk) loadPortfolio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, backendOk])

  async function loadPortfolio(accountId) {
    setBusy(true); setErr('')
    try {
      setAccounts(await listAccounts().catch(() => []))
      setPortfolio(await getPartnerPortfolio(accountId))
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function connect() {
    setErr('')
    try {
      setLoginLink(await getConnectUrl())
      setModalOpen(true)
    } catch (e) {
      setErr(e.message || String(e))
    }
  }

  const enriched = useMemo(() => (portfolio ? enrich(portfolio.holdings, portfolio.fx) : []), [portfolio])
  const summary = useMemo(() => (portfolio ? summarize(enriched, portfolio.cash) : null), [enriched, portfolio])
  const pieData = useMemo(() => {
    if (!summary) return []
    const base = summary.byHolding.map((h) => ({ name: h.symbol, value: h.marketValueCad, pct: h.pct }))
    return summary.cash > 0 ? [...base, { name: 'Cash', value: summary.cash, pct: summary.cashPct }] : base
  }, [summary])

  // ---- gates ----
  if (!supabase) return <Shell><Notice>Partner mode needs Supabase env. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>app/.env.local</code> — see <code>PARTNER_MODE.md</code>.</Notice></Shell>
  if (session === undefined) return <Shell><p className="muted">Loading…</p></Shell>
  if (!session) return <Shell><AuthForm /></Shell>

  return (
    <Shell email={session.user?.email} onSignOut={() => supabase.auth.signOut()}>
      {backendOk === false && (
        <Notice>
          You're signed in, but the partner backend isn't configured. Add <code>SNAPTRADE_CLIENT_ID</code>,{' '}
          <code>SNAPTRADE_CONSUMER_KEY</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>app/.env.local</code>,
          then restart <code>npm run dev</code>. See <code>PARTNER_MODE.md</code>.
        </Notice>
      )}
      {err && <div className="modal-err">{err}</div>}

      <div className="controls" style={{ marginBottom: 16 }}>
        <button className="primary" onClick={connect} disabled={busy || backendOk === false}>🔗 Connect Wealthsimple</button>
        <button onClick={() => loadPortfolio()} disabled={busy || backendOk === false}>{busy ? '⏳ Loading…' : '🔄 Refresh'}</button>
        {accounts.length > 1 && (
          <select value={portfolio?.accountId || ''} onChange={(e) => loadPortfolio(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} {a.total != null ? `· ${money0(a.total)}` : ''}</option>)}
          </select>
        )}
      </div>

      {summary && portfolio?.holdings?.length ? (
        <>
          <section className="cards">
            <Card label="Total account value" value={money(summary.accountTotal)} sub={`${money0(summary.invested)} invested + ${money0(summary.cash)} cash`} />
            <Card label="Holdings" value={String(portfolio.holdings.length)} sub={portfolio.accountId ? 'live from Wealthsimple' : ''} />
            <Card label="Unrealized P&L" value={money(summary.plCad)} sub={pct(summary.plPct)} />
          </section>
          <div className="grid">
            <section className="panel">
              <h2>Allocation</h2>
              <AllocationPie data={pieData} />
            </section>
            <section className="panel">
              <h2>Holdings</h2>
              <table className="holdings">
                <thead><tr><th>Symbol</th><th className="r">Shares</th><th className="r">Price</th><th className="r">Value (CAD)</th><th className="r">P&L</th></tr></thead>
                <tbody>
                  {summary.byHolding.map((h) => (
                    <tr key={h.symbol}>
                      <td><strong>{h.symbol}</strong> <span className={'pill pill-' + h.cls}>{h.cls}</span><div className="muted">{h.name}</div></td>
                      <td className="r">{h.shares}</td>
                      <td className="r">{h.price?.toLocaleString('en-CA', { maximumFractionDigits: 2 })} {h.currency}</td>
                      <td className="r">{money(h.marketValueCad)}</td>
                      <td className={'r ' + (h.plNative >= 0 ? 'up' : 'down')}>{money(h.plNative)} {h.currency} <span className="muted">({pct(h.plNativePct)})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      ) : (
        backendOk !== false && !busy && (
          <div className="note">No connected account yet. Click <strong>🔗 Connect Wealthsimple</strong> to link your account — you'll log in through SnapTrade's secure portal (no keys needed).</div>
        )
      )}

      <SnapTradeReact
        loginLink={loginLink}
        isOpen={modalOpen}
        close={() => setModalOpen(false)}
        onSuccess={() => { setModalOpen(false); loadPortfolio() }}
        onError={(e) => { setModalOpen(false); setErr((e && e.detail) || 'Connection failed') }}
        onExit={() => setModalOpen(false)}
      />
    </Shell>
  )
}

function Shell({ children, email, onSignOut }) {
  return (
    <div className="wrap">
      <header className="topbar">
        <div>
          <h1>Investments Dashboard</h1>
          <p className="sub"><span className="live-badge">PARTNER MODE</span> · keyless Wealthsimple connect</p>
        </div>
        {email && (
          <div className="controls">
            <span className="muted">{email}</span>
            <button onClick={onSignOut}>Sign out</button>
          </div>
        )}
      </header>
      {children}
      <footer className="foot">Educational only — not licensed financial advice. Multi-user partner mode (SnapTrade Connection Portal).</footer>
    </div>
  )
}

function Notice({ children }) {
  return <div className="note" style={{ lineHeight: 1.5 }}>{children}</div>
}

function Card({ label, value, sub }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}

function AuthForm() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [mode, setMode] = useState('signin') // signin | signup
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg('')
    const op = mode === 'signin'
      ? supabase.auth.signInWithPassword({ email, password: pw })
      : supabase.auth.signUp({ email, password: pw })
    const { error } = await op
    setBusy(false)
    if (error) setMsg(error.message)
    else if (mode === 'signup') setMsg('Account created. If email confirmation is on, confirm via email, then sign in.')
  }

  return (
    <div className="panel" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h2>{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
      <p className="muted modal-sub">Sign in to connect your Wealthsimple account — no API keys, ever.</p>
      {msg && <div className="modal-err">{msg}</div>}
      <form onSubmit={submit} className="setup-step">
        <label className="setup-fld"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="setup-fld"><span>Password</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} /></label>
        <div className="modal-foot">
          <button type="button" className="link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg('') }}>
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
          <button className="primary" type="submit" disabled={busy}>{busy ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
        </div>
      </form>
    </div>
  )
}
