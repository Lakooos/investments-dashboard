import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

const COLORS = [
  '#4f8cff', '#22c55e', '#f59e0b', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#84cc16',
]
const CASH_COLOR = '#64748b'

const money = (n) => '$' + Number(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })

function renderLabel({ name, percent }) {
  return `${name} ${(percent * 100).toFixed(1)}%`
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="tooltip">
      <strong>{d.name}</strong>
      <div>{money(d.value)} CAD</div>
      <div>{d.pct.toFixed(1)}% of account</div>
    </div>
  )
}

// data: [{ name, value (CAD), pct }]. center: { value, pct, hasBaseline, tone }.
export default function AllocationPie({ data, center }) {
  const tone = center ? center.tone : 'flat'
  const sign = center && center.value >= 0 ? '+' : '-'
  return (
    <div className="pie-wrap">
      <ResponsiveContainer width="100%" height={360}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={120}
            innerRadius={78}
            paddingAngle={2}
            label={renderLabel}
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.name}
                fill={entry.name === 'Cash' ? CASH_COLOR : COLORS[i % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>

      {center && (
        <div className="pie-center">
          <div className="pie-center-label">Today</div>
          {center.hasBaseline ? (
            <>
              <div className={'pie-center-value ' + tone}>
                {sign}${Math.abs(center.value).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={'pie-center-sub ' + tone}>
                {sign}{Math.abs(center.pct * 100).toFixed(2)}%
              </div>
            </>
          ) : (
            <>
              <div className="pie-center-value flat">$0.00</div>
              <div className="pie-center-sub muted">tracking starts today</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
