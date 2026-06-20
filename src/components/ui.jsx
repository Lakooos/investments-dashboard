// Shared presentational UI for the redesigned dashboard. Both the personal
// (App.jsx) and partner (PartnerApp.jsx) modes render these same pieces so the
// look is identical regardless of how data is sourced. Pure presentation — no
// data fetching or business logic lives here.
import { Fragment } from 'react'
import Icon, { Logo } from './icons.jsx'
import AllocationPie from './AllocationPie.jsx'
import ValueChart from './ValueChart.jsx'
import { sellOutcome } from '../lib/portfolio.js'

/* ----------------------------- formatting helpers ----------------------------- */
export const money = (n) =>
  (n < 0 ? '-$' : '$') +
  Math.abs(Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const money0 = (n) => '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-CA')
export const pct = (n) => (n >= 0 ? '+' : '') + (Number(n) * 100).toFixed(1) + '%'
export const pct2 = (n) => (n >= 0 ? '+' : '') + (Number(n) * 100).toFixed(2) + '%'
export const signMoney = (n) => (n >= 0 ? '+' : '') + money(n)
export const SEV_ICON = { good: '✅', info: 'ℹ️', warn: '⚠️' }
export const RANGE_DAYS = { '1D': 1, '1W': 7, '1M': 30, '3M': 91, '1Y': 365, ALL: Infinity }

