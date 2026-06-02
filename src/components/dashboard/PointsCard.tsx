import { Suspense, lazy, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Package, Trophy, FileText, Send, CheckCircle2 } from 'lucide-react'
import { POINTS, type MyScore, type GamificationGroup } from '../../lib/gamification'
import { useCountUp } from './useCountUp'

const PointsOrb = lazy(() => import('./three/PointsOrb'))

interface BreakdownRow {
  icon: React.ReactNode
  label: string
  detail: string
  points: number
}

function rowsForGroup(me: MyScore, group: GamificationGroup): BreakdownRow[] {
  switch (group) {
    case 'site_engineer':
      return [
        {
          icon: <Package size={15} className="text-amber-700" />,
          label: 'Stock Updates',
          detail: `${me.stockDays} ${me.stockDays === 1 ? 'day' : 'days'}`,
          points: me.stockPoints,
        },
        {
          icon: <Trophy size={15} className="text-amber-700" />,
          label: 'Quote Wins',
          detail: `${me.quoteWins} ${me.quoteWins === 1 ? 'win' : 'wins'}`,
          points: me.quotePoints,
        },
        {
          icon: <FileText size={15} className="text-amber-700" />,
          label: 'Imprest (on time)',
          detail: `${me.imprestOnTime} on-time`,
          points: me.imprestPoints,
        },
      ]
    case 'procurement':
      return [
        {
          icon: <Send size={15} className="text-amber-700" />,
          label: 'PR → Finance turnaround',
          detail: `${me.procOnTime} fast · ${me.procLate} late · ${me.procMissed} missed`,
          points: me.procurementPoints,
        },
      ]
    case 'finance':
      return [
        {
          icon: <CheckCircle2 size={15} className="text-amber-700" />,
          label: 'Imprests processed on time',
          detail: `${me.financeOnTime} on-time`,
          points: me.financeProcessPoints,
        },
      ]
    default:
      return []
  }
}

function rulesForGroup(group: GamificationGroup): string[] {
  switch (group) {
    case 'site_engineer':
      return [
        `Stock update: +${POINTS.STOCK_DAILY} / project / day`,
        `Quote win: +${POINTS.QUOTE_WIN} per winning PO`,
        `Imprest filed in time: +${POINTS.IMPREST_ONTIME} per submission`,
      ]
    case 'procurement':
      return [
        `PR dispatched ≤ ${POINTS.PROC_GRACE_DAYS} days: +${POINTS.PROC_FULL}`,
        `PR dispatched ≤ ${POINTS.PROC_LATE_CUTOFF_DAYS} days: +${POINTS.PROC_HALF}`,
        `Slower than ${POINTS.PROC_LATE_CUTOFF_DAYS} days: +0`,
      ]
    case 'finance':
      return [
        `Imprest approved (S2) ≤ ${POINTS.FINANCE_PROCESS_DAYS} days after S1: +${POINTS.FINANCE_PROCESS}`,
      ]
    default:
      return []
  }
}

export function PointsCard({ me, group }: { me: MyScore; group: GamificationGroup }) {
  const [open, setOpen] = useState(false)
  const rows = rowsForGroup(me, group)
  const rules = rulesForGroup(group)
  const animatedTotal = useCountUp(me.total)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="bg-white/70 backdrop-blur-sm rounded-2xl border border-amber-100 p-5"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.08)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">⭐</span>
        <h3 className="font-semibold text-stone-800 text-sm">Mere Points</h3>
      </div>

      {/* 3D orb hero with the live count-up total overlaid */}
      <div className="relative mb-5">
        <Suspense
          fallback={
            <div className="h-[200px] rounded-2xl bg-gradient-to-b from-amber-100 to-amber-200/60 animate-pulse" />
          }
        >
          <PointsOrb points={me.total} height={200} />
        </Suspense>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div
            className="text-5xl font-bold text-amber-900 leading-none tracking-tight tabular-nums"
            style={{ textShadow: '0 2px 12px rgba(255,255,255,0.6)' }}
          >
            {animatedTotal}
          </div>
          <div className="text-xs font-medium text-amber-800/80 mt-1">total points</div>
          <div className="mt-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm border border-amber-200 text-sm font-semibold text-stone-700">
            Rank #{me.rank} <span className="font-normal text-stone-400">of {me.groupSize}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-stone-600">
              {r.icon}
              <span>{r.label}</span>
              <span className="text-stone-400 text-xs">· {r.detail}</span>
            </div>
            <span className="font-semibold text-stone-700 tabular-nums">{r.points} pts</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-4 flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 transition-colors"
      >
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} />
        </motion.span>
        Points kaise milte hain?
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden mt-2 space-y-1"
          >
            {rules.map((rule) => (
              <li key={rule} className="text-xs text-stone-500 flex items-start gap-1.5">
                <span className="text-amber-600 mt-0.5">•</span>
                <span>{rule}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
