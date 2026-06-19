// Parse a Wealthsimple "Activity" screenshot into transaction rows.
//
// Two layers, kept separate so the text parser is unit-testable without a browser:
//   parseActivityText(text, now)  -> rows   (PURE — no DOM, no OCR)
//   ocrImage(file, onProgress)    -> text   (browser-only, runs Tesseract locally)
//
// Real OCR is noisy: amounts lose their "$", commas and even decimal points
// ("$1,320.97" -> "s132097CAD"), some amounts vanish entirely, and logos/chevrons
// inject junk characters. So the parser is deliberately forgiving and every row is
// confirmed by the user in an editable review table before anything is applied.

const TICKER_STOP = new Set([
  'CAD', 'USD', 'TFSA', 'RRSP', 'FHSA', 'RESP', 'LIRA', 'RRIF', 'ETF', 'GIC',
  'LONG', 'SHORT', 'BUY', 'SELL', 'AM', 'PM', 'EFT', 'NA',
])

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

const pad = (n) => String(n).padStart(2, '0')
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// A line that is ONLY a ticker symbol (allowing leading/trailing icon junk).
// "XEQT", "VFV ©", "  SMH" -> symbol; "Market sell TFSA", "1,321.18 CAD" -> null.
function tickerOnly(line) {
  const m = line.match(/^[^A-Za-z]*([A-Z]{1,5}(?:\.[A-Z]{1,2})?)[^A-Za-z]*$/)
  if (!m) return null
  const sym = m[1].toUpperCase()
  if (TICKER_STOP.has(sym)) return null
  return sym
}

// Resolve a date-header line ("Today", "Yesterday", "June 17, 2026") to an ISO date.
function dateHeader(line, now) {
  const l = line.toLowerCase()
  if (/\btoday\b/.test(l)) return toISO(now)
  if (/\byesterday\b/.test(l)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return toISO(d)
  }
  const m = l.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/)
  if (m && m[1] in MONTHS) {
    const month = MONTHS[m[1]]
    const day = parseInt(m[2], 10)
    const year = m[3] ? parseInt(m[3], 10) : now.getFullYear()
    if (day >= 1 && day <= 31) return toISO(new Date(year, month, day))
  }
  return null
}

// buy vs sell from a line of text. Checks "sell" first ("buy" never appears in a sell).
function tradeType(line) {
  const l = line.toLowerCase()
  if (/sell|sold/.test(l)) return 'sell'
  if (/buy|bought/.test(l)) return 'buy'
  return null
}

// Pull a dollar amount out of a line, recovering common OCR mangling.
// "$323.86 CAD" -> 323.86 ; "1,321.18 CAD" -> 1321.18 ; "s132097CAD" -> 1320.97.
function amountIn(line) {
  // 1) A clean number with 2 decimals (best signal). No trailing \b — OCR often
  //    glues the currency on ("900.58CAD"), which would kill a word-boundary match.
  const dec = line.match(/(\d[\d,]*\.\d{2})(?!\d)/)
  if (dec) return parseFloat(dec[1].replace(/,/g, ''))
  // 2) A long digit run with no decimal, usually next to CAD/USD — treat the last
  //    two digits as cents ("132097" -> 1320.97, "90058" -> 900.58).
  const run = line.match(/(\d{5,})\s*(?:CAD|USD)?/i)
  if (run) return parseInt(run[1], 10) / 100
  return null
}

// PURE: OCR text -> array of candidate rows.
// Row = { date, type, symbol, amount|null, currency, needsAmount }.
export function parseActivityText(text, now = new Date()) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  let currentDate = toISO(now)
  const rows = []

  for (let i = 0; i < lines.length; i++) {
    // Date headers move the cursor and are never tickers.
    const dh = dateHeader(lines[i], now)
    if (dh) {
      currentDate = dh
      continue
    }
    const sym = tickerOnly(lines[i])
    if (!sym) continue

    // Gather this holding's block: the lines after the ticker, up to the next
    // ticker or date header — the amount and buy/sell label live in here.
    const block = []
    let j = i + 1
    for (; j < lines.length; j++) {
      if (dateHeader(lines[j], now) || tickerOnly(lines[j])) break
      block.push(lines[j])
    }
    i = j - 1 // resume at the line that ended the block

    let type = null
    let amount = null
    let currency = 'CAD'
    for (const bl of block) {
      if (!type) type = tradeType(bl)
      if (amount == null) {
        const a = amountIn(bl)
        if (a != null) {
          amount = a
          if (/\busd\b/i.test(bl)) currency = 'USD'
        }
      }
    }

    // Only emit if the block actually looked like a transaction (had a type or an
    // amount) — filters stray all-caps lines that aren't really trades.
    if (type == null && amount == null) continue
    rows.push({
      date: currentDate,
      type: type || 'buy', // sensible default; user can flip it
      symbol: sym,
      amount,
      currency,
      needsAmount: amount == null,
    })
  }
  return rows
}

// Flag rows that look like they're already in your loaded activity, so the review
// table can pre-uncheck them. Dedup on symbol+type+amount (amounts are distinctive);
// a same-day same-symbol match with no amount is only an *info* hint, not auto-skip,
// because you can legitimately buy the same ticker on consecutive days.
export function markDuplicates(rows, existingTxns = []) {
  return rows.map((r) => {
    let dup = false
    let hint = ''
    for (const t of existingTxns) {
      if (t.symbol !== r.symbol || t.type !== r.type) continue
      const existAmt = Math.abs(Number(t.amount) || 0)
      if (r.amount != null && Math.abs(existAmt - r.amount) < 0.5) {
        dup = true
        break
      }
      if (r.amount == null) hint = `already a ${r.symbol} ${r.type} on ${t.date} ($${existAmt.toFixed(2)})`
    }
    return { ...r, isDuplicate: dup, dupHint: hint }
  })
}

// browser-only: run Tesseract locally on an image File/Blob/dataURL.
// Tries bundled offline assets first (public/tessdata/), then falls back to the
// library defaults (downloads once, then cached) so it always works online.
export async function ocrImage(image, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const logger = (m) => {
    if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress?.(m.progress)
  }
  const base = new URL('tessdata/', document.baseURI).href
  let worker
  try {
    // Bundled offline assets (see public/tessdata/). corePath points straight at the
    // SIMD+LSTM core so the worker doesn't probe for a relaxed-SIMD build we don't ship.
    worker = await createWorker('eng', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'tesseract-core-simd-lstm.wasm.js',
      langPath: base,
      logger,
    })
  } catch {
    // Fall back to the library's CDN defaults (downloads once, then cached) so OCR
    // still works even if a bundled asset is missing.
    worker = await createWorker('eng', 1, { logger })
  }
  try {
    const { data } = await worker.recognize(image)
    return data.text
  } finally {
    await worker.terminate()
  }
}
