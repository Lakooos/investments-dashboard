// Apply trades scraped from a Wealthsimple Activity screenshot to the live
// portfolio. The screenshot only gives a $ amount per trade (no share count or
// unit price), but that's enough because:
//   • cash is derived from contributions − book value of holdings, so adjusting a
//     holding's BOOK by the trade amount keeps cash correct (a buy's amount IS its
//     cost; a sell frees the sold portion of cost).
//   • a buy of a brand-new ticker becomes a lightweight "estimated" holding
//     (book = market = amount, CAD proxy) that the next holdings-report CSV upload
//     overwrites with the exact shares / price / currency.
//
// Everything here is pure (no React) so it stays easy to reason about and test.

import { CORE_SYMBOLS, themeFor } from './parseCsv.js'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000

function newHolding(symbol, amountCad) {
  const cls = CORE_SYMBOLS.has(symbol) ? 'core' : 'satellite'
  return {
    symbol,
    name: symbol,
    cls,
    theme: themeFor(symbol, cls),
    shares: null, // unknown from a screenshot — reconciles on the next CSV upload
    price: null,
    currency: 'CAD', // the amount shown is the CAD net; treat as a CAD proxy for now
    bookCad: round2(amountCad),
    marketValueNative: round2(amountCad), // assume flat until real prices arrive
    bookNative: round2(amountCad),
    plNative: 0,
    estimated: true, // flagged in the UI; cleared when a holdings CSV replaces it
  }
}

// rows: [{ date, type:'buy'|'sell', symbol, amount(+CAD magnitude), currency }]
// Returns { holdings, activity, notes } — all new objects (no mutation of inputs).
export function applyImportedTrades({ holdings, activity, fx }, rows) {
  const hs = holdings.map((h) => ({ ...h }))
  const notes = []
  const txnsToAdd = []
  // Net cash contributed/withdrawn by imported deposits & withdrawals — folded into
  // the activity's contribution totals so derived cash + TFSA room stay correct.
  let contribTotalDelta = 0
  let contribYearDelta = 0
  const latestYear = activity?.latestYear || String(new Date().getFullYear())

  // Skip rows that exactly match a transaction already on file — gates BOTH the
  // holdings adjustment and the transaction, so applying the same screenshot twice
  // is a no-op instead of double-counting.
  const key = (date, type, symbol, amt) => `${date}|${type}|${symbol}|${amt.toFixed(2)}`
  const existing = activity?.transactions || []
  const seen = new Set(existing.map((t) => key(t.date, t.type, t.symbol, Math.abs(Number(t.amount) || 0))))

  for (const r of rows) {
    const amt = round2(Math.abs(Number(r.amount) || 0))
    const isCash = r.type === 'deposit' || r.type === 'withdrawal'
    if ((!r.symbol && !isCash) || !amt) continue
    const k = key(r.date, r.type, r.symbol || '', amt)
    if (seen.has(k)) continue
    seen.add(k)

    // Deposits / withdrawals (e-transfers in/out) don't touch holdings — they move
    // the contribution total, which is what derives cash and TFSA room.
    if (isCash) {
      const signed = r.type === 'deposit' ? amt : -amt
      contribTotalDelta += signed
      if (r.date.slice(0, 4) === latestYear) contribYearDelta += signed
      txnsToAdd.push({
        date: r.date,
        type: r.type,
        symbol: '',
        amount: signed,
        description: `${r.type === 'deposit' ? 'Deposit / transfer in' : 'Withdrawal / transfer out'} · from screenshot`,
        commission: 0,
        source: 'screenshot',
      })
      continue
    }

    const idx = hs.findIndex((h) => h.symbol === r.symbol)

    if (r.type === 'buy') {
      if (idx >= 0) {
        const h = hs[idx]
        const rate = h.currency === 'USD' ? fx || 1 : 1
        const addNative = amt / rate
        h.bookCad = round2((h.bookCad || 0) + amt)
        if (h.marketValueNative != null) h.marketValueNative = round2(h.marketValueNative + addNative)
        if (h.bookNative != null) h.bookNative = round2(h.bookNative + addNative)
        if (Number.isFinite(h.price) && h.price > 0 && Number.isFinite(h.shares)) {
          h.shares = round4(h.shares + addNative / h.price)
        }
      } else {
        hs.push(newHolding(r.symbol, amt))
      }
    } else {
      // sell — reduce the position proportionally to the proceeds vs its market value.
      if (idx >= 0) {
        const h = hs[idx]
        const rate = h.currency === 'USD' ? fx || 1 : 1
        const mvNative = h.marketValueNative != null ? h.marketValueNative : (h.shares || 0) * (h.price || 0)
        const mvCad = round2(mvNative * rate)
        const frac = mvCad > 0 ? Math.min(1, amt / mvCad) : 1
        const keep = 1 - frac
        h.bookCad = round2((h.bookCad || 0) * keep)
        if (h.marketValueNative != null) h.marketValueNative = round2(h.marketValueNative * keep)
        if (h.bookNative != null) h.bookNative = round2(h.bookNative * keep)
        if (h.plNative != null) h.plNative = round2(h.plNative * keep)
        if (Number.isFinite(h.shares)) h.shares = round4(h.shares * keep)
        if (frac >= 0.999 || h.bookCad < 0.01) hs.splice(idx, 1)
      } else {
        notes.push(`Sold ${r.symbol}, but it isn't in your holdings — recorded the transaction only.`)
      }
    }

    txnsToAdd.push({
      date: r.date,
      type: r.type,
      symbol: r.symbol,
      amount: r.type === 'sell' ? amt : -amt, // matches the CSV sign convention
      description: `${r.symbol} ${r.type} · from screenshot`,
      commission: 0,
      source: 'screenshot',
    })
  }

  // Merge into the activity transaction list, newest first. txnsToAdd is already
  // deduped against `existing` by the gate above.
  const merged = [...existing, ...txnsToAdd]
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const baseActivity = activity || {
    transactions: [],
    cashFromActivity: 0,
    dividends: 0,
    interest: 0,
    fees: 0,
    contributionsThisYear: 0,
    contributionsTotal: 0,
    accountsUsed: [],
    latestYear: null,
  }
  const newActivity = {
    ...baseActivity,
    transactions: merged,
    contributionsTotal: round2((baseActivity.contributionsTotal || 0) + contribTotalDelta),
    contributionsThisYear: round2((baseActivity.contributionsThisYear || 0) + contribYearDelta),
    cashFromActivity: round2((baseActivity.cashFromActivity || 0) + contribTotalDelta),
    latestYear: baseActivity.latestYear || latestYear,
  }

  return { holdings: hs, activity: newActivity, notes }
}
