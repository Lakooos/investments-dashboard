// PARTNER MODE entry — the multi-user, "no keys for users" experience.
// Enabled by VITE_SNAPTRADE_MODE=partner (see main.jsx). Flow:
//   sign in (Supabase Auth) → "Connect Wealthsimple" (SnapTrade Connection Portal,
//   handles brokerage login + 2FA) → live portfolio. Users never touch API keys.
// Shares the redesigned UI in components/ui.jsx with personal mode (App.jsx).
import { useEffect, useMemo, useState } from 'react'
import { SnapTradeReact } from 'snaptrade-react'
import Icon, { Logo } from './components/icons.jsx'
import { Sparkline } from './components/ValueChart.jsx'
import {
  money, money0, signMoney, RANGE_DAYS,
  Sidebar, PortfolioChip, HeroCard, AllocationCard, HoldingsTable, HoldingsPreview,
  LiquidationNote, MoversCard, ConnectionCard, QuickRules, LifetimeReturns,
} from './components/ui.jsx'
import { enrich, summarize, recommend, sellOutcome, selectPinnedRules } from './lib/portfolio.js'
import { loadHistory, prevEntry, computeTodayChange, recordToday, todayStr } from './lib/history.js'
import { supabase } from './lib/supabaseClient.js'
import { partnerConfigured, getConnectUrl, getPartnerPortfolio, listAccounts } from './lib/partnerSource.js'
import { PROFILE } from './data/holdings.js'
import { INVESTING_RULES, PB_LEVELS } from './data/investingRules.js'

