import { useEffect, useState } from 'react'

const IMPACT = { positive: '🟢', negative: '🔴', neutral: '⚪' }
const PRIO = { high: 'prio-high', med: 'prio-med', low: 'prio-low' }

export default function ClaudeRecs({ refreshKey }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('./recommendations.json?t=' + Date.now())
      if (!res.ok) throw new Error('not found')
      setData(await res.json())
    } catch {
      setError("Couldn't load recommendations.json yet.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [refreshKey])

  const empty = !data || data.status === 'empty' || !data.generatedAt

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Claude's recommendations <span className="tag tag-opus">Opus 4.8 · deep research</span>
        </h2>
        <button onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {empty ? (
        <p className="hint">
          {error || (data && data.summary) || 'Not generated yet.'} Click <strong>✨ Generate recommendations</strong> up
          top, paste the request to Claude, then hit <strong>Refresh</strong>.
        </p>
      ) : (
        <div className="crec">
          <div className="crec-meta">
            Generated {new Date(data.generatedAt).toLocaleString('en-CA')} · {data.model || 'Claude'} ·{' '}
            {data.dataAsOf || ''}
          </div>
          {data.health && <div className="crec-health">{data.health}</div>}
          {data.summary && <p className="crec-summary">{data.summary}</p>}

          <RecGroup title="🔻 Sell / trim" items={data.sell} render={(s) => (
            <><strong>{s.symbol}</strong> — <em>{s.action}</em>. {s.reason}</>
          )} />

          <RecGroup title="👀 Watch out for" items={data.watch} render={(w) => (
            <><strong>{w.subject}</strong> — {w.reason}</>
          )} />

          <RecGroup title="⚖️ Rebalance" items={data.rebalance} render={(r) => (
            <><strong>{r.action}</strong> — {r.detail}</>
          )} />

          <RecGroup title="🚀 New opportunities (not yet held)" items={data.opportunities} render={(o) => (
            <>
              <strong>{o.idea}</strong> — {o.thesis} <span className="muted">Risk: {o.risk}. Fit: {o.fit}</span>
              {o.source && <span className="crec-src"> ({o.source})</span>}
            </>
          )} />

          <RecGroup title="⚡ Breaking / market news" items={data.breaking} render={(b) => (
            <>
              {IMPACT[b.impact] || '•'} {b.headline}. <span className="muted">{b.why}</span>
              {b.source && <span className="crec-src"> ({b.source})</span>}
            </>
          )} />

          <RecGroup title="📰 Your holdings in the news" items={data.news} render={(n) => (
            <>
              {IMPACT[n.impact] || '•'} <strong>{n.ticker}</strong>: {n.headline}. <span className="muted">{n.note}</span>
              {n.source && <span className="crec-src"> ({n.source})</span>}
            </>
          )} />

          {Array.isArray(data.recommendations) && data.recommendations.length > 0 && (
            <div className="crec-block">
              <h3>✅ Action plan</h3>
              <ul className="recs">
                {data.recommendations.map((r, i) => (
                  <li key={i} className={'rec ' + (PRIO[r.priority] || '')}>
                    <div className="rec-title">{r.title}</div>
                    <div className="rec-text">{r.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.disclaimer && <p className="crec-disc">{data.disclaimer}</p>}
        </div>
      )}
    </section>
  )
}

function RecGroup({ title, items, render }) {
  if (!Array.isArray(items) || !items.length) return null
  return (
    <div className="crec-block">
      <h3>{title}</h3>
      <ul className="crec-list">
        {items.map((it, i) => (
          <li key={i}>{render(it)}</li>
        ))}
      </ul>
    </div>
  )
}
