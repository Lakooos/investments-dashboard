// Tracks a daily snapshot of CAD prices in localStorage so we can show TODAY's
// gain/loss. "Today's change" = sum over current holdings of
//   shares * (priceCadToday - priceCadYesterday)
// which isolates price moves and ignores new buys/sells.
//
// First run on a fresh machine has no prior day, so today's change shows as 0
// with a "tracking starts today" note; it fills in on the next day's check-in.

const KEY = 'invdash_history_v1'

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function saveHistory(h) {
  try {
    localStorage.setItem(KEY, JSON.stringify(h))
  } catch {
    /* ignore quota / private mode */
  }
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// priceCadMap: { SYMBOL: priceInCad }. Stores/updates today's entry.
export function recordToday(date, priceCadMap, invested, accountTotal) {
  const h = loadHistory()
  h[date] = { prices: priceCadMap, invested, accountTotal }
  saveHistory(h)
  return h
}

// The most recent stored entry strictly before `date`.
export function prevEntry(history, date) {
  const days = Object.keys(history)
    .filter((d) => d < date)
    .sort()
  return days.length ? history[days[days.length - 1]] : null
}

// enriched: holdings with { symbol, shares, price, rate }. Returns CAD change today.
export function computeTodayChange(enriched, prev) {
  if (!prev || !prev.prices) return { changeCad: 0, changePct: 0, hasBaseline: false }
  let change = 0
  let base = 0
  enriched.forEach((h) => {
    const todayCad = h.price * h.rate
    const prevCad = prev.prices[h.symbol]
    if (prevCad == null) return // new holding, no baseline -> contributes nothing
    change += h.shares * (todayCad - prevCad)
    base += h.shares * prevCad
  })
  const changeCad = Math.round(change * 100) / 100
  const changePct = base ? changeCad / base : 0
  return { changeCad, changePct, hasBaseline: true }
}
