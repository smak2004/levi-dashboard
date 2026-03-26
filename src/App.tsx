import { useState, useEffect, useRef, useCallback } from 'react'

const API_URL = 'http://localhost:3002'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Position {
  id: string
  conditionId: string
  question: string
  outcome: string
  marketPrice: number
  myProbability: number
  edge: number
  stake: number
  potentialProfit: number
  reason: string
  placedAt: string
  endDate?: string
  status: 'open' | 'closed' | 'won' | 'lost'
  pnl?: number
  resolvedAt?: string
}

interface Portfolio {
  startingBankroll: number
  currentBankroll: number
  totalStaked: number
  totalValue: number
  pnl: number
  pnlPct: number
  totalBets: number
  totalWins: number
  totalLosses: number
  openPositions: Position[]
  closedPositions: Position[]
  mode: string
}

interface ResearchItem {
  question: string
  yesPrice: number
  marketPricePct: number
  estimate: {
    probability: number
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  }
  edge: number
  researchedAt: string
  conditionId?: string
  action?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number | undefined | null, decimals = 2): string {
  if (n == null || isNaN(n)) return '--'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}$${abs.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function fmtPct(n: number | undefined | null, decimals = 1): string {
  if (n == null || isNaN(n)) return '--'
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`
}

function truncate(s: string, len: number): string {
  if (!s) return '--'
  return s.length > len ? s.slice(0, len) + '\u2026' : s
}

function daysLeft(endDate?: string): string {
  if (!endDate) return '--'
  const diff = new Date(endDate).getTime() - Date.now()
  if (diff < 0) return 'Expired'
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  return `${days}d`
}

function timeAgo(iso: string): string {
  if (!iso) return '--'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Portfolio Curve (SVG) ───────────────────────────────────────────────────

function PortfolioCurve({ portfolio }: { portfolio: Portfolio | null }) {
  if (!portfolio) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: '#333', fontSize: 12 }}>
        Loading chart...
      </div>
    )
  }

  const start = portfolio.startingBankroll || 1000
  const current = portfolio.currentBankroll || start
  const closed = portfolio.closedPositions || []

  type Point = { x: number; y: number }
  const points: Point[] = []

  const sorted = [...closed].sort((a, b) => {
    const ta = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
    const tb = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
    return ta - tb
  })

  let running = start
  const startTime = sorted.length > 0 && sorted[0].resolvedAt
    ? new Date(sorted[0].resolvedAt).getTime() - 86400000
    : Date.now() - 86400000

  points.push({ x: startTime, y: start })

  for (const pos of sorted) {
    if (pos.pnl != null) {
      running += pos.pnl
      const t = pos.resolvedAt ? new Date(pos.resolvedAt).getTime() : Date.now()
      points.push({ x: t, y: running })
    }
  }

  points.push({ x: Date.now(), y: current })

  const W = 400
  const H = 120
  const PAD = 10

  const times = points.map(p => p.x)
  const tMin = times[0]
  const tMax = times[times.length - 1]
  const tRange = tMax - tMin || 1

  const values = points.map(p => p.y)
  const vMin = Math.min(...values) * 0.99
  const vMax = Math.max(...values) * 1.01
  const vRange = vMax - vMin || 1

  const toX = (t: number) => PAD + ((t - tMin) / tRange) * (W - 2 * PAD)
  const toY = (v: number) => H - PAD - ((v - vMin) / vRange) * (H - 2 * PAD)

  const isUp = current >= start
  const lineColor = isUp ? '#00ff88' : '#ff3366'
  const gradId = `grad-${isUp ? 'up' : 'down'}`

  const linePath = `M ${points.map(p => `${toX(p.x)},${toY(p.y)}`).join(' L ')}`
  const firstX = toX(points[0].x)
  const lastX = toX(points[points.length - 1].x)
  const areaFill = `M ${firstX},${H - PAD} L ${points.map(p => `${toX(p.x)},${toY(p.y)}`).join(' L ')} L ${lastX},${H - PAD} Z`

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120, display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => (
          <line
            key={f}
            x1={PAD} y1={PAD + f * (H - 2 * PAD)}
            x2={W - PAD} y2={PAD + f * (H - 2 * PAD)}
            stroke="#1a1a2e" strokeWidth="1"
          />
        ))}
        <path d={areaFill} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={toX(points[points.length - 1].x)}
          cy={toY(points[points.length - 1].y)}
          r="3"
          fill={lineColor}
          style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }}
        />
        <text x={PAD} y={H - 1} fontSize="8" fill="#444" fontFamily="monospace">{fmt$(vMin, 0)}</text>
        <text x={W - PAD} y={H - 1} fontSize="8" fill="#444" fontFamily="monospace" textAnchor="end">{fmt$(vMax, 0)}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4, fontFamily: 'monospace', color: '#444' }}>
        <span>START {fmt$(start, 0)}</span>
        <span style={{ color: lineColor }}>NOW {fmt$(current, 0)}</span>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, valueColor, glow,
}: {
  label: string; value: string; sub?: string; valueColor?: string; glow?: string
}) {
  return (
    <div style={{
      background: '#0f0f1a',
      border: `1px solid ${glow ? glow + '44' : '#1a1a2e'}`,
      boxShadow: glow ? `0 0 16px ${glow}18` : undefined,
      borderRadius: 6,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#00d4ff', fontFamily: 'monospace' }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        fontFamily: 'monospace',
        color: valueColor || '#e0e0e0',
        textShadow: glow ? `0 0 8px ${glow}` : undefined,
        lineHeight: 1.2,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#555', fontFamily: 'monospace' }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em',
      color: '#00d4ff', fontFamily: 'monospace', marginBottom: 10,
    }}>
      <span style={{ width: 3, height: 12, background: '#00d4ff', boxShadow: '0 0 6px #00d4ff', borderRadius: 2, display: 'inline-block' }} />
      {title}
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    high: { bg: '#00ff8820', color: '#00ff88' },
    medium: { bg: '#ffd70020', color: '#ffd700' },
    low: { bg: '#33333320', color: '#666' },
  }
  const style = map[(confidence || '').toLowerCase()] || map.low
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 3,
      textTransform: 'uppercase', letterSpacing: '0.1em',
      background: style.bg, color: style.color,
      border: `1px solid ${style.color}44`, fontFamily: 'monospace',
    }}>
      {confidence || 'low'}
    </span>
  )
}

function WonLostBadge({ status }: { status: string }) {
  const won = status === 'won'
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 3, textTransform: 'uppercase',
      background: won ? '#00ff8818' : '#ff336618',
      color: won ? '#00ff88' : '#ff3366',
      border: `1px solid ${won ? '#00ff8844' : '#ff336644'}`,
      fontFamily: 'monospace',
    }}>
      {won ? 'WON' : 'LOST'}
    </span>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [research, setResearch] = useState<ResearchItem[]>([])
  const [thinkLog, setThinkLog] = useState<string>('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [thinking, setThinking] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const thinkLogRef = useRef<HTMLDivElement>(null)

  const fetchAll = useCallback(async () => {
    try {
      const ts = Date.now()
      const [portfolioRes, researchRes, thinkLogRes] = await Promise.allSettled([
        fetch(`${API_URL}/portfolio?t=${ts}`).then(r => r.json()),
        fetch(`${API_URL}/research?t=${ts}`).then(r => r.json()),
        fetch(`${API_URL}/think-log?t=${ts}`).then(r => r.json()),
      ])

      if (portfolioRes.status === 'fulfilled') setPortfolio(portfolioRes.value)
      if (researchRes.status === 'fulfilled') {
        const data = researchRes.value
        setResearch(Array.isArray(data) ? data : [])
      }
      if (thinkLogRes.status === 'fulfilled') {
        setThinkLog(thinkLogRes.value?.log || '')
      }
      setLastUpdated(new Date())
      setError(null)
    } catch {
      setError('Failed to connect to backend')
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 5000)
    return () => clearInterval(interval)
  }, [fetchAll])

  useEffect(() => {
    if (thinkLogRef.current) {
      thinkLogRef.current.scrollTop = thinkLogRef.current.scrollHeight
    }
  }, [thinkLog])

  const handleThink = async () => {
    setThinking(true)
    try {
      await fetch(`${API_URL}/think`, { method: 'POST' })
      await fetchAll()
    } catch {
      setError('Think cycle failed')
    } finally {
      setThinking(false)
    }
  }

  const handleResolve = async () => {
    setResolving(true)
    try {
      await fetch(`${API_URL}/resolve`, { method: 'POST' })
      await fetchAll()
    } catch {
      setError('Resolve failed')
    } finally {
      setResolving(false)
    }
  }

  const p = portfolio
  const openPositions = p?.openPositions || []
  const closedPositions = p?.closedPositions || []
  const totalStaked = openPositions.reduce((s, pos) => s + (pos.stake || 0), 0)
  const winRate = p && (p.totalWins + p.totalLosses) > 0
    ? ((p.totalWins / (p.totalWins + p.totalLosses)) * 100).toFixed(1)
    : '--'
  const pnlPositive = p ? p.pnl >= 0 : true
  const totalValuePositive = p ? p.currentBankroll >= p.startingBankroll : true
  const thinkLines = thinkLog ? thinkLog.split('\n').slice(-50).filter(Boolean) : []

  const card: React.CSSProperties = {
    background: '#0f0f1a',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    padding: '16px',
  }

  const tableCell: React.CSSProperties = {
    padding: '7px 8px',
    fontSize: 11,
    fontFamily: 'monospace',
    borderBottom: '1px solid #111118',
  }

  const tableHead: React.CSSProperties = {
    ...tableCell,
    color: '#444',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontWeight: 400,
    fontSize: 10,
    borderBottom: '1px solid #1a1a2e',
  }

  return (
    <div style={{ background: '#0a0a0f', minHeight: '100vh', padding: '16px', maxWidth: 1600, margin: '0 auto', paddingBottom: 80 }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#0f0f1a', border: '1px solid #1a1a2e', borderRadius: 6,
        padding: '12px 16px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{
            fontFamily: 'monospace', fontSize: 18, fontWeight: 700, letterSpacing: '0.15em',
            color: '#00d4ff', textShadow: '0 0 16px #00d4ff, 0 0 32px #00d4ff44', margin: 0,
          }}>
            LEVI // POLYMARKET INTELLIGENCE
          </h1>
          {p?.mode && (
            <span style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 3, textTransform: 'uppercase',
              letterSpacing: '0.15em', fontFamily: 'monospace',
              background: p.mode === 'live' ? '#ff336618' : '#ffd70018',
              color: p.mode === 'live' ? '#ff3366' : '#ffd700',
              border: `1px solid ${p.mode === 'live' ? '#ff336644' : '#ffd70044'}`,
              boxShadow: `0 0 8px ${p.mode === 'live' ? '#ff336633' : '#ffd70033'}`,
            }}>
              {p.mode.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11, fontFamily: 'monospace' }}>
          {error && <span style={{ color: '#ff3366' }}>&#9888; {error}</span>}
          <span style={{ color: '#333' }}>UPDATED {lastUpdated ? lastUpdated.toLocaleTimeString() : '--:--:--'}</span>
        </div>
      </div>

      {/* Row 1: Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <StatCard
          label="Total Value"
          value={fmt$(p?.currentBankroll)}
          sub={p ? `${fmtPct(((p.currentBankroll - p.startingBankroll) / p.startingBankroll) * 100)} from start` : '--'}
          valueColor={totalValuePositive ? '#00ff88' : '#ff3366'}
          glow={totalValuePositive ? '#00ff88' : '#ff3366'}
        />
        <StatCard
          label="P&L"
          value={p ? `${p.pnl >= 0 ? '+' : ''}${fmt$(p.pnl)}` : '--'}
          sub={p ? fmtPct(p.pnlPct) : '--'}
          valueColor={pnlPositive ? '#00ff88' : '#ff3366'}
          glow={pnlPositive ? '#00ff88' : '#ff3366'}
        />
        <StatCard
          label="Win Rate"
          value={winRate === '--' ? '--' : `${winRate}%`}
          sub={p ? `${p.totalWins}W / ${p.totalLosses}L` : '--'}
          valueColor="#ffd700"
          glow="#ffd700"
        />
        <StatCard
          label="Open Positions"
          value={p ? String(openPositions.length) : '--'}
          sub={`${fmt$(totalStaked)} staked`}
          valueColor="#00d4ff"
          glow="#00d4ff"
        />
      </div>

      {/* Row 2: Main */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>

        {/* Left 60% */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Open Positions */}
          <div style={card}>
            <SectionHeader title="Open Positions" />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Question', 'Outcome', 'My Edge', 'Stake', 'Pot. Profit', 'Days Left'].map(h => (
                      <th key={h} style={{ ...tableHead, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openPositions.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ ...tableCell, textAlign: 'center', color: '#333', padding: '24px 0' }}>
                        No open positions
                      </td>
                    </tr>
                  ) : openPositions.map(pos => (
                    <tr key={pos.id} style={{ transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#ffffff05')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ ...tableCell, color: '#bbb', maxWidth: 260 }}>
                        <span title={pos.question}>{truncate(pos.question, 50)}</span>
                      </td>
                      <td style={tableCell}>
                        <span style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 3,
                          background: pos.outcome?.toLowerCase() === 'yes' ? '#00ff8818' : '#ff336618',
                          color: pos.outcome?.toLowerCase() === 'yes' ? '#00ff88' : '#ff3366',
                          border: `1px solid ${pos.outcome?.toLowerCase() === 'yes' ? '#00ff8844' : '#ff336644'}`,
                          fontFamily: 'monospace',
                        }}>
                          {pos.outcome || '--'}
                        </span>
                      </td>
                      <td style={{ ...tableCell, color: (pos.edge || 0) > 0 ? '#00ff88' : '#ff3366' }}>
                        {pos.edge != null ? `${(pos.edge * 100).toFixed(1)}%` : '--'}
                      </td>
                      <td style={{ ...tableCell, color: '#ffd700' }}>{fmt$(pos.stake)}</td>
                      <td style={{ ...tableCell, color: '#00ff88' }}>{fmt$(pos.potentialProfit)}</td>
                      <td style={{ ...tableCell, color: '#555' }}>{daysLeft(pos.endDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Research */}
          <div style={card}>
            <SectionHeader title="Recent Research" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {research.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: '#333' }}>No research data</div>
              ) : research.slice(0, 12).map((item, i) => {
                const edgePct = item.edge != null ? item.edge * 100 : null
                const edgePositive = edgePct != null && edgePct > 0
                const hasBet = item.action === 'BET' || (edgePct != null && edgePct > 3)
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
                    padding: '8px 10px', borderRadius: 4,
                    background: '#07070f', border: '1px solid #111118',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace', marginBottom: 4, lineHeight: 1.4 }}>
                        {truncate(item.question, 75)}
                      </div>
                      <div style={{ display: 'flex', gap: 14, fontSize: 10, fontFamily: 'monospace', flexWrap: 'wrap' }}>
                        <span style={{ color: '#444' }}>
                          MKT <span style={{ color: '#00d4ff' }}>
                            {item.marketPricePct != null
                              ? `${(item.marketPricePct * 100).toFixed(0)}%`
                              : item.yesPrice != null
                              ? `${(item.yesPrice * 100).toFixed(0)}%`
                              : '--'}
                          </span>
                        </span>
                        <span style={{ color: '#444' }}>
                          LEVI <span style={{ color: '#ffd700' }}>
                            {item.estimate?.probability != null
                              ? `${(item.estimate.probability * 100).toFixed(0)}%`
                              : '--'}
                          </span>
                        </span>
                        <span style={{ color: edgePositive ? '#00ff88' : '#ff3366' }}>
                          EDGE {edgePct != null ? `${edgePct.toFixed(1)}%` : '--'}
                        </span>
                        <span style={{ color: '#333' }}>{timeAgo(item.researchedAt)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <ConfidenceBadge confidence={item.estimate?.confidence || 'low'} />
                      <span style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 3, textTransform: 'uppercase',
                        fontFamily: 'monospace',
                        background: hasBet ? '#00ff8818' : '#1a1a1a',
                        color: hasBet ? '#00ff88' : '#444',
                        border: `1px solid ${hasBet ? '#00ff8844' : '#333'}`,
                      }}>
                        {hasBet ? 'BET' : 'SKIP'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right 40% */}
        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Portfolio Curve */}
          <div style={card}>
            <SectionHeader title="Portfolio Curve" />
            <PortfolioCurve portfolio={portfolio} />
          </div>

          {/* Trade History */}
          <div style={card}>
            <SectionHeader title="Trade History" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {closedPositions.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: '#333' }}>No closed positions</div>
              ) : [...closedPositions].slice(-10).reverse().map((pos, i) => (
                <div key={pos.id || i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '7px 10px', borderRadius: 4,
                  background: '#07070f', border: '1px solid #111118',
                }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                    <span title={pos.question}>{truncate(pos.question, 42)}</span>
                    <span style={{ color: '#333', marginLeft: 6 }}>{pos.outcome}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <WonLostBadge status={pos.status} />
                    <span style={{
                      fontSize: 11, fontFamily: 'monospace',
                      color: (pos.pnl || 0) >= 0 ? '#00ff88' : '#ff3366',
                    }}>
                      {pos.pnl != null ? `${pos.pnl >= 0 ? '+' : ''}${fmt$(pos.pnl)}` : '--'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Row 3: Think Log */}
      <div style={{ ...card, marginBottom: 14 }}>
        <SectionHeader title="Think Log" />
        <div
          ref={thinkLogRef}
          style={{
            background: '#030306',
            border: '1px solid #0d0d18',
            borderRadius: 4,
            padding: '10px 12px',
            height: 240,
            overflowY: 'auto',
            fontFamily: 'ui-monospace, Consolas, "Cascadia Code", monospace',
            fontSize: 11,
            lineHeight: 1.6,
            color: '#00ff88',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {thinkLines.length === 0 ? (
            <span style={{ color: '#0d2a0d' }}>{'> awaiting think cycle...'}</span>
          ) : thinkLines.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith('[') || line.startsWith('===') ? '#00d4ff'
                : line.toLowerCase().includes('error') || line.toLowerCase().includes('fail') ? '#ff3366'
                : line.toLowerCase().includes('warn') ? '#ffd700'
                : '#00ff88',
            }}>
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Floating Controls */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', gap: 10, zIndex: 100 }}>
        <button
          onClick={handleResolve}
          disabled={resolving}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: 6, fontSize: 13,
            fontFamily: 'monospace', fontWeight: 500, cursor: resolving ? 'not-allowed' : 'pointer',
            background: '#0f0f1a', border: '1px solid #ffd70044', color: '#ffd700',
            boxShadow: resolving ? 'none' : '0 0 16px #ffd70022',
            opacity: resolving ? 0.6 : 1, transition: 'all 0.2s',
          }}
        >
          {resolving
            ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#8635;</span> Resolving...</>
            : <>&#10003; Resolve</>
          }
        </button>
        <button
          onClick={handleThink}
          disabled={thinking}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: 6, fontSize: 13,
            fontFamily: 'monospace', fontWeight: 500, cursor: thinking ? 'not-allowed' : 'pointer',
            background: '#0f0f1a', border: '1px solid #00d4ff44', color: '#00d4ff',
            boxShadow: thinking ? '0 0 20px #00d4ff44' : '0 0 12px #00d4ff22',
            opacity: thinking ? 0.8 : 1, transition: 'all 0.2s',
          }}
        >
          {thinking
            ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#8635;</span> Thinking...</>
            : <>{'\u{1F9E0}'} Think Now</>
          }
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
