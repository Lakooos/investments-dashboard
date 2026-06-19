// Bridge between the dashboard and Claude (copy/paste flow):
// the "Generate recommendations" button builds a snapshot + prompt, copies it to
// the clipboard, and downloads it. You paste it to Claude (this terminal); Claude
// researches the news + writes app/public/recommendations.json; the panel fetches it.

export function buildSnapshot({ holdings, summary, fx, profile, activity, asOf, today }) {
  return {
    dataAsOf: asOf,
    fx,
    risk: profile.risk,
    targets: {
      corePct: profile.coreTargetPct,
      satellitePct: profile.satelliteTargetPct,
      maxSatellitePct: profile.maxSatellitePct,
      maxSingleNamePct: profile.maxSingleNamePct,
      tiltThemes: profile.tiltThemes,
      tfsaAnnualLimit: profile.tfsaAnnualLimit,
    },
    totals: {
      netWorthCad: summary.accountTotal,
      investedCad: summary.invested,
      cashCad: summary.cash,
      cashPct: round1(summary.cashPct),
      unrealizedCad: summary.plCad,
      unrealizedPct: round1(summary.plPct * 100),
      corePctOfInvested: round1(summary.corePct),
      satellitePctOfInvested: round1(summary.satellitePct),
    },
    today: today?.hasBaseline ? { changeCad: today.changeCad, changePct: round1(today.changePct * 100) } : null,
    tfsa: activity
      ? { contributionsThisYear: activity.contributionsThisYear, limit: profile.tfsaAnnualLimit }
      : null,
    holdings: summary.byHolding.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      cls: h.cls,
      theme: h.theme,
      shares: h.shares,
      priceNative: h.price,
      currency: h.currency,
      marketValueCad: h.marketValueCad,
      pctOfAccount: round1(h.pct),
      unrealizedNative: h.plNative,
      unrealizedNativePct: round1((h.plNativePct || 0) * 100),
    })),
  }
}

// The JSON shape Claude must produce.
export const SCHEMA = `{
  "summary": "<2-3 sentence plain-language overview>",
  "health": "<one short line, e.g. 'Healthy, slightly cash-heavy'>",
  "sell":   [{ "symbol": "TICKER", "action": "Hold | Trim ~$X | Sell", "reason": "..." }],
  "watch":  [{ "subject": "TICKER or theme", "reason": "..." }],
  "rebalance": [{ "action": "...", "detail": "..." }],
  "news":   [{ "ticker": "TICKER", "headline": "...", "impact": "positive|negative|neutral", "note": "...", "source": "..." }],
  "breaking": [{ "headline": "<market-wide / breaking item, may be unrelated to current holdings>", "why": "why it matters to me", "impact": "positive|negative|neutral", "source": "..." }],
  "opportunities": [{ "idea": "TICKER or theme NOT already held", "thesis": "the bull case in plain language", "risk": "the main risk", "fit": "how it fits a medium-high space/AI tilt + diversification note", "source": "..." }],
  "recommendations": [{ "priority": "high|med|low", "title": "...", "detail": "..." }],
  "disclaimer": "Educational only, not licensed financial advice."
}`

// Shared analysis instructions used by BOTH paths.
export function buildAnalysisInstructions(snapshot) {
  const held = (snapshot.holdings || []).map((h) => h.symbol).filter(Boolean).join(', ') || 'my current holdings'
  const t = snapshot.targets || {}
  const themes = (t.tiltThemes || []).join(', ') || 'my chosen tilt themes'
  return `You are my portfolio analyst for a ${snapshot.risk || 'medium-high'} risk TFSA. Research the latest news on the web, think hard, and produce personalized, plain-language (ELI5) recommendations tied to my actual positions and my plan's rules (${t.corePct ?? 60}/${t.satellitePct ?? 40} core/satellite target, satellites <= ~${t.maxSatellitePct ?? 45}%, single name <= ~${t.maxSingleNamePct ?? 15}%).

Research and cover ALL of the following:
- NEWS on my current holdings: ${held}.
- BREAKING / market-wide news from the last few days that could move my portfolio OR open opportunities — even if it's not about something I currently own (macro, Fed/rates, USD/CAD, big tech, AI, energy, chips).
- New OPPORTUNITIES: 2-4 specific tickers or themes I do NOT currently hold that fit my risk level and tilt themes (${themes}). For each, give the bull case, the main risk, and how it fits / whether it overlaps what I already own. Be honest about diversification.
- What to SELL or trim, what to WATCH OUT for, and REBALANCE moves vs my targets.

Every news/breaking/opportunity item must cite a source (publication or site). Keep it concrete and personal to my numbers.`
}

// Manual path: ask Claude Code to WRITE the file.
export function buildPrompt(snapshot) {
  return `Generate my dashboard investment recommendations (Opus 4.8, deep thinking).

${buildAnalysisInstructions(snapshot)}

After researching, WRITE the file app/public/recommendations.json following this schema EXACTLY (add "generatedAt", "model", "dataAsOf" fields too), then tell me to click "Refresh" in the dashboard.

SCHEMA:
${SCHEMA}

LIVE SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}`
}

export async function copyAndDownload(prompt, snapshot) {
  let copied = false
  try {
    await navigator.clipboard.writeText(prompt)
    copied = true
  } catch {
    /* clipboard may be blocked; the download still works */
  }
  const blob = new Blob([prompt], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `claude-request-${snapshot.dataAsOf || 'latest'}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return copied
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10
