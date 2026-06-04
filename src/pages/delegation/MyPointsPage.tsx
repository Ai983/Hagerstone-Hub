import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Star } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useGamification } from '../../lib/gamification'
import { useMyRecentPoints, useDelegationScores, type DelegationPeriod } from '../../lib/delegation-scores'
import { PointEntryCard } from '../../components/delegation/PointEntryCard'
import { SOURCE_LABEL, type PillStatus } from '../../lib/delegation-ui'

// ── Unified history row shapes ─────────────────────────────────────────────────

interface HistoryRow {
  id:        string
  date:      string
  source:    'delegation' | 'cps' | 'finance'
  points:    number
  title:     string   // short, scannable — the real task title or a short label
  summary?:  string   // full prose, revealed on tap (delegation AI string)
  status:    PillStatus
}

// Build CPS history rows from the gamification payload breakdown
function cpsRows(me: ReturnType<typeof useGamification>['data']): HistoryRow[] {
  if (!me?.me) return []
  const r = me.me
  const rows: HistoryRow[] = []
  const today = new Date().toISOString()
  if (r.stockPoints > 0)     rows.push({ id: 'cps-stock',    date: today, source: 'cps', points: r.stockPoints,      title: `Stock updates: ${r.stockDays} day(s)`,                   status: 'verified' })
  if (r.quotePoints > 0)     rows.push({ id: 'cps-quote',    date: today, source: 'cps', points: r.quotePoints,      title: `Quote wins: ${r.quoteWins} winning PO(s)`,               status: 'verified' })
  if (r.procurementPoints > 0) rows.push({ id: 'cps-proc',  date: today, source: 'cps', points: r.procurementPoints, title: `PR→Finance: ${r.procOnTime} on-time · ${r.procLate} late · ${r.procMissed} missed`, status: 'verified' })
  return rows
}

function financeRows(me: ReturnType<typeof useGamification>['data']): HistoryRow[] {
  if (!me?.me) return []
  const r = me.me
  const rows: HistoryRow[] = []
  const today = new Date().toISOString()
  if (r.imprestPoints > 0)       rows.push({ id: 'fin-imprest',  date: today, source: 'finance', points: r.imprestPoints,        title: `Imprest on time: ${r.imprestOnTime} submission(s)`,       status: 'verified' })
  if (r.financeProcessPoints > 0) rows.push({ id: 'fin-process', date: today, source: 'finance', points: r.financeProcessPoints,  title: `Imprest processed on time: ${r.financeOnTime} item(s)`, status: 'verified' })
  return rows
}

// ── Page ─────────────────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'delegation' | 'cps' | 'finance'
type StatusFilter = 'all' | 'verified' | 'pending'

