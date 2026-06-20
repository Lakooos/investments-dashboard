import { useEffect, useMemo, useRef, useState } from 'react'
import SnapTradeSetupModal from './components/SnapTradeSetupModal.jsx'
import { Sparkline } from './components/ValueChart.jsx'
import Icon from './components/icons.jsx'
import {
  money, money0, pct, pct2, signMoney, RANGE_DAYS,
  Sidebar, PortfolioChip, HeroCard, AllocationCard, HoldingsTable, HoldingsPreview,
  LiquidationNote, MoversCard, ActivityCard, ConnectionCard, QuickRules, LifetimeReturns,
} from './components/ui.jsx'
import { getState as snapGetState, getLivePortfolio } from './lib/snaptradeSource.js'
import { buildSnapshot, buildPrompt, copyAndDownload } from './lib/aiBridge.js'
import { enrich, summarize, recommend, sellOutcome, selectPinnedRules } from './lib/portfolio.js'
import { parseHoldingsCsv, parseActivityCsv, detectCsvKind } from './lib/parseCsv.js'
import { loadHistory, prevEntry, computeTodayChange, recordToday, todayStr } from './lib/history.js'
import { SEED_HOLDINGS, DEFAULT_FX, PROFILE, AS_OF } from './data/holdings.js'
import { INVESTING_RULES, PB_LEVELS } from './data/investingRules.js'

// Display-only identity for the welcome banner + avatar (this is a personal,
// single-user dashboard). Edit these two strings to change the name/email shown.
const OWNER = { name: 'Lucas', email: 'lucasy1101@gmail.com' }

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'holdings', label: 'Holdings', icon: 'holdings' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

// localStorage keys + a tiny JSON loader so uploads & cash survive reloads AND
// auto-recompute with the latest code (no need to re-upload after every fix).
const LS = {
  holdings: 'invdash_holdings_v2', // v2: now carries native-currency P&L from the report
  activity: 'invdash_activity',
  fx: 'invdash_fx',
  cashOverride: 'invdash_cash_override', // null/absent = use the derived cash
  asOf: 'invdash_asof',
}
const loadJSON = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

// Cash = all deposits − what you've actually spent on the holdings you still own
// (+ dividends + interest − fees). We use the holdings report's BOOK values for
// "spent" so a partial activity export (missing some buy rows) can't inflate cash.
const sumBook = (hs) => hs.reduce((s, h) => s + (Number(h.bookCad) || 0), 0)
const derivedCash = (a, hs) =>
  Math.max(0, a.contributionsTotal - sumBook(hs) + a.dividends + (a.interest || 0) - a.fees)

