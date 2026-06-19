// Parsers for the two Wealthsimple exports:
//   parseHoldingsCsv  -> current positions (holdings-report-YYYY-MM-DD.csv)
//   parseActivityCsv  -> transactions + cash/contributions/dividends (activities-export-...csv)

export const CORE_SYMBOLS = new Set(['VFV', 'XEQT', 'VEQT', 'ZSP', 'VUN', 'VCN', 'XGRO'])

export function themeFor(symbol, cls) {
  const t = {
    VFV: 'Broad · US large-cap',
    XEQT: 'Broad · Global all-in-one',
    SMH: 'AI · Semiconductors',
    SOXX: 'AI · Semiconductors',
    NVDA: 'AI · Semiconductors',
    EQIX: 'AI · Data centers',
    DLR: 'AI · Data centers',
    SPCX: 'Space',
    FPS: 'AI · Power',
    META: 'AI · Mega-cap tech',
  }
  if (t[symbol]) return t[symbol]
  return cls === 'core' ? 'Broad · Core' : 'Satellite'
}

// CSV line splitter that respects double-quoted fields.
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function headerIndex(header, name) {
  return header.findIndex((h) => h === name.toLowerCase())
}

// Look at the header row and decide which kind of Wealthsimple export this is.
// Returns 'activity' | 'holdings' | 'unknown'. Activity is checked first because
// it also has Symbol/Quantity columns, but only it has transaction_date.
export function detectCsvKind(text) {
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim().length) || '').toLowerCase()
  const has = (s) => firstLine.includes(s)
  if (has('transaction_date') && (has('net_cash_amount') || has('activity_type'))) return 'activity'
  if (has('symbol') && (has('market price') || has('book value (cad)') || has('market value'))) return 'holdings'
  return 'unknown'
}

export function parseHoldingsCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
  if (!lines.length) throw new Error('Empty file')

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const iSym = headerIndex(header, 'Symbol')
  const iName = headerIndex(header, 'Name')
  const iQty = headerIndex(header, 'Quantity')
  const iPrice = headerIndex(header, 'Market Price')
  const iCcy = headerIndex(header, 'Market Price Currency')
  const iBookCad = headerIndex(header, 'Book Value (CAD)')
  const iMktVal = headerIndex(header, 'Market Value') // in the security's native currency
  const iBookNative = headerIndex(header, 'Book Value (Market)') // native-currency cost
  const iUnreal = headerIndex(header, 'Market Unrealized Returns') // Wealthsimple's own native P&L

  if (iSym < 0 || iQty < 0 || iPrice < 0) {
    throw new Error('Not a holdings report (missing Symbol/Quantity/Market Price columns).')
  }

  const num = (i) => (i >= 0 ? parseFloat(f[i]) : NaN)
  let f = []
  const holdings = []
  for (let r = 1; r < lines.length; r++) {
    f = splitCsvLine(lines[r])
    const symbol = (f[iSym] || '').toUpperCase()
    if (!symbol) continue
    const shares = parseFloat(f[iQty])
    const price = parseFloat(f[iPrice])
    if (!isFinite(shares) || !isFinite(price)) continue
    const cls = CORE_SYMBOLS.has(symbol) ? 'core' : 'satellite'
    const mvNative = num(iMktVal)
    const bookNative = num(iBookNative)
    const plNative = num(iUnreal)
    holdings.push({
      symbol,
      name: iName >= 0 ? f[iName] : symbol,
      cls,
      theme: themeFor(symbol, cls),
      shares,
      price,
      currency: (iCcy >= 0 ? f[iCcy] : 'CAD') || 'CAD',
      bookCad: iBookCad >= 0 ? parseFloat(f[iBookCad]) || 0 : 0,
      // Native-currency figures straight from Wealthsimple (FX-independent, match the app).
      marketValueNative: isFinite(mvNative) ? mvNative : undefined,
      bookNative: isFinite(bookNative) ? bookNative : undefined,
      plNative: isFinite(plNative) ? plNative : undefined,
    })
  }
  if (!holdings.length) throw new Error('No holdings rows found in the file.')
  return holdings
}

