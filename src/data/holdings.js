// Seed data = a NEUTRAL SAMPLE portfolio (NOT real holdings). Shipped so the app
// has something to show on first run. Drop your own Wealthsimple "holdings report"
// CSV onto the app (Upload button) to replace it with your real data — which is
// stored only on your device (localStorage). See src/lib/parseCsv.js.

export const DEFAULT_FX = 1.40 // CAD per 1 USD (editable in the app)

export const PROFILE = {
  name: 'Sample portfolio',
  risk: 'Medium–High',
  // Target split for a medium-high risk, growth-tilted portfolio.
  coreTargetPct: 60,
  satelliteTargetPct: 40,
  // Guardrails used by the recommendation engine.
  maxSatellitePct: 45, // total satellite sleeve should stay at/under this
  maxSingleNamePct: 15, // flag any one holding above this % of the whole account
  tfsaAnnualLimit: 7000,
  tiltThemes: ['Space', 'AI · Semiconductors', 'AI · Data centers', 'AI · Power'],
}

export const AS_OF = '2026-01-01'

// Illustrative sample only — round, made-up numbers. Mixes CAD + USD so the
// FX box and allocation pie have something to show before you upload real data.
export const SEED_HOLDINGS = [
  { symbol: 'XEQT', name: 'iShares Core Equity ETF (sample)', cls: 'core', theme: 'Broad · Global all-in-one', shares: 30, price: 45, currency: 'CAD', bookCad: 1300, marketValueNative: 1350, bookNative: 1300, plNative: 50 },
  { symbol: 'VEQT', name: 'Vanguard All-Equity ETF (sample)', cls: 'core', theme: 'Broad · Global', shares: 15, price: 42, currency: 'CAD', bookCad: 610, marketValueNative: 630, bookNative: 610, plNative: 20 },
  { symbol: 'SMH', name: 'Semiconductor ETF (sample)', cls: 'satellite', theme: 'AI · Semiconductors', shares: 1, price: 300, currency: 'USD', bookCad: 400, marketValueNative: 300, bookNative: 280, plNative: 20 },
  { symbol: 'QQC', name: 'Nasdaq-100 ETF (sample)', cls: 'satellite', theme: 'US large-cap growth', shares: 6, price: 50, currency: 'CAD', bookCad: 290, marketValueNative: 300, bookNative: 290, plNative: 10 },
]