export default function App() {
  const [holdings, setHoldings] = useState(() => loadJSON(LS.holdings, SEED_HOLDINGS))
  const [fx, setFx] = useState(() => loadJSON(LS.fx, DEFAULT_FX))
  const [activity, setActivity] = useState(() => loadJSON(LS.activity, null))
  const [cashOverride, setCashOverride] = useState(() => loadJSON(LS.cashOverride, null))
  const [asOf, setAsOf] = useState(() => loadJSON(LS.asOf, AS_OF))
  const [pieMode, setPieMode] = useState('holding') // holding | theme | bucket
  const [sellOpen, setSellOpen] = useState({}) // symbol -> bool: "Sell outcome" row expanded
  const [note, setNote] = useState('')
  const [pbLevel, setPbLevel] = useState('all') // playbook level filter
  const [pbSeed, setPbSeed] = useState(0) // bump to rotate to the next batch of tips
  // New UI state for the redesigned shell (presentation only — no feature changes).
  const [view, setView] = useState('dashboard')
  const [range, setRange] = useState('3M')
  const [query, setQuery] = useState('')
  // SnapTrade (live brokerage) state — only available when the dev backend is up.
  const [snapOn, setSnapOn] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [live, setLive] = useState(null)
  const [liveBusy, setLiveBusy] = useState(false)
  const [snapConfigured, setSnapConfigured] = useState(false)
  const fileRef = useRef(null)

  async function refreshLive() {
    setLiveBusy(true)
    try {
      const { holdings: h, cash: c, fx: f, asOf: d, accountName } = await getLivePortfolio()
      setHoldings(h)
      setFx(f)
      setCashOverride(c)
      setAsOf(d)
      setLive({ asOf: d, accountName })
      setNote(`🔄 Live from Wealthsimple${accountName ? ' · ' + accountName : ''} — ${h.length} holdings, cash ${money(c)} (as of ${d}).`)
    } catch (e) {
      setNote('⚠️ Live refresh failed: ' + (e.message || e) + '. Showing the last loaded data.')
    } finally {
      setLiveBusy(false)
    }
  }

  useEffect(() => {
    snapGetState()
      .then((s) => {
        setSnapOn(true)
        setSnapConfigured(!!s.hasAccount)
        if (s.hasAccount) refreshLive()
      })
      .catch(() => setSnapOn(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSetupDone() {
    setSetupOpen(false)
    setSnapConfigured(true)
    refreshLive()
  }

  const derivedCashVal = useMemo(() => (activity ? derivedCash(activity, holdings) : null), [activity, holdings])
  const cash = cashOverride != null ? cashOverride : derivedCashVal != null ? derivedCashVal : 0

  useEffect(() => localStorage.setItem(LS.holdings, JSON.stringify(holdings)), [holdings])
  useEffect(() => localStorage.setItem(LS.fx, JSON.stringify(fx)), [fx])
  useEffect(() => localStorage.setItem(LS.asOf, JSON.stringify(asOf)), [asOf])
  useEffect(() => {
    if (activity) localStorage.setItem(LS.activity, JSON.stringify(activity))
  }, [activity])
  useEffect(() => localStorage.setItem(LS.cashOverride, JSON.stringify(cashOverride)), [cashOverride])

  const enriched = useMemo(() => enrich(holdings, fx), [holdings, fx])
  const summary = useMemo(() => summarize(enriched, cash), [enriched, cash])
  const stats = useMemo(
    () => ({ ...summary, contributionsThisYear: activity?.contributionsThisYear }),
    [summary, activity],
  )
  const recs = useMemo(() => recommend(stats, PROFILE), [stats])

  const PB_BATCH = 5
  const pinnedRules = useMemo(() => selectPinnedRules(stats, PROFILE, INVESTING_RULES), [stats])
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

  const today = useMemo(() => {
    const map = Object.fromEntries(enriched.map((h) => [h.symbol, Math.round(h.price * h.rate * 100) / 100]))
    const hist = loadHistory()
    const prev = prevEntry(hist, todayStr())
    const change = computeTodayChange(enriched, prev)
    return { map, ...change }
  }, [enriched])

  useEffect(() => {
    recordToday(todayStr(), today.map, summary.invested, summary.accountTotal)
  }, [today.map, summary.invested, summary.accountTotal])

  // Net-worth-over-time series for the hero chart (real recorded daily history).
  const chartAll = useMemo(() => {
    const hist = loadHistory()
    const rows = Object.entries(hist)
      .map(([date, e]) => ({ date, value: Number(e.accountTotal) || 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    const t = todayStr()
    const last = rows[rows.length - 1]
    if (!last || last.date !== t) rows.push({ date: t, value: summary.accountTotal })
    else last.value = summary.accountTotal
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.accountTotal, today])
  const chartSeries = useMemo(() => {
    if (RANGE_DAYS[range] === Infinity) return chartAll
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range])
    const cut = cutoff.toISOString().slice(0, 10)
    const f = chartAll.filter((r) => r.date >= cut)
    return f.length >= 2 ? f : chartAll.slice(-2)
  }, [chartAll, range])

  const lifetime = useMemo(() => {
    const price = summary.plCad
    const dividends = activity?.dividends || 0
    const fees = activity?.fees || 0
    const total = price + dividends - fees
    const totalPct = summary.book ? total / summary.book : 0
    return { price, pricePct: summary.plPct, dividends, fees, total, totalPct }
  }, [summary, activity])

  const toggleSell = (sym) => setSellOpen((m) => ({ ...m, [sym]: !m[sym] }))

  const liquidation = useMemo(() => {
    const rows = summary.byHolding.map((h) => sellOutcome(h, fx))
    const net = rows.reduce((s, r) => s + r.netCad, 0)
    const book = rows.reduce((s, r) => s + r.bookCad, 0)
    const fees = rows.reduce((s, r) => s + r.feeCad, 0)
    const realPl = net - book
    return { net, book, fees, realPl, realPlPct: book ? realPl / book : 0 }
  }, [summary.byHolding, fx])

  const pieData = useMemo(() => {
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
    () => [...summary.byHolding].sort((a, b) => Math.abs(b.plNativePct) - Math.abs(a.plNativePct)).slice(0, 4),
    [summary.byHolding],
  )

  const filteredHoldings = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return summary.byHolding
    return summary.byHolding.filter(
      (h) =>
        h.symbol.toLowerCase().includes(q) ||
        (h.name || '').toLowerCase().includes(q) ||
        (h.theme || '').toLowerCase().includes(q),
    )
  }, [summary.byHolding, query])

  async function genRecs() {
    const snapshot = buildSnapshot({ holdings, summary, fx, profile: PROFILE, activity, asOf, today })
    const copied = await copyAndDownload(buildPrompt(snapshot), snapshot)
    setNote(
      (copied ? '✨ Request copied to clipboard' : '✨ Request downloaded to Downloads') +
        '. Paste it to Claude (this terminal) to get fresh, researched recommendations you can act on.',
    )
  }

  const readText = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('could not read file'))
      reader.readAsText(file)
    })

  async function onFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    let newHoldings = null
    let newActivity = null
    const ok = []
    const errs = []
    for (const file of files) {
      try {
        const text = await readText(file)
        const kind = detectCsvKind(text)
        if (kind === 'activity') {
          newActivity = parseActivityCsv(text)
          ok.push(`${file.name} → activity (${newActivity.transactions.length} txns)`)
        } else if (kind === 'holdings') {
          newHoldings = parseHoldingsCsv(text)
          ok.push(`${file.name} → holdings (${newHoldings.length})`)
        } else {
          errs.push(`${file.name}: not a recognized holdings or activity CSV`)
        }
      } catch (err) {
        errs.push(`${file.name}: ${err.message}`)
      }
    }
    if (newHoldings) setHoldings(newHoldings)
    if (newActivity) {
      setActivity(newActivity)
      setCashOverride(null)
    }
    if (newHoldings || newActivity) setAsOf(todayStr())
    const effHoldings = newHoldings || holdings
    const effActivity = newActivity || activity
    const cashNote =
      effActivity && cashOverride == null ? ` Cash = ${money(derivedCash(effActivity, effHoldings))}.` : ''
    setNote([...ok, ...errs].join(' · ') + cashNote)
  }

  function resetApp() {
    const ok = window.confirm(
      'Reset the dashboard?\n\nThis erases ALL saved data on this device — uploaded holdings, ' +
        'activity, cash, FX and the daily history — and restores the built-in defaults.\n\n' +
        "This can't be undone. (You can re-upload your CSV / screenshot afterward.)",
    )
    if (!ok) return
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('invdash'))
        .forEach((k) => localStorage.removeItem(k))
    } catch {
      /* ignore private-mode / quota errors */
    }
    location.reload()
  }

  const accountName = live?.accountName || 'Wealthsimple TFSA'
  const connConnected = !!live || (snapOn && snapConfigured)
  const sparkVals = chartAll.slice(-24).map((r) => r.value)
  const openUpload = () => fileRef.current?.click()

  // Connection card actions for personal mode (SnapTrade personal keys + setup modal).
  const connButtons = snapOn
    ? snapConfigured
      ? [
          { label: liveBusy ? 'Refreshing…' : 'Refresh (live)', icon: 'refresh', onClick: refreshLive, disabled: liveBusy, kind: 'primary' },
          { label: 'Manage Connection', icon: 'settings', onClick: () => setSetupOpen(true), kind: 'ghost' },
        ]
      : [{ label: 'Connect Wealthsimple', icon: 'link', onClick: () => setSetupOpen(true), kind: 'primary' }]
    : []
  const connNote = !snapOn ? (
    <>Live sync runs when you launch via <code>npm run dev</code>. Using your uploaded CSV data.</>
  ) : null
  const connBadge = connConnected ? (live ? 'Connected · ' + accountName : 'Connected') : snapOn ? 'Not linked' : 'CSV mode'

  return (
    <div className="app-shell">
      <Sidebar nav={NAV} view={view} setView={setView} connected={connConnected} />

      <main className="app-main">
        <header className="topbar-new">
          <div className="tb-greeting">
            <h1>Welcome back, {OWNER.name} <span className="wave">👋</span></h1>
            <p className="tb-sub">Here's what your portfolio looks like today.</p>
          </div>
          <PortfolioChip total={summary.accountTotal} todayPct={today.changePct} hasBaseline={today.hasBaseline} sparkVals={sparkVals} Sparkline={Sparkline} />
          <div className="tb-right">
            <label className="tb-search">
              <Icon name="search" />
              <input
                placeholder="Search holdings…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (e.target.value && view === 'dashboard') setView('holdings')
                }}
              />
            </label>
            <button className="btn btn-violet btn-sm" onClick={genRecs} title="Package your portfolio + a research prompt for Claude">
              <Icon name="sparkles" /> Recommendations
            </button>
            <button className="icon-btn" onClick={() => setView('insights')} title="Insights">
              <Icon name="bell" />
              {recs.some((r) => r.sev === 'warn') && <span className="ping" />}
            </button>
            <button className="avatar-pill" onClick={() => setView('settings')} title="Settings">
              <span className="avatar">{OWNER.name[0]}</span>
              <span className="avatar-email">{OWNER.email}</span>
              <Icon name="chevronDown" />
            </button>
          </div>
        </header>

        <SnapTradeSetupModal open={setupOpen} onClose={() => setSetupOpen(false)} onDone={onSetupDone} />

        {note && (
          <div className="note">
            <span>{note}</span>
            <button className="note-x" onClick={() => setNote('')} aria-label="Dismiss">×</button>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="content-grid">
            <div className="content-left">
              <HeroCard summary={summary} lifetime={lifetime} today={today} chartSeries={chartSeries} range={range} setRange={setRange} profile={PROFILE} />
              <div className="panels-2">
                <AllocationCard pieMode={pieMode} setPieMode={setPieMode} pieData={pieData} count={summary.byHolding.length} />
                <HoldingsPreview rows={summary.byHolding.slice(0, 5)} fx={fx} sellOpen={sellOpen} toggleSell={toggleSell} accountName={accountName} onViewAll={() => setView('holdings')} />
              </div>
            </div>
            <div className="rail">
              <ConnectionCard connected={connConnected} badge={connBadge} buttons={connButtons} note={connNote} />
              <MoversCard movers={movers} onViewAll={() => setView('holdings')} />
              <ActivityCard transactions={activity?.transactions} onViewAll={() => setView('activity')} onUpload={openUpload} />
            </div>
          </div>
        )}

        {view === 'holdings' && (
          <div className="content-grid no-rail">
            <div className="content-left">
              <div>
                <h2 className="view-title">Holdings</h2>
                <p className="view-sub">{summary.byHolding.length} positions · {accountName} · as of {asOf}</p>
              </div>
              <section className="panel-card">
                <div className="card-head">
                  <h2 className="card-title">Positions{query && <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · "{query}"</span>}</h2>
                  <div className="card-actions">
                    <span className="acct-chip"><Icon name="database" /> {accountName}</span>
                    <button className="btn btn-sm" onClick={openUpload}><Icon name="upload" /> Upload CSV</button>
                  </div>
                </div>
                {filteredHoldings.length ? (
                  <HoldingsTable rows={filteredHoldings} fx={fx} sellOpen={sellOpen} toggleSell={toggleSell} full />
                ) : (
                  <div className="empty-state"><div className="es-title">No matches</div>Nothing matches "{query}".</div>
                )}
                <LiquidationNote liquidation={liquidation} />
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
              <LifetimeReturns lifetime={lifetime} hasActivity={!!activity} note={!activity ? 'Upload your activity CSV to include dividends, fees, and TFSA contributions in the lifetime total.' : null} />
            </div>
          </div>
        )}

        {view === 'activity' && (
          <div className="content-grid no-rail">
            <div className="content-left">
              <div>
                <h2 className="view-title">Activity</h2>
                <p className="view-sub">{activity ? `${activity.transactions.length} transactions` : 'No activity loaded'}</p>
              </div>
              <section className="panel-card">
                {activity?.transactions?.length ? (
                  <table className="holdings">
                    <thead>
                      <tr><th>Date</th><th>Type</th><th>Symbol</th><th className="r">Cash impact</th><th>Detail</th></tr>
                    </thead>
                    <tbody>
                      {activity.transactions.slice(0, 60).map((t, i) => (
                        <tr key={i}>
                          <td>{t.date}</td>
                          <td><span className={'pill pill-' + t.type}>{t.type}</span></td>
                          <td>{t.symbol || '—'}</td>
                          <td className={'r ' + (t.amount >= 0 ? 'pl-up' : 'pl-down')}>{signMoney(t.amount)}</td>
                          <td className="muted">{t.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <Icon name="activity" />
                    <div className="es-title">No activity loaded yet</div>
                    Upload your Wealthsimple activity CSV to see deposits, buys, dividends and fees.
                    <div style={{ marginTop: 14 }}><button className="btn" onClick={openUpload}><Icon name="upload" /> Upload activity CSV</button></div>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {view === 'settings' && (
          <div className="content-grid no-rail">
            <div className="content-left">
              <div>
                <h2 className="view-title">Settings</h2>
                <p className="view-sub">Data, currency and brokerage connection</p>
              </div>

              <section className="panel-card">
                <h2 className="card-title" style={{ marginBottom: 16 }}>Portfolio inputs</h2>
                <div className="settings-grid">
                  <div className="set-field">
                    <label>Cash to invest</label>
                    <div className="set-desc">Uninvested CAD ready to deploy. Auto-derives from your activity CSV.</div>
                    <div className="set-input">
                      <input type="number" step="1" value={Number(cash).toFixed(2)} onChange={(e) => setCashOverride(Math.max(0, parseFloat(e.target.value) || 0))} />
                      {cashOverride != null && derivedCashVal != null && (
                        <button className="btn btn-sm" title="Use the value derived from your activity" onClick={() => setCashOverride(null)}>Auto</button>
                      )}
                    </div>
                  </div>
                  <div className="set-field">
                    <label>FX rate (CAD per USD)</label>
                    <div className="set-desc">Used to convert US-listed holdings into CAD.</div>
                    <div className="set-input">
                      <input type="number" step="0.01" value={fx} onChange={(e) => setFx(parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel-card">
                <h2 className="card-title" style={{ marginBottom: 6 }}>Data</h2>
                <div className="set-row">
                  <div className="sr-info">
                    <div className="sr-title">Upload CSV(s)</div>
                    <div className="sr-desc">Drop in your Wealthsimple holdings &amp; activity exports. Auto-detected and merged.</div>
                  </div>
                  <button className="btn" onClick={openUpload}><Icon name="upload" /> Upload CSV(s)</button>
                </div>
                <div className="set-row">
                  <div className="sr-info">
                    <div className="sr-title">Generate recommendations</div>
                    <div className="sr-desc">Package your portfolio + a research prompt for Claude.</div>
                  </div>
                  <button className="btn btn-violet" onClick={genRecs}><Icon name="sparkles" /> Generate</button>
                </div>
                <div className="set-row">
                  <div className="sr-info">
                    <div className="sr-title">Last updated</div>
                    <div className="sr-desc">The "as of" date shown across the dashboard.</div>
                  </div>
                  <span className="acct-chip"><Icon name="calendar" /> {asOf}</span>
                </div>
              </section>

              <section className="panel-card">
                <h2 className="card-title" style={{ marginBottom: 6 }}>Brokerage connection</h2>
                {snapOn ? (
                  <div className="set-row">
                    <div className="sr-info">
                      <div className="sr-title">Wealthsimple {connConnected && <span className="live-badge">● {live ? 'LIVE' : 'Linked'}</span>}</div>
                      <div className="sr-desc">{live ? `Live data · ${accountName}` : snapConfigured ? 'Account linked via SnapTrade' : 'Connect to read your live holdings — no CSVs or screenshots.'}</div>
                    </div>
                    {snapConfigured ? (
                      <div className="card-actions">
                        <button className="btn" onClick={() => setSetupOpen(true)}><Icon name="settings" /> Manage</button>
                        <button className="btn btn-primary" onClick={refreshLive} disabled={liveBusy}><Icon name="refresh" /> {liveBusy ? 'Refreshing…' : 'Refresh'}</button>
                      </div>
                    ) : (
                      <button className="btn btn-primary" onClick={() => setSetupOpen(true)}><Icon name="link" /> Connect Wealthsimple</button>
                    )}
                  </div>
                ) : (
                  <p className="hint">Live brokerage sync is available when you run the app locally with <code>npm run dev</code>. In this mode the dashboard uses your uploaded CSVs.</p>
                )}
              </section>

              <section className="panel-card">
                <h2 className="card-title" style={{ marginBottom: 6 }}>Danger zone</h2>
                <div className="set-row">
                  <div className="sr-info">
                    <div className="sr-title">Reset dashboard</div>
                    <div className="sr-desc">Erase all saved data on this device and restore the built-in defaults.</div>
                  </div>
                  <button className="btn btn-danger" onClick={resetApp}><Icon name="reset" /> Reset</button>
                </div>
              </section>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".csv" multiple hidden onChange={onFiles} />

        <footer className="foot">
          Educational only — not licensed financial advice. USD holdings converted at {fx} CAD/USD. Today's change is tracked locally and builds across daily check-ins.
        </footer>
      </main>
    </div>
  )
}
