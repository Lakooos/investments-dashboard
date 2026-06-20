import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const money = (n) =>
  '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(d) {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  } catch {
    return d
  }
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="tooltip">
      <strong>{money(d.value)}</strong>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{fmtDate(d.date)}</div>
    </div>
  )
}

// Glowing dot rendered only on the final point (matches the reference's end-cap).
function EndDot({ cx, cy, index, dataLength }) {
  if (cx == null || cy == null || index !== dataLength - 1) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r="9" fill="#3b82f6" opacity="0.22" />
      <circle cx={cx} cy={cy} r="5" fill="#3b82f6" stroke="#0b1220" strokeWidth="2.5" />
    </g>
  )
}

// data: [{ date: 'YYYY-MM-DD', value: Number }]
export default function ValueChart({ data }) {
  const enough = data && data.length >= 2
  // Pad a flat baseline so the area still renders attractively before history builds.
  const series = enough ? data : data && data.length === 1 ? [{ ...data[0] }, { ...data[0] }] : []
  const values = series.map((d) => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min) * 0.18 || Math.max(max * 0.04, 1)

  return (
    <div className="hero-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.42" />
              <stop offset="55%" stopColor="#3b82f6" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
            <filter id="heroGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <CartesianGrid vertical horizontal={false} stroke="#172034" strokeDasharray="0" />
          <XAxis dataKey="date" hide />
          <YAxis domain={[min - pad, max + pad]} hide />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#4f8cff"
            strokeWidth={2.6}
            fill="url(#heroFill)"
            filter="url(#heroGlow)"
            dot={<EndDot dataLength={series.length} />}
            activeDot={{ r: 5, fill: '#4f8cff', stroke: '#0b1220', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {!enough && (
        <div className="hero-chart-empty">
          <span>Building your history — check back daily</span>
        </div>
      )}
    </div>
  )
}

// Tiny inline-SVG sparkline for the topbar chip. values: number[].
export function Sparkline({ values, width = 96, height = 34, color }) {
  const vals = Array.isArray(values) && values.length ? values : [1, 1]
  const data = vals.length === 1 ? [vals[0], vals[0]] : vals
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = width / (data.length - 1)
  const y = (v) => height - 4 - ((v - min) / span) * (height - 8)
  const pts = data.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`)
  const line = pts.join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const up = data[data.length - 1] >= data[0]
  const stroke = color || (up ? '#22c55e' : '#f87171')
  const gid = 'spk' + Math.round(min * 100) + '_' + data.length
  return (
    <svg className="idx-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={area} fill={`url(#${gid})`} stroke="none" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
