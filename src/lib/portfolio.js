// Pure functions: turn raw holdings (+ cash) into CAD values, allocations, and
// medium-high-risk recommendations. No React in here so it's easy to reason about.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Add CAD market value (for totals, uses FX) AND native-currency P&L (for the
// holdings table, matches Wealthsimple exactly and is FX-independent).
export function enrich(holdings, fx) {
  return holdings.map((h) => {
    const rate = h.currency === 'USD' ? fx : 1
    const marketValueNative = h.marketValueNative != null ? h.marketValueNative : round2(h.shares * h.price)
    const marketValueCad = round2(marketValueNative * rate)
    const bookCad = round2(h.bookCad)
    const plCad = round2(marketValueCad - bookCad) // home-currency P&L (incl. FX move)

    // Native P&L: prefer Wealthsimple's own figure; else market − book in native ccy.
    const bookNative = h.bookNative != null ? h.bookNative : h.currency === 'CAD' ? bookCad : null
    const plNative =
      h.plNative != null ? round2(h.plNative) : bookNative != null ? round2(marketValueNative - bookNative) : plCad
    const plNativePct = bookNative ? plNative / bookNative : bookCad ? plNative / bookCad : 0

    return { ...h, rate, marketValueNative, marketValueCad, bookCad, bookNative, plCad, plPct: bookCad ? plCad / bookCad : 0, plNative, plNativePct }
  })
}

// cash = uninvested CAD sitting in the account ("dry powder").
export function summarize(enriched, cash = 0) {
  cash = Math.max(0, Number(cash) || 0)
  const invested = enriched.reduce((s, h) => s + h.marketValueCad, 0)
  const accountTotal = invested + cash
  const book = enriched.reduce((s, h) => s + h.bookCad, 0)
  const core = enriched.filter((h) => h.cls === 'core').reduce((s, h) => s + h.marketValueCad, 0)
  const satellite = enriched
    .filter((h) => h.cls === 'satellite')
    .reduce((s, h) => s + h.marketValueCad, 0)

  const ofInvested = (v) => (invested ? (v / invested) * 100 : 0)
  const ofAccount = (v) => (accountTotal ? (v / accountTotal) * 100 : 0)

  // % of account by holding (what the pie chart shows). pct = share of the WHOLE account.
  const byHolding = enriched
    .map((h) => ({ ...h, pct: ofAccount(h.marketValueCad), pctInvested: ofInvested(h.marketValueCad) }))
    .sort((a, b) => b.marketValueCad - a.marketValueCad)

  // % by theme bucket (of the whole account).
  const themeMap = {}
  enriched.forEach((h) => {
    themeMap[h.theme] = (themeMap[h.theme] || 0) + h.marketValueCad
  })
  const byTheme = Object.entries(themeMap)
    .map(([theme, value]) => ({ theme, value: round2(value), pct: ofAccount(value) }))
    .sort((a, b) => b.value - a.value)

  return {
    invested: round2(invested),
    cash: round2(cash),
    accountTotal: round2(accountTotal),
    cashPct: ofAccount(cash),
    book: round2(book),
    plCad: round2(invested - book),
    plPct: book ? (invested - book) / book : 0,
    core: round2(core),
    satellite: round2(satellite),
    // core/satellite split is measured against INVESTED money (cash is separate dry powder).
    corePct: ofInvested(core),
    satellitePct: ofInvested(satellite),
    byHolding,
    byTheme,
  }
}

// --- "If I sold right now" -------------------------------------------------
// Wealthsimple charges no stock commission, but converting USD sale proceeds back
// to CAD costs ~1.5% (the same FX fee you paid on the way in). That exit fee — plus
// wherever the loonie sits today — can turn a position that's GREEN in US dollars
// into a real CAD loss. sellOutcome models the actual cash you'd net.
export const FX_FEE = 0.015 // Wealthsimple FX conversion fee (~1.5% per USD trade)

export function sellOutcome(h, fx, fxFee = FX_FEE) {
  const isUsd = h.currency === 'USD'
  const rate = isUsd ? fx : 1
  const marketValueNative = h.marketValueNative != null ? h.marketValueNative : round2(h.shares * h.price)
  const grossCad = round2(marketValueNative * rate) // proceeds before the FX fee
  const feeCad = isUsd ? round2(grossCad * fxFee) : 0 // CAD-listed: no conversion, no fee
  const netCad = round2(grossCad - feeCad) // what actually lands in your account
  const bookCad = round2(h.bookCad) // what you paid (already includes entry FX)
  const realPl = round2(netCad - bookCad) // real gain/loss in CAD if you sold now
  const realPlPct = bookCad ? realPl / bookCad : 0
  // The figure the holdings table shows (native currency) — what looks green/red in WS.
  const paperNative = h.plNative != null ? round2(h.plNative) : null
  // The gotcha: looks like a gain in its own currency, but is a real CAD loss after FX.
  const flipsToLoss = isUsd && paperNative != null && paperNative >= 0 && realPl < 0
  return { isUsd, currency: h.currency, marketValueNative, rate, grossCad, fxFee, feeCad, netCad, bookCad, realPl, realPlPct, paperNative, flipsToLoss }
}

