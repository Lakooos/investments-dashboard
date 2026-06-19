import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import AllocationPie from './components/AllocationPie.jsx'
import ImportActivityModal from './components/ImportActivityModal.jsx'
import { buildSnapshot, buildPrompt, copyAndDownload } from './lib/aiBridge.js'
import { enrich, summarize, recommend, sellOutcome, selectPinnedRules } from './lib/portfolio.js'
import { applyImportedTrades } from './lib/importTrades.js'
import { parseHoldingsCsv, parseActivityCsv, detectCsvKind } from './lib/parseCsv.js'
import { loadHistory, prevEntry, computeTodayChange, recordToday, todayStr } from './lib/history.js'
import { SEED_HOLDINGS, DEFAULT_FX, PROFILE, AS_OF } from './data/holdings.js'
import { INVESTING_RULES, PB_LEVELS } from './data/investingRules.js'

const money = (n) =>
  (n < 0 ? '-$' : '$') +
  Math.abs(Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (n) => '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-CA')
const pct = (n) => (n >= 0 ? '+' : '') + (Number(n) * 100).toFixed(1) + '%'
const SEV_ICON = { good: '✅', info: 'ℹ️', warn: '⚠️' }
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
// Assumes buy-and-hold (no sells); add realized proceeds if that changes.
const sumBook = (hs) => hs.reduce((s, h) => s + (Number(h.bookCad) || 0), 0)
const derivedCash = (a, hs) =>
  Math.max(0, a.contributionsTotal - sumBook(hs) + a.dividends + (a.interest || 0) - a.fees)

