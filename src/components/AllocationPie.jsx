import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = [
  '#3b82f6', '#22d3ee', '#22c55e', '#f59e0b',
  '#f97316', '#a855f7', '#ec4899', '#84cc16',
  '#14b8a6', '#eab308',
]
const OTHER_COLOR = '#60a5fa'
const CASH_COLOR = '#64748b'

const money = (n) => '$' + Number(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })

const colorFor = (name, i) => (name === 'Cash' ? CASH_COLOR : name === 'Other' ? OTHER_COLOR : COLORS[i % COLORS.length])

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="tooltip">
      <strong>{d.name}</strong>
      <div style={{ marginTop: 2 }}>{money(d.value)} CAD</div>
      <div className="muted">{d.pct.toFixed(1)}% of account</div>
    </div>
  )
}

// data: [{ name, value (CAD), pct }]. center (optional): { top, bottom, tone }.
// Collapses the long tail into "Other" so the donut + legend stay readable.
export default function AllocationPie({ data, center, maxLegend = 6 }) {
  const cash = data.filter((d) => d.name === 'Cash')
  const rest = data.filter((d) => d.name !== 'Cash').sort((a, b) => b.value - a.value)

  let slices
  if (rest.length > maxLegend + 1) {
    const head = rest.slice(0, maxLegend)
    const tail = rest.slice(maxLegend)
    const other = {
      name: 'Other',
      value: tail.reduce((s, d) => s + d.value, 0),
      pct: tail.reduce((s, d) => s + d.pct, 0),
    }
    slices = [...head, other, ...cash]
  } else {
    slices = [...rest, ...cash]
  }

  return (
    <div className="alloc-wrap">
      <div className="pie-wrap">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={87}
              innerRadius={55}
              paddingAngle={2}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((entry, i) => (
                <Cell key={entry.name} fill={colorFor(entry.name, i)} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {center && (
          <div className="pie-center">
            <div className={'pie-center-top ' + (center.tone || '')}>{center.top}</div>
            <div className="pie-center-bot">{center.bottom}</div>
          </div>
        )}
      </div>

      <div className="alloc-legend">
        {slices.map((entry, i) => (
          <div className="legend-row" key={entry.name}>
            <span className="legend-dot" style={{ background: colorFor(entry.name, i) }} />
            <span className="legend-name">{entry.name}</span>
            <span className="legend-pct">{entry.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
