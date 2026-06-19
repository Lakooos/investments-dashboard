// Shared mapper: turn normalized SnapTrade positions into the app's holding shape
// (the same shape parseCsv produces), reusing CORE_SYMBOLS/themeFor for classification.
// Used by BOTH the personal data source (snaptradeSource.js) and the partner data
// source (partnerSource.js) so the math/UI work identically in either mode.
import { CORE_SYMBOLS, themeFor } from './parseCsv.js'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// position: { symbol, name, currency, units, price, costPerShare }
function toHolding(p, fx) {
  const symbol = (p.symbol || '').toUpperCase()
  const cls = CORE_SYMBOLS.has(symbol) ? 'core' : 'satellite'
  const shares = Number(p.units) || 0
  const price = Number(p.price) || 0
  const currency = p.currency || 'CAD'
  const marketValueNative = round2(shares * price)
  const bookNative = round2(shares * (Number(p.costPerShare) || 0))
  const plNative = round2(marketValueNative - bookNative)
  // Book in CAD: native book converted at the current rate. (Approximation — the
  // brokerage's own CAD book uses the FX rate at each purchase, which the positions
  // feed doesn't expose, so home-currency P&L can differ slightly from the broker.)
  const rate = currency === 'USD' ? fx : 1
  const bookCad = round2(bookNative * rate)
  return { symbol, name: p.name || symbol, cls, theme: themeFor(symbol, cls), shares, price, currency, bookCad, marketValueNative, bookNative, plNative }
}

export function mapPositionsToHoldings(positions, fx) {
  return (positions || []).map((p) => toHolding(p, fx))
}