const PB_BATCH = 5
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'holdings', label: 'Holdings', icon: 'holdings' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export default function PartnerApp() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [backendOk, setBackendOk] = useState(null)
  const [portfolio, setPortfolio] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [loginLink, setLoginLink] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false) // a portfolio load has completed at least once
  const [err, setErr] = useState('')
  // UI state
  const [view, setView] = useState('dashboard')
  const [range, setRange] = useState('3M')
  const [pieMode, setPieMode] = useState('holding') // holding | theme | bucket
  const [sellOpen, setSellOpen] = useState({})
  const [pbLevel, setPbLevel] = useState('all')
  const [pbSeed, setPbSeed] = useState(0)

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
      setLoaded(true)
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

  const fx = portfolio?.fx || 1.4
  const enriched = useMemo(() => (portfolio ? enrich(portfolio.holdings, fx) : []), [portfolio, fx])
  const summary = useMemo(() => (portfolio ? summarize(enriched, portfolio.cash) : null), [enriched, portfolio])
  const recs = useMemo(() => (summary ? recommend(summary, PROFILE) : []), [summary])

  const pinnedRules = useMemo(() => (summary ? selectPinnedRules(summary, PROFILE, INVESTING_RULES) : []), [summary])
  const playbook = useMemo(() => {
    const pinnedTitles = new Set(pinnedRules.map((r) => r.title))
    const inLevel = (r) => pbLevel === 'all' || r.level === pbLevel
    const pool = INVESTING_RULES.filter((r) => inLevel(r) && !pinnedTitles.has(r.title))
    const day = Math.floor(Date.now() / 86_400_000)
    const n = Math.min(PB_BATCH, pool.length)
    const start = pool.length ? ((((day + pbSeed) * PB_BATCH) % pool.length) + pool.length) % pool.length : 0
    const batch = Array.from({ length: n }, (_, i) => pool[(start + i) % pool.length])
    return { pinned: pinnedRules, batch, poolLen: pool.length, total: INVESTING_RULES.length }
  }, [pinnedRules, pbLevel, pbSeed])

  const lifetime = useMemo(() => {
    const price = summary?.plCad || 0
    const dividends = portfolio?.dividends || 0
    const fees = portfolio?.fees || 0
    const total = price + dividends - fees
    const totalPct = summary?.book ? total / summary.book : 0
    return { price, pricePct: summary?.plPct || 0, dividends, fees, total, totalPct }
  }, [summary, portfolio])

  const liquidation = useMemo(() => {
    if (!summary) return { net: 0, book: 0, fees: 0, realPl: 0, realPlPct: 0 }
    const rows = summary.byHolding.map((h) => sellOutcome(h, fx))
    const net = rows.reduce((s, r) => s + r.netCad, 0)
    const book = rows.reduce((s, r) => s + r.bookCad, 0)
    const fees = rows.reduce((s, r) => s + r.feeCad, 0)
    const realPl = net - book
    return { net, book, fees, realPl, realPlPct: book ? realPl / book : 0 }
  }, [summary, fx])

  const pieData = useMemo(() => {
    if (!summary) return []
    let base
    if (pieMode === 'theme') base = summary.byTheme.map((t) => ({ name: t.theme, value: t.value, pct: t.pct }))
    else if (pieMode === 'bucket')
      base = [
        { name: 'Core', value: summary.core, pct: summary.invested ? (summary.core / summary.accountTotal) * 100 : 0 },
        { name: 'Satellites', value: summary.satellite, pct: summary.invested ? (summary.satellite / summary.accountTotal) * 100 : 0 },
      ]
    else base = summary.byHolding.map((h) => ({ name: h.symbol, value: h.marketValueCad, pct: h.pct }))
    if (summary.cash > 0) base = [...base, { name: 'Cash', value: summary.cash, pct: summary.cashPct }]
    return base
  }, [pieMode, summary])

  const movers = useMemo(
    () => (summary ? [...summary.byHolding].sort((a, b) => Math.abs(b.plNativePct) - Math.abs(a.plNativePct)).slice(0, 4) : []),
    [summary],
  )

  // Today's day-over-day change (shared daily history in localStorage).
  const today = useMemo(() => {
    const map = Object.fromEntries(enriched.map((h) => [h.symbol, Math.round(h.price * h.rate * 100) / 100]))
    const prev = prevEntry(loadHistory(), todayStr())
    return { map, ...computeTodayChange(enriched, prev) }
  }, [enriched])

  useEffect(() => {
    if (summary && enriched.length) recordToday(todayStr(), today.map, summary.invested, summary.accountTotal)
  }, [today.map, summary, enriched.length])

  const chartAll = useMemo(() => {
    if (!summary) return []
    const rows = Object.entries(loadHistory())
      .map(([date, e]) => ({ date, value: Number(e.accountTotal) || 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    const t = todayStr()
    const last = rows[rows.length - 1]
    if (!last || last.date !== t) rows.push({ date: t, value: summary.accountTotal })
    else last.value = summary.accountTotal
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, today])
  const chartSeries = useMemo(() => {
    if (RANGE_DAYS[range] === Infinity) return chartAll
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range])
    const cut = cutoff.toISOString().slice(0, 10)
    const f = chartAll.filter((r) => r.date >= cut)
    return f.length >= 2 ? f : chartAll.slice(-2)
  }, [chartAll, range])
  const sparkVals = chartAll.slice(-24).map((r) => r.value)

  const toggleSell = (sym) => setSellOpen((m) => ({ ...m, [sym]: !m[sym] }))

  // ---- gates (centered, pre-dashboard states) ----
  if (!supabase)
    return (
      <CenterShell>
        <div className="note" style={{ maxWidth: 460 }}>
          Partner mode needs Supabase env. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>app/.env.local</code> — see <code>PARTNER_MODE.md</code>.
        </div>
      </CenterShell>
    )
  if (session === undefined) return <CenterShell><p className="muted">Loading…</p></CenterShell>
  if (!session) return <CenterShell><AuthForm /></CenterShell>

  const connected = accounts.length > 0
  const hasHoldings = !!(summary && portfolio?.holdings?.length)
  const accountName = portfolio?.accountName || 'Wealthsimple'
  const email = session.user?.email || ''

  // Connection card actions (rail + nothing-connected prompt use these).
  const connButtons = connected
    ? [
        { label: busy ? 'Refreshing…' : 'Refresh', icon: 'refresh', onClick: () => loadPortfolio(portfolio?.accountId), disabled: busy, kind: 'primary' },
        { label: 'Add / manage account', icon: 'link', onClick: connect, disabled: backendOk === false, kind: 'ghost' },
      ]
    : [{ label: 'Connect Wealthsimple', icon: 'link', onClick: connect, disabled: busy || backendOk === false, kind: 'primary' }]
  const connNote = backendOk === false ? 'Partner backend not configured. Add SnapTrade + Supabase keys to app/.env.local, then restart npm run dev.' : null
  const connBadge = connected ? 'Connected · ' + accountName : 'Not linked'

  return (
    <div className="app-shell">
      <Sidebar nav={NAV} view={view} setView={setView} connected={connected} />

      <main className="app-main">
        <header className="topbar-new">
          <div className="tb-greeting">
            <h1>Welcome back{email ? ', ' + email.split('@')[0] : ''} <span className="wave">👋</span></h1>
            <p className="tb-sub">Here's what your portfolio looks like today.</p>
          </div>
          {summary && <PortfolioChip total={summary.accountTotal} todayPct={today.changePct} hasBaseline={today.hasBaseline} sparkVals={sparkVals} Sparkline={Sparkline} />}
          <div className="tb-right">
            {accounts.length > 1 && (
              <select className="acct-select" value={portfolio?.accountId || ''} onChange={(e) => loadPortfolio(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.total != null ? ` · ${money0(a.total)}` : ''}</option>
                ))}
              </select>
            )}
            <button className="icon-btn" onClick={() => loadPortfolio(portfolio?.accountId)} disabled={busy} title="Refresh"><Icon name="refresh" /></button>
            <button className="avatar-pill" onClick={() => setView('settings')} title="Account">
              <span className="avatar">{(email[0] || '?').toUpperCase()}</span>
              <span className="avatar-email">{email}</span>
              <Icon name="chevronDown" />
            </button>
            <button className="icon-btn" onClick={() => supabase.auth.signOut()} title="Sign out"><Icon name="logout" /></button>
          </div>
        </header>

        {err && <div className="note" style={{ borderColor: 'rgba(239,68,68,.5)', background: 'rgba(239,68,68,.12)', color: '#f0a3a3' }}>{err}</div>}

        {!connected ? (
          <section className="panel-card">
            <div className="empty-state">
              <Icon name="link" />
              <div className="es-title">Connect your Wealthsimple account</div>
              {loaded ? 'Link your account through SnapTrade’s secure portal — no API keys, ever.' : 'Loading…'}
              {connNote && <div style={{ marginTop: 8 }}>{connNote}</div>}
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={connect} disabled={busy || backendOk === false}><Icon name="link" /> Connect Wealthsimple</button>
              </div>
            </div>
          </section>
        ) : !summary ? (
          <p className="muted">Loading your portfolio…</p>
        ) : (
          <>
            {view === 'dashboard' && (
              <div className="content-grid">
                <div className="content-left">
                  <HeroCard summary={summary} lifetime={lifetime} today={today} chartSeries={chartSeries} range={range} setRange={setRange} profile={PROFILE} />
                  <div className="panels-2">
                    <AllocationCard pieMode={pieMode} setPieMode={setPieMode} pieData={pieData} count={summary.byHolding.length} />
                    {hasHoldings ? (
                      <HoldingsPreview rows={summary.byHolding.slice(0, 5)} fx={fx} sellOpen={sellOpen} toggleSell={toggleSell} accountName={accountName} onViewAll={() => setView('holdings')} />
                    ) : (
                      <section className="panel-card">
                        <h2 className="card-title" style={{ marginBottom: 12 }}>Holdings</h2>
                        <p className="muted">No holdings in this account yet{summary.cash > 0 ? ` — just ${money(summary.cash)} in cash.` : '.'} They'll show up here on the next refresh.</p>
                      </section>
                    )}
                  </div>
                </div>
                <div className="rail">
                  <ConnectionCard connected={connected} badge={connBadge} buttons={connButtons} note={connNote} />
                  <MoversCard movers={movers} onViewAll={() => setView('holdings')} />
                  <section className="panel-card">
                    <div className="card-head">
                      <h2 className="card-title">Income &amp; fees</h2>
                      <button className="link-btn" onClick={() => setView('insights')}>Details</button>
                    </div>
                    <div className="rail-list">
                      <div className="rail-row">
                        <span className="rail-ava act-ico"><Icon name="coins" /></span>
                        <div className="rail-info"><div className="rail-name">Dividends</div><div className="rail-meta">Tax-free, received</div></div>
                        <div className="rail-right"><span className="rail-amt act-up">{portfolio.incomeUnavailable ? '—' : signMoney(lifetime.dividends)}</span></div>
                      </div>
                      <div className="rail-row">
                        <span className="rail-ava act-ico"><Icon name="receipt" /></span>
                        <div className="rail-info"><div className="rail-name">Fees paid</div><div className="rail-meta">FX / commissions</div></div>
                        <div className="rail-right"><span className="rail-amt act-down">{portfolio.incomeUnavailable ? '—' : '-' + money(lifetime.fees).replace('-', '')}</span></div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {view === 'holdings' && (
              <div className="content-grid no-rail">
                <div className="content-left">
                  <div>
                    <h2 className="view-title">Holdings</h2>
                    <p className="view-sub">{summary.byHolding.length} positions · {accountName}</p>
                  </div>
                  <section className="panel-card">
                    <div className="card-head">
                      <h2 className="card-title">Positions</h2>
                      <span className="acct-chip"><Icon name="database" /> {accountName}</span>
                    </div>
                    {hasHoldings ? (
                      <>
                        <HoldingsTable rows={summary.byHolding} fx={fx} sellOpen={sellOpen} toggleSell={toggleSell} full />
                        <LiquidationNote liquidation={liquidation} />
                      </>
                    ) : (
                      <p className="muted">No holdings in this account yet{summary.cash > 0 ? ` — just ${money(summary.cash)} in cash.` : '.'}</p>
                    )}
                  </section>
                </div>
              </div>
            )}

            {view === 'insights' && (
              <div className="content-grid no-rail">
                <div className="content-left">
                  <div>
                    <h2 className="view-title">Insights</h2>
                    <p className="view-sub">Tailored to your portfolio · {PROFILE.risk} risk · tilted to space + AI</p>
                  </div>
                  <QuickRules recs={recs} playbook={playbook} pbLevel={pbLevel} setPbLevel={setPbLevel} setPbSeed={setPbSeed} profile={PROFILE} levels={PB_LEVELS} />
                  <LifetimeReturns
                    lifetime={lifetime}
                    hasActivity={!portfolio.incomeUnavailable}
                    note={portfolio.incomeUnavailable ? "Couldn't read your transaction history this time, so dividends & fees show as $0. Total return falls back to your unrealized gain/loss until the next successful refresh." : null}
                  />
                </div>
              </div>
            )}

            {view === 'settings' && (
              <div className="content-grid no-rail">
                <div className="content-left">
                  <div>
                    <h2 className="view-title">Settings</h2>
                    <p className="view-sub">Brokerage connection &amp; account</p>
                  </div>

                  <section className="panel-card">
                    <h2 className="card-title" style={{ marginBottom: 6 }}>Brokerage connection</h2>
                    {backendOk === false && (
                      <div className="note" style={{ marginBottom: 12 }}>
                        Partner backend isn't configured. Add <code>SNAPTRADE_CLIENT_ID</code>, <code>SNAPTRADE_CONSUMER_KEY</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>app/.env.local</code>, then restart <code>npm run dev</code>.
                      </div>
                    )}
                    <div className="set-row">
                      <div className="sr-info">
                        <div className="sr-title">Wealthsimple {connected && <span className="live-badge">● LIVE</span>}</div>
                        <div className="sr-desc">{connected ? `Live data · ${accountName}` : 'Link your account through SnapTrade’s secure portal — no API keys, ever.'}</div>
                      </div>
                      <div className="card-actions">
                        <button className="btn" onClick={connect} disabled={backendOk === false}><Icon name="link" /> {connected ? 'Add account' : 'Connect'}</button>
                        {connected && <button className="btn btn-primary" onClick={() => loadPortfolio(portfolio?.accountId)} disabled={busy}><Icon name="refresh" /> {busy ? 'Refreshing…' : 'Refresh'}</button>}
                      </div>
                    </div>
                    {accounts.length > 1 && (
                      <div className="set-row">
                        <div className="sr-info">
                          <div className="sr-title">Active account</div>
                          <div className="sr-desc">Choose which connected account to view.</div>
                        </div>
                        <select className="acct-select" value={portfolio?.accountId || ''} onChange={(e) => loadPortfolio(e.target.value)}>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}{a.total != null ? ` · ${money0(a.total)}` : ''}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </section>

                  <section className="panel-card">
                    <h2 className="card-title" style={{ marginBottom: 6 }}>Account</h2>
                    <div className="set-row">
                      <div className="sr-info">
                        <div className="sr-title">Signed in</div>
                        <div className="sr-desc">{email}</div>
                      </div>
                      <button className="btn btn-danger" onClick={() => supabase.auth.signOut()}><Icon name="logout" /> Sign out</button>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </>
        )}

        <footer className="foot">
          Educational only — not licensed financial advice. Multi-user partner mode (SnapTrade Connection Portal).
          {portfolio && <> · 1 USD = ${fx.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} CAD</>}
        </footer>
      </main>

      <SnapTradeReact
        loginLink={loginLink}
        isOpen={modalOpen}
        close={() => setModalOpen(false)}
        onSuccess={() => { setModalOpen(false); loadPortfolio() }}
        onError={(e) => { setModalOpen(false); setErr((e && e.detail) || 'Connection failed') }}
        onExit={() => setModalOpen(false)}
      />
    </div>
  )
}

function CenterShell({ children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-brand">
        <span className="logo-mark"><Logo /></span>
        <span className="logo-text">Investments</span>
      </div>
      {children}
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
    if (error) {
      if (mode === 'signin' && /invalid login credentials/i.test(error.message)) {
        setMsg("Couldn't sign in. Note: this is your dashboard account, not your Wealthsimple login. If you haven't made one yet, click “Need an account? Sign up” below. (You'll connect Wealthsimple after signing in.)")
      } else {
        setMsg(error.message)
      }
    } else if (mode === 'signup') {
      setMsg('Account created. If email confirmation is on, confirm via email, then sign in.')
    }
  }

  return (
    <div className="panel-card" style={{ maxWidth: 420, width: '100%' }}>
      <h2 className="card-title" style={{ marginBottom: 6 }}>{mode === 'signin' ? 'Sign in to the dashboard' : 'Create a dashboard account'}</h2>
      <p className="muted modal-sub">
        This is a <strong>dashboard account</strong> — not your Wealthsimple login. Use any email and password
        (new here? Sign up below). You'll link Wealthsimple <strong>after</strong> signing in, through SnapTrade's
        secure portal — no API keys, ever.
      </p>
      {msg && <div className="modal-err">{msg}</div>}
      <form onSubmit={submit} className="setup-step">
        <label className="setup-fld"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="setup-fld"><span>Password</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} /></label>
        <div className="modal-foot">
          <button type="button" className="link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg('') }}>
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
        </div>
      </form>
    </div>
  )
}