export function MyPointsPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [period,       setPeriod]       = useState<DelegationPeriod>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const authUserId = employee?.auth_user_id ?? ''
  const roleGroup  = employee?.role ?? ''

  const { data: gamPayload } = useGamification()
  const { data: scores = [] } = useDelegationScores(period)
  const { data: delPoints = [] } = useMyRecentPoints(authUserId, 100)

  // My scores across all sources
  const myDelScore = scores.find((s) => s.user_id === authUserId)
  const groupSize  = scores.filter((s) => s.role_group === roleGroup).length
  const delRank    = myDelScore?.rank ?? null

  // Build delegation history rows — short title up top, AI prose behind the chevron
  const delegationRows: HistoryRow[] = delPoints.map((p) => ({
    id:      p.id,
    date:    p.awarded_at,
    source:  'delegation' as const,
    points:  p.points,
    title:   p.task_title ?? 'Delegation task',
    summary: p.reason,
    status:  p.status as PillStatus,
  }))

  // Build CPS + Finance rows (reconstructed from existing engine)
  const cpsList     = cpsRows(gamPayload)
  const financeList = financeRows(gamPayload)

  // Merge and filter
  const all: HistoryRow[] = [
    ...delegationRows,
    ...(sourceFilter === 'all' || sourceFilter === 'cps' ? cpsList : []),
    ...(sourceFilter === 'all' || sourceFilter === 'finance' ? financeList : []),
  ]
    .filter((r) => sourceFilter === 'all' || r.source === sourceFilter)
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (!employee) return null

  const LAUNCH_ROLES = ['site_engineer', 'procurement', 'finance', 'mis']
  const hasCps     = gamPayload?.me && ['site_engineer', 'procurement'].includes(roleGroup)
  const hasFinance = gamPayload?.me && ['finance', 'site_engineer'].includes(roleGroup)

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(180,120,30,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />

      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-6 py-3.5"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="text-stone-400 hover:text-stone-600">
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="font-semibold text-stone-800 text-sm flex items-center gap-1.5">
                <Star size={14} className="text-amber-600" /> My Points
              </div>
              <div className="text-xs text-stone-400">{employee.name}</div>
            </div>
          </div>
        </div>
      </motion.header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Rank summary */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {LAUNCH_ROLES.includes(roleGroup) && (
            <div className="bg-white/70 rounded-2xl border border-amber-100 p-4 text-center"
                 style={{ boxShadow: '0 2px 12px rgba(146,64,14,0.07)' }}>
              <div className="text-xs text-stone-400 mb-1">Delegation Rank</div>
              <div className="text-2xl font-bold text-amber-900">
                {delRank !== null ? `#${delRank}` : '—'}
              </div>
              <div className="text-xs text-stone-400">of {groupSize} · {roleGroup.replace(/_/g, ' ')}</div>
            </div>
          )}
          {hasCps && (
            <div className="bg-white/70 rounded-2xl border border-sky-100 p-4 text-center"
                 style={{ boxShadow: '0 2px 12px rgba(14,100,146,0.07)' }}>
              <div className="text-xs text-stone-400 mb-1">CPS Score</div>
              <div className="text-2xl font-bold text-sky-800">
                {gamPayload?.me
                  ? (gamPayload.me.stockPoints + gamPayload.me.quotePoints + gamPayload.me.procurementPoints)
                  : '—'
                }
              </div>
              <div className="text-xs text-stone-400">Rank #{gamPayload?.me?.rank ?? '—'} of {gamPayload?.me?.groupSize ?? '—'}</div>
            </div>
          )}
          {hasFinance && (
            <div className="bg-white/70 rounded-2xl border border-violet-100 p-4 text-center"
                 style={{ boxShadow: '0 2px 12px rgba(109,40,217,0.05)' }}>
              <div className="text-xs text-stone-400 mb-1">Finance Score</div>
              <div className="text-2xl font-bold text-violet-800">
                {gamPayload?.me ? (gamPayload.me.imprestPoints + gamPayload.me.financeProcessPoints) : '—'}
              </div>
              <div className="text-xs text-stone-400">via Finance engine</div>
            </div>
          )}
        </motion.div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Period */}
          <div className="flex gap-1 bg-white/60 border border-stone-100 rounded-xl p-1">
            {(['week', 'month', 'all'] as DelegationPeriod[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  period === p ? 'bg-amber-700 text-white' : 'text-stone-500 hover:text-stone-700'
                }`}>
                {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
              </button>
            ))}
          </div>

          {/* Source */}
          <div className="flex gap-1 bg-white/60 border border-stone-100 rounded-xl p-1">
            {(['all', 'delegation', 'cps', 'finance'] as SourceFilter[]).map((s) => (
              <button key={s} onClick={() => setSourceFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors capitalize ${
                  sourceFilter === s ? 'bg-stone-700 text-white' : 'text-stone-500 hover:text-stone-700'
                }`}>
                {s}
              </button>
            ))}
          </div>

          {/* Status */}
          <div className="flex gap-1 bg-white/60 border border-stone-100 rounded-xl p-1">
            {(['all', 'verified', 'pending'] as StatusFilter[]).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors capitalize ${
                  statusFilter === s ? 'bg-stone-700 text-white' : 'text-stone-500 hover:text-stone-700'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* History list — compact cards, AI prose hidden until tapped */}
        {all.length === 0 ? (
          <div className="bg-white/70 rounded-2xl border border-amber-100 px-5 py-12 text-center text-sm text-stone-400"
               style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}>
            In filters ke liye abhi koi points nahi mile 📊
          </div>
        ) : (
          <div className="space-y-2">
            {all.map((row) => (
              <PointEntryCard
                key={row.id}
                points={row.points}
                sourceLabel={SOURCE_LABEL[row.source]}
                taskTitle={row.title}
                status={row.status}
                date={row.date}
                summary={row.summary}
              />
            ))}
          </div>
        )}

        {/* CPS/Finance caveat */}
        {(hasCps || hasFinance) && (
          <p className="text-xs text-stone-400 text-center leading-relaxed">
            CPS and Finance rows are computed live from source records — they represent your
            current totals, not an immutable log. Detailed transaction history is available in
            the CPS and Finance modules.
          </p>
        )}
      </main>
    </div>
  )
}