const AVA_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#14b8a6']
const hashCode = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
export const avaColor = (s) => AVA_COLORS[hashCode(String(s || '?')) % AVA_COLORS.length]
export const monogram = (s) => String(s || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
const avaStyle = (sym) => ({ backgroundImage: `linear-gradient(140deg, ${avaColor(sym)}, ${avaColor(sym)}b0)` })

/* ----------------------------- Sidebar ----------------------------- */
export function Sidebar({ nav, view, setView, connected, connLabel = 'Wealthsimple', logoText = 'Investments' }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark"><Logo /></span>
        <span className="logo-text">{logoText}</span>
      </div>
      <nav className="nav">
        {nav.map((n) => (
          <button key={n.id} className={'nav-item' + (view === n.id ? ' active' : '')} onClick={() => setView(n.id)}>
            <Icon name={n.icon} />
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="conn-mini">
        <span className="cm-icon"><Icon name="link" /></span>
        <div>
          <div className="cm-name">{connLabel}</div>
          <div className="cm-status"><span className={'dot ' + (connected ? 'on' : 'off')} />{connected ? 'Connected' : 'Not linked'}</div>
        </div>
      </div>
    </aside>
  )
}

/* ----------------------------- Topbar portfolio chip ----------------------------- */
export function PortfolioChip({ total, todayPct, hasBaseline, sparkVals, Sparkline }) {
  return (
    <div className="idx-chip">
      <div className="idx-meta">
        <span className="idx-name">Portfolio</span>
        <div className="idx-row">
          <span className="idx-val">{money0(total)}</span>
          <span className={'idx-chg ' + (hasBaseline && todayPct < 0 ? 'down' : 'up')}>{hasBaseline ? pct2(todayPct) : '—'}</span>
        </div>
      </div>
      {Sparkline ? <Sparkline values={sparkVals} /> : null}
    </div>
  )
}

/* ----------------------------- Hero ----------------------------- */
export function HeroCard({ summary, lifetime, today, chartSeries, range, setRange, profile, currency = 'CAD' }) {
  return (
    <section className="panel-card hero">
      <div className="hero-head">
        <div>
          <div className="hero-label">Total account value</div>
          <div className="hero-value">{money(summary.accountTotal)}<span className="ccy-unit">{currency}</span></div>
          <div className="hero-sub"><b>{money0(summary.invested)}</b> invested · <b>{money0(summary.cash)}</b> cash</div>
        </div>
        <span className="ccy-chip">{currency} <Icon name="chevronDown" /></span>
      </div>

      <div className="hero-main">
        <div className="hero-left">
          <ValueChart data={chartSeries} />
          <div className="range-tabs">
            {Object.keys(RANGE_DAYS).map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="hero-right">
          <div className="return-item">
            <div className="return-label">Unrealized Return</div>
            <div className={'return-val ' + (lifetime.price >= 0 ? 'up' : 'down')}>{signMoney(lifetime.price)}</div>
            <div className={'return-pct ' + (lifetime.price >= 0 ? 'up' : 'down')}>{pct2(lifetime.pricePct)}</div>
          </div>
          <div className="return-item">
            <div className="return-label">Total Return <Icon name="info" className="info-i" /></div>
            <div className={'return-val ' + (lifetime.total >= 0 ? 'up' : 'down')}>{signMoney(lifetime.total)}</div>
            <div className={'return-pct ' + (lifetime.total >= 0 ? 'up' : 'down')}>{pct2(lifetime.totalPct)}</div>
          </div>
        </div>
      </div>

      <div className="hero-tiles">
        <Tile icon="wallet" tone="blue" label="Cash" value={money(summary.cash)} sub={`${summary.cashPct.toFixed(2)}% of account`} valTone={summary.cashPct >= 15 ? 'warn' : ''} />
        <Tile icon="target" tone="violet" label="Satellites" value={summary.satellitePct.toFixed(1) + '%'} sub={`${money0(summary.satellite)} of invested`} valTone={summary.satellitePct > profile.maxSatellitePct ? 'warn' : ''} />
        <Tile
          icon="pulse"
          tone="green"
          label="Day Change"
          value={today.hasBaseline ? signMoney(today.changeCad) : '—'}
          sub={today.hasBaseline ? pct2(today.changePct) : 'tracking starts today'}
          valTone={!today.hasBaseline ? '' : today.changeCad > 0 ? 'up' : today.changeCad < 0 ? 'down' : ''}
        />
      </div>
    </section>
  )
}

export function Tile({ icon, tone, label, value, sub, valTone }) {
  return (
    <div className="tile">
      <span className={'tile-ico ' + tone}><Icon name={icon} /></span>
      <div className="tile-body">
        <div className="tile-label">{label}</div>
        <div className={'tile-val ' + (valTone || '')}>{value}</div>
        <div className="tile-sub">{sub}</div>
      </div>
    </div>
  )
}

/* ----------------------------- Allocation ----------------------------- */
export function AllocationCard({ pieMode, setPieMode, pieData, count }) {
  return (
    <section className="panel-card">
      <div className="card-head">
        <h2 className="card-title">Allocation</h2>
        <div className="seg seg-sm">
          <button className={pieMode === 'holding' ? 'on' : ''} onClick={() => setPieMode('holding')}>By Holding</button>
          <button className={pieMode === 'theme' ? 'on' : ''} onClick={() => setPieMode('theme')}>By Theme</button>
          <button className={pieMode === 'bucket' ? 'on' : ''} onClick={() => setPieMode('bucket')}>Core/Sat</button>
        </div>
      </div>
      <AllocationPie data={pieData} center={{ top: String(count), bottom: 'Holdings' }} />
    </section>
  )
}

/* ----------------------------- Holdings ----------------------------- */
export function HoldingsTable({ rows, fx, sellOpen, toggleSell, full }) {
  const cols = full ? 8 : 6
  return (
    <div className="table-scroll">
    <table className="holdings">
      <thead>
        <tr>
          <th>Symbol</th>
          {full && <th>Theme</th>}
          <th className="r">Shares</th>
          <th className="r">Price</th>
          <th className="r">Value (CAD)</th>
          {full && <th className="r">% Acct</th>}
          <th className="r">Unrealized P&L</th>
          <th className="r">If sold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => {
          const so = sellOutcome(h, fx)
          const open = !!sellOpen[h.symbol]
          return (
            <Fragment key={h.symbol}>
              <tr>
                <td>
                  <div className="sym-cell">
                    <span className="sym-ava" style={avaStyle(h.symbol)}>{monogram(h.symbol)}</span>
                    <div className="sym-info">
                      <div className="sym-main">{h.symbol}<span className={'pill pill-' + h.cls}>{h.cls}</span></div>
                      <div className="sym-name">{h.name}</div>
                    </div>
                  </div>
                </td>
                {full && <td>{h.theme}</td>}
                <td className="r">{h.shares == null ? '—' : h.shares}</td>
                <td className="r">{h.price == null ? '—' : h.price.toLocaleString('en-CA', { maximumFractionDigits: 2 }) + ' ' + h.currency}</td>
                <td className="r">{money(h.marketValueCad)}</td>
                {full && <td className="r">{h.pct.toFixed(1)}%</td>}
                <td className={'r ' + (h.plNative >= 0 ? 'pl-up' : 'pl-down')}>
                  <div className="pl-amt">{money(h.plNative)} {h.currency}</div>
                  <div className="pl-pct">{pct(h.plNativePct)}</div>
                </td>
                <td className="r">
                  <button
                    className={'sell-btn' + (open ? ' on' : '')}
                    onClick={() => toggleSell(h.symbol)}
                    title="What you'd actually pocket in CAD after the 1.5% FX conversion fee"
                  >
                    {so.flipsToLoss && <span className="sell-warn" title="Green on paper, but a real CAD loss after FX">⚠️</span>}
                    Sell <span className="chev">{open ? '▲' : '▼'}</span>
                  </button>
                </td>
              </tr>
              {open && (
                <tr className="sell-row">
                  <td colSpan={cols}><SellBreakdown h={h} so={so} /></td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
    </div>
  )
}

export function HoldingsPreview({ rows, fx, sellOpen, toggleSell, accountName, onViewAll }) {
  return (
    <section className="panel-card">
      <div className="card-head">
        <h2 className="card-title">Holdings</h2>
        {accountName && <span className="acct-chip"><Icon name="database" /> {accountName}</span>}
      </div>
      <HoldingsTable rows={rows} fx={fx} sellOpen={sellOpen} toggleSell={toggleSell} />
      <div style={{ marginTop: 14 }}>
        <button className="link-btn" onClick={onViewAll}>View all holdings <Icon name="arrowRight" /></button>
      </div>
    </section>
  )
}

export function LiquidationNote({ liquidation }) {
  return (
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
  )
}

/* ----------------------------- Rail cards ----------------------------- */
export function MoversCard({ movers, onViewAll }) {
  return (
    <section className="panel-card">
      <div className="card-head">
        <h2 className="card-title">Your Movers</h2>
        {onViewAll && <button className="link-btn" onClick={onViewAll}>View all</button>}
      </div>
      <div className="rail-list">
        {movers.map((h) => (
          <div className="rail-row" key={h.symbol}>
            <span className="rail-ava" style={avaStyle(h.symbol)}>{monogram(h.symbol)}</span>
            <div className="rail-info">
              <div className="rail-name">{h.symbol}</div>
              <div className="rail-meta">{h.name}</div>
            </div>
            <div className="rail-right">
              <span className={'trend-chip ' + (h.plNativePct >= 0 ? 'act-up' : 'act-down')}>{pct(h.plNativePct)}</span>
            </div>
          </div>
        ))}
        {!movers.length && <div className="empty-state"><div className="es-title">No holdings yet</div>Connect or upload to see your movers.</div>}
      </div>
    </section>
  )
}

const ACT_ICON = { deposit: 'depositIn', withdrawal: 'withdrawOut', buy: 'trendingUp', sell: 'trendingDown', dividend: 'coins', fee: 'receipt' }
export function ActivityRow({ t }) {
  const label = (t.type || '').charAt(0).toUpperCase() + (t.type || '').slice(1)
  return (
    <div className="rail-row">
      <span className="rail-ava act-ico"><Icon name={ACT_ICON[t.type] || 'activity'} /></span>
      <div className="rail-info">
        <div className="rail-name">{label}{t.symbol ? ' · ' + t.symbol : ''}</div>
        <div className="rail-meta">{t.description || t.date}</div>
      </div>
      <div className="rail-right">
        <span className={'rail-amt ' + (t.amount >= 0 ? 'act-up' : 'act-down')}>{signMoney(t.amount)}</span>
        <span className="rail-meta">{t.date}</span>
      </div>
    </div>
  )
}

export function ActivityCard({ transactions, onViewAll, onUpload }) {
  const has = transactions && transactions.length
  return (
    <section className="panel-card">
      <div className="card-head">
        <h2 className="card-title">Recent Activity</h2>
        {has && onViewAll && <button className="link-btn" onClick={onViewAll}>View all</button>}
      </div>
      {has ? (
        <div className="rail-list">{transactions.slice(0, 4).map((t, i) => <ActivityRow key={i} t={t} />)}</div>
      ) : (
        <div className="empty-state">
          <Icon name="activity" />
          <div className="es-title">No activity yet</div>
          {onUpload && <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onUpload}><Icon name="upload" /> Upload activity CSV</button>}
        </div>
      )}
    </section>
  )
}

// Flexible connection card. buttons: [{label, onClick, kind:'primary'|'ghost', icon, disabled}]
export function ConnectionCard({ connected, badge, buttons = [], note }) {
  return (
    <section className="panel-card conn-card">
      <div className="conn-art">
        <div className="conn-ring" />
        <div className="conn-orb" />
      </div>
      <div className="conn-name">Wealthsimple</div>
      <div className={'conn-badge' + (connected ? '' : ' off')}>
        <span className={'dot ' + (connected ? 'on' : 'off')} />{badge}
      </div>
      {note
        ? <p className="hint" style={{ textAlign: 'center', margin: 0 }}>{note}</p>
        : buttons.map((b, i) => (
            <button
              key={i}
              className={'btn btn-block ' + (b.kind === 'ghost' ? 'btn-ghost' : 'btn-primary')}
              style={i ? { marginTop: 10 } : undefined}
              onClick={b.onClick}
              disabled={b.disabled}
            >
              {b.icon && <Icon name={b.icon} />} {b.label}
            </button>
          ))}
    </section>
  )
}

/* ----------------------------- Insights ----------------------------- */
export function QuickRules({ recs, playbook, pbLevel, setPbLevel, setPbSeed, profile, levels }) {
  return (
    <section className="panel-card">
      <h2 className="card-title" style={{ marginBottom: 12 }}>Quick rules <span className="tag">{profile.risk}</span></h2>
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

      <div className="pb-head"><p className="rules-sub">📌 Pinned for your situation now</p></div>
      <ul className="recs">
        {playbook.pinned.map((r) => (
          <li key={r.title} className={'rec rule rule-' + r.level}>
            <div className="rec-title"><span className={'lvl lvl-' + r.level}>{r.level}</span>{r.title}</div>
            <div className="rec-text">{r.text}</div>
            {r.reason && <div className="rec-action">📌 {r.reason}</div>}
          </li>
        ))}
      </ul>

      <div className="pb-head">
        <p className="rules-sub">More to learn · rotates each visit</p>
        <div className="seg seg-sm">
          {['all', ...levels].map((l) => (
            <button key={l} className={pbLevel === l ? 'on' : ''} onClick={() => { setPbLevel(l); setPbSeed(0) }}>
              {l === 'all' ? 'All' : l[0].toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <ul className="recs">
        {playbook.batch.map((r) => (
          <li key={r.title} className={'rec rule rule-' + r.level}>
            <div className="rec-title"><span className={'lvl lvl-' + r.level}>{r.level}</span>{r.title}</div>
            <div className="rec-text">{r.text}</div>
          </li>
        ))}
      </ul>
      <div className="pb-foot">
        <button className="btn btn-sm" onClick={() => setPbSeed((s) => s + 1)}><Icon name="refresh" /> Next tips</button>
        <span className="muted">{playbook.pinned.length} pinned live · rotating {playbook.batch.length} of {playbook.poolLen} · {playbook.total} rules total</span>
      </div>
    </section>
  )
}

export function LifetimeReturns({ lifetime, hasActivity, note }) {
  return (
    <section className="panel-card">
      <h2 className="card-title" style={{ marginBottom: 14 }}>Lifetime returns</h2>
      <div className="life">
        <LifeStat big label="Unrealized gain/loss" value={money(lifetime.price)} sub={pct(lifetime.pricePct) + ' · market value − cost (paper, not yet sold)'} tone={lifetime.price >= 0 ? 'up' : 'down'} />
        <LifeStat label="Dividends (tax-free)" value={hasActivity ? money(lifetime.dividends) : '—'} sub={hasActivity ? 'received' : 'no data yet'} tone={lifetime.dividends > 0 ? 'up' : undefined} />
        <LifeStat label="Fees paid" value={hasActivity ? '-' + money(lifetime.fees).replace('-', '') : '—'} sub={hasActivity ? 'FX / commissions' : 'no data yet'} tone={lifetime.fees > 0 ? 'down' : undefined} />
        <LifeStat label="Total return (incl. div − fees)" value={money(lifetime.total)} sub={pct(lifetime.totalPct)} tone={lifetime.total >= 0 ? 'up' : 'down'} />
      </div>
      {note && <p className="hint">{note}</p>}
    </section>
  )
}

export function LifeStat({ label, value, sub, tone, big }) {
  return (
    <div className={'lifestat' + (big ? ' lifestat-big' : '')}>
      <div className="card-label">{label}</div>
      <div className={'lifestat-value' + (tone === 'up' ? ' up' : tone === 'down' ? ' down' : '')}>{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )
}

/* ----------------------------- Sell breakdown ----------------------------- */
export function SellBreakdown({ h, so }) {
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
        <span className={'r sellout-strong ' + (so.realPl >= 0 ? 'up' : 'down')}>{money(so.realPl)} ({pct(so.realPlPct)})</span>
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