// --- Live "pinned" playbook rules ------------------------------------------
// Picks which educational rules to PIN based on the current portfolio, so the
// pinned set shifts with prices, allocation, cash, FX, and per-holding P&L —
// instead of being a fixed list. Returns rules decorated with a `reason` saying
// WHY each was surfaced. `rules` is the INVESTING_RULES library.
export function selectPinnedRules(stats, profile, rules, max = 5) {
  const pct0 = (n) => Math.round(n)
  const picks = []
  const used = new Set()
  // Pull the first rule carrying `tag` that we haven't shown yet, tagging it with `reason`.
  const pin = (tag, reason) => {
    if (picks.length >= max) return
    const r = rules.find((x) => (x.tags || []).includes(tag) && !used.has(x.title))
    if (r) {
      used.add(r.title)
      picks.push({ ...r, reason })
    }
  }

  const byHolding = stats.byHolding || []
  // 1) Single-name concentration — a satellite above the single-name guardrail.
  const hot = byHolding.find((h) => h.cls === 'satellite' && h.pct > profile.maxSingleNamePct)
  if (hot) pin('concentration', `${hot.symbol} is ${pct0(hot.pct)}% of the account — above your ~${profile.maxSingleNamePct}% single-name cap`)
  // 2) Satellite sleeve running hot vs the target.
  if (stats.satellitePct > profile.maxSatellitePct) pin('rebalance', `Satellites are ${pct0(stats.satellitePct)}% of invested vs a ${profile.satelliteTargetPct}% target`)
  // 3) Idle cash piling up.
  if (stats.cashPct >= 15) pin('cash', `${pct0(stats.cashPct)}% of the account is sitting in cash`)
  // 4) A holding in a real drawdown.
  const down = byHolding.find((h) => h.plNativePct <= -0.15)
  if (down) pin('drawdown', `${down.symbol} is down ${pct0(Math.abs(down.plNativePct) * 100)}%`)
  // 5) A holding running hot (paper gain) — think about trimming / mean reversion.
  const up = byHolding.find((h) => h.plNativePct >= 0.2)
  if (up) pin('winners', `${up.symbol} is up ${pct0(up.plNativePct * 100)}%`)
  // 6) Concentrated macro tilt.
  const tilt = (stats.byTheme || [])
    .filter((t) => profile.tiltThemes.includes(t.theme))
    .reduce((s, t) => s + t.pct, 0)
  if (tilt > 55) pin('macro', `${pct0(tilt)}% of the account sits in your space + AI tilt`)
  // 7) FX exposure — any US-listed holding.
  if (byHolding.some((h) => h.currency === 'USD')) pin('fx', 'You hold US-listed stocks — ~1.5% FX on each CAD↔USD conversion')
  // 8) Whole book underwater on paper.
  if (stats.plPct < 0) pin('behavior', `Your book is down ${(Math.abs(stats.plPct) * 100).toFixed(1)}% on paper`)
  // 9) TFSA reminder (almost always available as a backstop).
  pin('tfsa', 'Held in a TFSA — keep it tax-efficient')

  // Backfill with evergreen principles so there's always a useful set.
  for (const r of rules) {
    if (picks.length >= max) break
    if ((r.tags || []).includes('evergreen') && !used.has(r.title)) {
      used.add(r.title)
      picks.push({ ...r, reason: 'Core principle for your long runway' })
    }
  }
  return picks
}