export function parseActivityCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
  if (!lines.length) throw new Error('Empty file')

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const iDate = headerIndex(header, 'transaction_date')
  const iType = headerIndex(header, 'activity_type')
  const iSub = headerIndex(header, 'activity_sub_type')
  const iDir = headerIndex(header, 'direction')
  const iSym = headerIndex(header, 'symbol')
  const iName = headerIndex(header, 'name')
  const iCcy = headerIndex(header, 'currency')
  const iQty = headerIndex(header, 'quantity')
  const iUnit = headerIndex(header, 'unit_price')
  const iComm = headerIndex(header, 'commission')
  const iCash = headerIndex(header, 'net_cash_amount')
  const iAcctId = headerIndex(header, 'account_id')
  const iAcctType = headerIndex(header, 'account_type')

  if (iDate < 0 || iType < 0 || iCash < 0) {
    throw new Error('Not an activity export (missing transaction_date/activity_type/net_cash_amount).')
  }

  // Pass 1: read every row into a normalized record (with its account).
  const rows = []
  const tradeAccounts = new Set()
  for (let r = 1; r < lines.length; r++) {
    const f = splitCsvLine(lines[r])
    const date = f[iDate]
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue // skip trailing "As of ..." line
    const rawType = (f[iType] || '').toLowerCase()
    const acctId = iAcctId >= 0 ? f[iAcctId] : ''
    const acctType = (iAcctType >= 0 ? f[iAcctType] : '').toLowerCase()
    if (rawType === 'trade') tradeAccounts.add(acctId)
    rows.push({
      date,
      rawType,
      acctId,
      acctType,
      sub: (iSub >= 0 ? f[iSub] : '').toUpperCase(),
      dir: (iDir >= 0 ? f[iDir] : '').toUpperCase(),
      symbol: (iSym >= 0 ? f[iSym] : '').toUpperCase(),
      name: iName >= 0 ? f[iName] : '',
      cash: parseFloat(f[iCash]) || 0,
      comm: iComm >= 0 ? Math.abs(parseFloat(f[iComm]) || 0) : 0,
      qty: iQty >= 0 ? parseFloat(f[iQty]) : NaN,
      unit: iUnit >= 0 ? parseFloat(f[iUnit]) : NaN,
      ccy: iCcy >= 0 ? f[iCcy] : 'CAD',
    })
  }

  // Only count the INVESTMENT account(s). "Select all" exports include chequing/cash
  // accounts whose transfers would otherwise corrupt TFSA deposits & cash.
  // The investment account is the one that has trades; fall back to excluding
  // obvious cash accounts, else keep everything.
  const CASH_ACCT = /chequing|cheque|saving|^cash$/
  const keep = (row) => {
    if (tradeAccounts.size) return tradeAccounts.has(row.acctId)
    return !CASH_ACCT.test(row.acctType)
  }
  const accountsUsed = new Set()

  const txns = []
  let cashFromActivity = 0
  let dividends = 0
  let fees = 0
  let interest = 0
  const contribByYear = {}

  for (const row of rows) {
    if (!keep(row)) continue
    accountsUsed.add(row.acctId)
    const { date, rawType, sub, dir, symbol, cash, comm, qty, unit, ccy } = row

    let type = rawType
    if (rawType === 'trade') type = sub === 'SELL' || dir === 'SHORT' ? 'sell' : 'buy'
    else if (rawType === 'moneymovement') type = cash >= 0 ? 'deposit' : 'withdrawal'
    else if (rawType.includes('dividend')) type = 'dividend'
    else if (rawType.includes('interest')) type = 'interest'
    else if (rawType.includes('fee')) type = 'fee'
    else if (rawType.includes('bonus') || rawType.includes('reward')) type = 'bonus'

    cashFromActivity += cash
    fees += comm
    if (type === 'dividend') dividends += Math.max(0, cash)
    else if (type === 'interest') interest += cash
    else if (type === 'fee') fees += Math.abs(cash)
    if (type === 'deposit' || type === 'withdrawal') {
      const yr = date.slice(0, 4)
      contribByYear[yr] = (contribByYear[yr] || 0) + cash
    }

    let description = ''
    if (type === 'buy' || type === 'sell') {
      description = `${symbol} ${type} ${isFinite(qty) ? qty : ''}${isFinite(unit) ? ' @ ' + unit.toFixed(2) + ' ' + ccy : ''}`.trim()
    } else if (type === 'deposit') description = 'Deposit'
    else if (type === 'withdrawal') description = 'Withdrawal / transfer out'
    else if (type === 'dividend') description = `${symbol} dividend`.trim()
    else if (type === 'interest') description = 'Interest'
    else if (type === 'bonus') description = 'Bonus / reward'
    else description = row.name || rawType

    txns.push({ date, type, symbol, amount: cash, description, commission: comm })
  }

  txns.sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first

  const years = Object.keys(contribByYear).sort()
  const latestYear = years.length ? years[years.length - 1] : null
  const contributionsThisYear = latestYear ? contribByYear[latestYear] : 0
  const contributionsTotal = Object.values(contribByYear).reduce((s, v) => s + v, 0)

  return {
    transactions: txns,
    cashFromActivity: Math.round(cashFromActivity * 100) / 100,
    dividends: Math.round(dividends * 100) / 100,
    interest: Math.round(interest * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    contributionsThisYear: Math.round(contributionsThisYear * 100) / 100,
    contributionsTotal: Math.round(contributionsTotal * 100) / 100,
    accountsUsed: [...accountsUsed],
    latestYear,
  }
}