export default function App() {
  const [holdings, setHoldings] = useState(() => loadJSON(LS.holdings, SEED_HOLDINGS))
  const [fx, setFx] = useState(() => loadJSON(LS.fx, DEFAULT_FX))
  const [activity, setActivity] = useState(() => loadJSON(LS.activity, null))
  // Manual cash override; null means "use the value derived from activity".
  const [cashOverride, setCashOverride] = useState(() => loadJSON(LS.cashOverride, null))
  const [asOf, setAsOf] = useState(() => loadJSON(LS.asOf, AS_OF))
  const [pieMode, setPieMode] = useState('holding') // holding | theme | bucket
  const [sellOpen, setSellOpen] = useState({}) // symbol -> bool: "Sell outcome" row expanded
  const [note, setNote] = useState('')
  const [pbLevel, setPbLevel] = useState('all') // playbook level filter: all | beginner | ...
  const [pbSeed, setPbSeed] = useState(0) // bump to rotate to the next batch of tips
  const [importOpen, setImportOpen] = useState(false) // "Paste activity screenshot" modal
  const fileRef = useRef(null)

  // Cash auto-derives from stored activity + current holdings unless manually overridden.
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

  // --- Investing playbook --------------------------------------------------
  // PINNED = chosen live from the current portfolio (prices, allocation, cash, FX,
  // per-holding P&L), so the set shifts as your situation changes — not a fixed list.
  // The REST rotate a few at a time (daily + "Next tips") so the whole library gets
  // surfaced over many visits.
  const PB_BATCH = 5
  const pinnedRules = useMemo(() => selectPinnedRules(stats, PROFILE, INVESTING_RULES), [stats])
  const playbook = useMemo(() => {
    const pinnedTitles = new Set(pinnedRules.map((r) => r.title))
    const inLevel = (r) => pbLevel === 'all' || r.level === pbLevel
    const pool = INVESTING_RULES.filter((r) => inLevel(r) && !pinnedTitles.has(r.title))
    const day = Math.floor(Date.now() / 86_400_000) // days since epoch → daily rotation
    const n = Math.min(PB_BATCH, pool.length)
    const start = pool.length ? ((((day + pbSeed) * PB_BATCH) % pool.length) + pool.length) % pool.length : 0
    const batch = Array.from({ length: n }, (_, i) => pool[(start + i) % pool.length])
    return { pinned: pinnedRules, batch, poolLen: pool.length, total: INVESTING_RULES.length }
  }, [pinnedRules, pbLevel, pbSeed])

  // --- Today's gain/loss (day-over-day, from localStorage) ---
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

  // --- Lifetime returns ---
  const lifetime = useMemo(() => {
    const price = summary.plCad // unrealized $ on current holdings (market - book)
    const dividends = activity?.dividends || 0
    const fees = activity?.fees || 0
    const total = price + dividends - fees
    const totalPct = summary.book ? total / summary.book : 0
    return { price, pricePct: summary.plPct, dividends, fees, total, totalPct }
  }, [summary, activity])

  const toggleSell = (sym) => setSellOpen((m) => ({ ...m, [sym]: !m[sym] }))

  // --- "If I liquidated everything right now" (real CAD, after FX fees) ---
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

  const center = {
    value: today.changeCad,
    pct: today.changePct,
    hasBaseline: today.hasBaseline,
    tone: !today.hasBaseline || today.changeCad === 0 ? 'flat' : today.changeCad > 0 ? 'up' : 'down',
  }

  // Package the live portfolio + a prompt for Claude, copy + download it.
  // You paste it to Claude (this terminal); Claude researches + writes the file.
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

  // One smart handler: accepts one or many CSVs, auto-detects holdings vs activity,
  // parses each with the right parser, and updates the matching data.
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
      setCashOverride(null) // use the freshly derived cash
    }
    if (newHoldings || newActivity) setAsOf(todayStr())

    // Note: compute cash from the effective (possibly just-uploaded) data.
    const effHoldings = newHoldings || holdings
    const effActivity = newActivity || activity
    const cashNote =
      effActivity && cashOverride == null ? ` Cash = ${money(derivedCash(effActivity, effHoldings))}.` : ''
    setNote([...ok, ...errs].join(' · ') + cashNote)
  }

  // Merge trades scraped from a pasted Activity screenshot. Updates holdings book
  // values (so cash re-derives), records the transactions, and re-derives cash.
  function onImportTrades(rows) {
    setImportOpen(false)
    if (!rows.length) return
    const { holdings: h2, activity: a2, notes } = applyImportedTrades({ holdings, activity, fx }, rows)
    setHoldings(h2)
    setActivity(a2)
    setCashOverride(null) // re-derive cash from the updated book values
    setAsOf(todayStr())
    const n = rows.length
    setNote(
      `✅ Imported ${n} trade${n === 1 ? '' : 's'} from your screenshot — recent activity, cash & allocation updated.` +
        (notes.length ? ' ' + notes.join(' ') : '') +
        ' New positions show as “est.” until you upload a holdings-report CSV (which fills in exact shares & price).',
    )
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <div>
          <h1>Investments Dashboard</h1>
          <p className="sub">
            {PROFILE.name} · <span className="risk">{PROFILE.risk} risk</span> · tilted to space + AI · as of {asOf}
          </p>
        </div>
        <div className="controls">
          <label className="fld">
            Cash to invest{' '}
            <input
              type="number"
              step="1"
              value={Number(cash).toFixed(2)}
              onChange={(e) => setCashOverride(Math.max(0, parseFloat(e.target.value) || 0))}
            />
            {cashOverride != null && derivedCashVal != null && (
              <button className="link" title="Use the value derived from your activity" onClick={() => setCashOverride(null)}>
                auto
              </button>
            )}
          </label>
          <label className="fld">
            FX CAD/USD{' '}
            <input type="number" step="0.01" value={fx} onChange={(e) => setFx(parseFloat(e.target.value) || 0)} />
          </label>
          <button onClick={() => fileRef.current?.click()}>Upload CSV(s)</button>
          <input ref={fileRef} type="file" accept=".csv" multiple hidden onChange={onFiles} />
          <button onClick={() => setImportOpen(true)} title="Paste a screenshot of your Wealthsimple Activity list to catch up trades the CSV export hasn't included yet">📋 Paste activity</button>
          <button className="primary" onClick={genRecs}>✨ Generate recommendations</button>
        </div>
      </header>

      <ImportActivityModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={onImportTrades}
        existingTxns={activity?.transactions || []}
      />

      {note && <div className="note">{note}</div>}

      <section className="cards">
        <Card label="Total account value" value={money(summary.accountTotal)} sub={`${money0(summary.invested)} invested + ${money0(summary.cash)} cash`} />
        <Card label="Cash ready to invest" value={money(summary.cash)} sub={`${summary.cashPct.toFixed(1)}% of account`} tone={summary.cashPct >= 15 ? 'warn' : undefined} />
        <Card
          label="Today"
          value={today.hasBaseline ? (today.changeCad >= 0 ? '+' : '-') + money(today.changeCad).replace('-', '') : '—'}
          sub={today.hasBaseline ? pct(today.changePct) : 'tracking starts today'}
          tone={!today.hasBaseline ? undefined : today.changeCad > 0 ? 'up' : today.changeCad < 0 ? 'down' : undefined}
        />
        <Card
          label="Satellites (of invested)"
          value={summary.satellitePct.toFixed(1) + '%'}
          sub={money0(summary.satellite)}
          tone={summary.satellitePct > PROFILE.maxSatellitePct ? 'warn' : undefined}
        />
      </section>

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Allocation</h2>
            <div className="seg">
              <button className={pieMode === 'holding' ? 'on' : ''} onClick={() => setPieMode('holding')}>By holding</button>
              <button className={pieMode === 'theme' ? 'on' : ''} onClick={() => setPieMode('theme')}>By theme</button>
              <button className={pieMode === 'bucket' ? 'on' : ''} onClick={() => setPieMode('bucket')}>Core vs satellite</button>
            </div>
          </div>
          <AllocationPie data={pieData} center={center} />
        </section>

        <section className="panel">
          <h2>Quick rules <span className="tag">{PROFILE.risk}</span></h2>
          <p className="rules-sub">Tailored to your portfolio right now</p>
          <ul className="recs">
            {recs.map((r, i) => (
              <li key={i} className={'rec rec-' + r.sev}>
                <div className="rec-title"><span className="rec-ico">{SEV_ICON[r.sev]}</span>{r.title}</div>
                <div className="rec-text">{r.text}</div>
                {r.action && <div className="rec-action">→ {r.action}</div>}
              </li>
            ))}
          </ul>

          <div className="pb-head">
            <p className="rules-sub">📌 Pinned for your situation now</p>
          </div>
          <ul className="recs">
            {playbook.pinned.map((r) => (
              <li key={r.title} className={'rec rule rule-' + r.level}>
                <div className="rec-title">
                  <span className={'lvl lvl-' + r.level}>{r.level}</span>
                  {r.title}
                </div>
                <div className="rec-text">{r.text}</div>
                {r.reason && <div className="rec-action">📌 {r.reason}</div>}
              </li>
            ))}
          </ul>

          <div className="pb-head">
            <p className="rules-sub">More to learn · rotates each visit</p>
            <div className="seg seg-sm">
              {['all', ...PB_LEVELS].map((l) => (
                <button key={l} className={pbLevel === l ? 'on' : ''} onClick={() => { setPbLevel(l); setPbSeed(0) }}>
                  {l === 'all' ? 'All' : l[0].toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <ul className="recs">
            {playbook.batch.map((r) => (
              <li key={r.title} className={'rec rule rule-' + r.level}>
                <div className="rec-title">
                  <span className={'lvl lvl-' + r.level}>{r.level}</span>
                  {r.title}
                </div>
                <div className="rec-text">{r.text}</div>
              </li>
            ))}
          </ul>
          <div className="pb-foot">
            <button onClick={() => setPbSeed((s) => s + 1)}>↻ Next tips</button>
            <span className="muted">
              {playbook.pinned.length} pinned live · rotating {playbook.batch.length} of {playbook.poolLen} · {playbook.total} rules total
            </span>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Lifetime returns</h2>
        <div className="life">
          <LifeStat
            big
            label="Unrealized gain/loss"
            value={money(lifetime.price)}
            sub={pct(lifetime.pricePct) + ' · market value − cost (paper, not yet sold)'}
            tone={lifetime.price >= 0 ? 'up' : 'down'}
          />
          <LifeStat label="Dividends (tax-free)" value={activity ? money(lifetime.dividends) : '—'} sub={activity ? 'received' : 'upload activity'} tone={lifetime.dividends > 0 ? 'up' : undefined} />
          <LifeStat label="Fees paid" value={activity ? '-' + money(lifetime.fees).replace('-', '') : '—'} sub={activity ? 'FX / commissions' : 'upload activity'} tone={lifetime.fees > 0 ? 'down' : undefined} />
          <LifeStat label="Total return (incl. div − fees)" value={money(lifetime.total)} sub={pct(lifetime.totalPct)} tone={lifetime.total >= 0 ? 'up' : 'down'} />
        </div>
        {!activity && <p className="hint">Upload your activity CSV to include dividends, fees, and TFSA contributions in the lifetime total.</p>}
      </section>

      <section className="panel">
        <h2>Holdings</h2>
        <table className="holdings">
          <thead>
            <tr><th>Symbol</th><th>Theme</th><th className="r">Shares</th><th className="r">Price</th><th className="r">Value (CAD)</th><th className="r">% of acct</th><th className="r">Unrealized P&L</th><th className="r">If I sold now</th></tr>
          </thead>
          <tbody>
            {summary.byHolding.map((h) => {
              const so = sellOutcome(h, fx)
              const open = !!sellOpen[h.symbol]
              return (
                <Fragment key={h.symbol}>
                  <tr>
                    <td>
                      <strong>{h.symbol}</strong>
                      <span className={'pill pill-' + h.cls}>{h.cls}</span>
                      {h.estimated && <span className="pill pill-est" title="Added from a screenshot — exact shares & price fill in on your next holdings-report CSV upload">est.</span>}
                      <div className="muted">{h.name}</div>
                    </td>
                    <td>{h.theme}</td>
                    <td className="r">{h.shares == null ? '—' : h.shares}</td>
                    <td className="r">{h.price == null ? '—' : h.price.toLocaleString('en-CA', { maximumFractionDigits: 2 }) + ' ' + h.currency}</td>
                    <td className="r">{money(h.marketValueCad)}</td>
                    <td className="r">{h.pct.toFixed(1)}%</td>
                    <td className={'r ' + (h.plNative >= 0 ? 'up' : 'down')}>{money(h.plNative)} {h.currency} <span className="muted">({pct(h.plNativePct)})</span></td>
                    <td className="r">
                      <button
                        className={'sell-btn' + (open ? ' on' : '')}
                        onClick={() => toggleSell(h.symbol)}
                        title="What you'd actually pocket in CAD after the 1.5% FX conversion fee"
                      >
                        {so.flipsToLoss && <span className="sell-warn" title="Green on paper, but a real CAD loss after FX">⚠️</span>}
                        Sell outcome <span className="chev">{open ? '▲' : '▾'}</span>
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="sell-row">
                      <td colSpan={8}><SellBreakdown h={h} so={so} /></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <div className={'liq ' + (liquidation.realPl >= 0 ? 'up' : 'down')}>
          <strong>Worst case — sell everything &amp; convert back to CAD:</strong> you'd net {money(liquidation.net)} CAD
          {liquidation.fees > 0 && <> after {money(liquidation.fees)} in FX fees</>} — a real{' '}
          {liquidation.realPl >= 0 ? 'gain' : 'loss'} of {money(liquidation.realPl)} ({pct(liquidation.realPlPct)}) vs what you paid.
          {liquidation.fees > 0 && (
            <div className="liq-note">
              The {money(liquidation.fees)} fee only applies if you sell <em>and</em> convert USD → CAD on a standard
              account. Keep the proceeds in USD (or use a Wealthsimple USD account) and there's no conversion fee.
            </div>
          )}
        </div>
      </section>

      {activity && (
        <section className="panel">
          <h2>Recent activity</h2>
          <table className="holdings">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Symbol</th><th className="r">Cash impact</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {activity.transactions.slice(0, 12).map((t, i) => (
                <tr key={i}>
                  <td>{t.date}</td>
                  <td><span className={'pill pill-' + t.type}>{t.type}</span></td>
                  <td>{t.symbol || '—'}</td>
                  <td className={'r ' + (t.amount >= 0 ? 'up' : 'down')}>{money(t.amount)}</td>
                  <td className="muted">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="foot">
        Educational only — not licensed financial advice. USD holdings converted at {fx} CAD/USD. Today's change is tracked locally and builds across daily check-ins.
      </footer>
    </div>
  )
}

function Card({ label, value, sub, tone }) {
  return (
    <div className={'card' + (tone ? ' card-' + tone : '')}>
      <div className="card-label">{label}</div>
      <div className={'card-value' + (tone === 'up' ? ' up' : tone === 'down' ? ' down' : '')}>{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}

// Breakdown shown when you click "Sell outcome": walks USD → CAD → minus the FX fee
// so you can see how a position that's green in its own currency can net a CAD loss.
function SellBreakdown({ h, so }) {
  const nativeAmt = (n) =>
    Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + so.currency
  return (
    <div className="sellout">
      <div className="sellout-title">If you sold {h.symbol} ({h.name}) right now</div>
      <div className="sellout-grid">
        <span>Market value</span>
        <span className="r">{nativeAmt(so.marketValueNative)}</span>

        {so.isUsd ? (
          <>
            <span>Converted to CAD (× {so.rate})</span>
            <span className="r">{money(so.grossCad)}</span>
            <span>FX conversion fee ({(so.fxFee * 100).toFixed(1)}%)</span>
            <span className="r down">−{money(so.feeCad).replace('-', '')}</span>
          </>
        ) : (
          <>
            <span>FX fee</span>
            <span className="r muted">none · CAD-listed</span>
          </>
        )}

        <span className="sellout-strong">You'd receive (CAD)</span>
        <span className="r sellout-strong">{money(so.netCad)}</span>
        <span>Your cost (book)</span>
        <span className="r">{money(so.bookCad)}</span>

        <span className="sellout-strong">Real gain/loss if sold now</span>
        <span className={'r sellout-strong ' + (so.realPl >= 0 ? 'up' : 'down')}>
          {money(so.realPl)} ({pct(so.realPlPct)})
        </span>
      </div>
      {so.flipsToLoss ? (
        <div className="sellout-flag warn">
          ⚠️ Looks like +{money(so.paperNative)} {so.currency} on paper, but after the{' '}
          {(so.fxFee * 100).toFixed(1)}% FX fee you'd actually <b>lose {money(Math.abs(so.realPl)).replace('-', '')}</b> in real CAD.
        </div>
      ) : so.realPl >= 0 ? (
        <div className="sellout-flag good">✅ You'd actually pocket {money(so.realPl)} in CAD after FX &amp; fees.</div>
      ) : (
        <div className="sellout-flag down">🔴 Down {money(Math.abs(so.realPl)).replace('-', '')} in real CAD terms{so.isUsd ? ' (FX fee included)' : ''}.</div>
      )}
      {so.isUsd && (
        <div className="sellout-note">
          Assumes you convert the proceeds back to CAD on a standard account (1.5%). Keep them in USD — or use a
          Wealthsimple USD account — and this fee is $0.
        </div>
      )}
    </div>
  )
}

function LifeStat({ label, value, sub, tone, big }) {
  return (
    <div className={'lifestat' + (big ? ' lifestat-big' : '')}>
      <div className="card-label">{label}</div>
      <div className={'lifestat-value' + (tone === 'up' ? ' up' : tone === 'down' ? ' down' : '')}>{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}