// Recommendation engine for a MEDIUM-HIGH risk, growth-tilted portfolio.
// `stats` is the summarize() output, optionally extended with { contributionsThisYear }.
// Returns an array of {sev, title, text, action}. Always returns at least one item.
export function recommend(stats, profile) {
  const recs = []
  const fmt = (n) => '$' + Math.abs(Math.round(n)).toLocaleString('en-CA')
  const pp = (n) => n.toFixed(1) + '%'

  // 1) Cash ready to invest — dry powder, measured against the whole account.
  if (stats.cash > 0) {
    if (stats.cashPct >= 15) {
      recs.push({
        sev: 'warn',
        title: 'Lots of cash sitting idle',
        text: `${fmt(stats.cash)} (${pp(stats.cashPct)} of the account) is uninvested.`,
        action: `Cash earns ~nothing long term. Dollar-cost-average it in on a schedule — buy the core (VFV/XEQT) first, then top up your space/AI tilt. Don't wait to "time" a dip.`,
      })
    } else if (stats.cash >= 100) {
      recs.push({
        sev: 'info',
        title: 'Some dry powder to deploy',
        text: `${fmt(stats.cash)} (${pp(stats.cashPct)}) is ready to invest.`,
        action: 'Roll it into your next scheduled buy rather than letting it pile up.',
      })
    }
  } else {
    recs.push({
      sev: 'info',
      title: 'Add your cash balance',
      text: 'No cash entered yet — enter your Wealthsimple cash (or upload an activity CSV) for an accurate total and allocation.',
      action: 'Use the “Cash ready to invest” box up top.',
    })
  }

  // 2) Core vs satellite sleeve vs the 60/40 medium-high target (of invested money).
  if (stats.invested > 0) {
    if (stats.satellitePct > profile.maxSatellitePct) {
      const overCad = ((stats.satellitePct - profile.satelliteTargetPct) / 100) * stats.invested
      recs.push({
        sev: 'warn',
        title: 'Growth sleeve is running hot',
        text: `Satellites are ${pp(stats.satellitePct)} of invested money vs a ${profile.satelliteTargetPct}% target (cap ~${profile.maxSatellitePct}%).`,
        action: `Point the next ~${fmt(overCad)} of buys at the core (VFV/XEQT) instead of more thematic names. You stay aggressive, just less concentrated.`,
      })
    } else if (stats.satellitePct < profile.satelliteTargetPct - 7) {
      recs.push({
        sev: 'good',
        title: 'Room to add growth',
        text: `Satellites are only ${pp(stats.satellitePct)} of invested vs a ${profile.satelliteTargetPct}% target.`,
        action: `Medium-high risk leaves room to add your tilt themes (${profile.tiltThemes.join(', ')}) on the next buy.`,
      })
    } else {
      recs.push({
        sev: 'good',
        title: 'Core/satellite split is on target',
        text: `Core ${pp(stats.corePct)} / satellites ${pp(stats.satellitePct)} of invested — close to the ${profile.coreTargetPct}/${profile.satelliteTargetPct} medium-high target.`,
        action: 'Keep dollar-cost-averaging on schedule; let winners run within the guardrails below.',
      })
    }
  }

  // 3) Single-name concentration (of the WHOLE account, incl. cash).
  const hot = stats.byHolding.filter(
    (h) => h.cls === 'satellite' && h.pct > profile.maxSingleNamePct,
  )
  hot.forEach((h) => {
    recs.push({
      sev: 'warn',
      title: `${h.symbol} is a big single bet`,
      text: `${h.symbol} (${h.theme}) is ${pp(h.pct)} of the whole account — above the ~${profile.maxSingleNamePct}% single-name guardrail.`,
      action: `Let it ride but stop adding; trim back toward ~${profile.maxSingleNamePct}% if it keeps growing.`,
    })
  })

  // 4) TFSA room — only meaningful once activity (contributions) is loaded.
  if (typeof stats.contributionsThisYear === 'number') {
    const room = profile.tfsaAnnualLimit - stats.contributionsThisYear
    recs.push({
      sev: room < 500 ? 'warn' : 'info',
      title: 'TFSA contribution room',
      text: `From your uploaded activity, deposits this year total ${fmt(stats.contributionsThisYear)} of the ${fmt(profile.tfsaAnnualLimit)} limit — about ${fmt(room)} left (only accurate if you exported FULL history).`,
      action:
        room < 0
          ? 'You may be over the limit — verify in CRA My Account (1%/month penalty on overcontributions).'
          : 'Confirm the exact figure in CRA My Account before adding new outside money.',
    })
  }

  // 5) Theme tilt confirmation — you deliberately overweight space + AI.
  const tiltValue = stats.byTheme
    .filter((t) => profile.tiltThemes.includes(t.theme))
    .reduce((s, t) => s + t.pct, 0)
  if (tiltValue > 0) {
    recs.push({
      sev: 'info',
      title: 'Space + AI tilt is live',
      text: `${pp(tiltValue)} of the account sits in your tilt themes (${profile.tiltThemes.join(', ')}).`,
      action:
        tiltValue > 55
          ? 'That is a strong bet on one macro theme. Great if it works, rough in a tech selloff — plan is to HOLD, not panic-sell.'
          : 'On track. Add to the cheapest/most-beaten-down theme name rather than the one that just ran.',
    })
  }

  // 6) FX reminder — US-listed holdings cost ~1.5% per trade.
  const usdHoldings = stats.byHolding.filter((h) => h.currency === 'USD')
  if (usdHoldings.length > 0) {
    const usdList = usdHoldings.map((h) => h.symbol).join(', ')
    recs.push({
      sev: 'info',
      title: 'Keep US-stock churn low',
      text: `${usdHoldings.length} holding${usdHoldings.length > 1 ? 's are' : ' is'} US-listed (${usdList}) — each USD trade costs ~1.5% FX.`,
      action: 'Buy your CAD-listed core for routine DCA; trade the USD names rarely.',
    })
  }

  // 7) Hold-through-volatility behavioural nudge (always shown).
  recs.push({
    sev: 'info',
    title: 'This is a high-volatility book by design',
    text: 'A semis + space + data-center tilt can drop 40-50% in a tech selloff while the broad core falls ~20%.',
    action: 'With a long runway, the plan is to keep buying and hold through drawdowns, not sell into them.',
  })

  return recs
}
