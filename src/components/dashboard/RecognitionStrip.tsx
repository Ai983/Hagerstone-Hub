import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Star, TrendingUp, AlertTriangle } from 'lucide-react'
import { useWorkScores, useWorkScoresPrev, deptLabel, initials } from '../../lib/work-scores'

// Founder/admin recognition at a glance — fixed to "This Month" (the natural review cadence).
export function RecognitionStrip() {
  const navigate = useNavigate()
  const { data: cur = [] } = useWorkScores('month')
  const { data: prev = [] } = useWorkScoresPrev('month')

  // ⭐ Top performer per department (rank 1, with points)
  const stars = useMemo(
    () => cur.filter((r) => r.rank_in_dept === 1 && r.total > 0)
            .sort((a, b) => b.total - a.total).slice(0, 6),
    [cur],
  )

  // 📈 Most improved vs last month
  const improved = useMemo(() => {
    const prevMap = new Map(prev.map((r) => [r.user_id, r.total]))
    return cur
      .map((r) => ({ ...r, delta: r.total - (prevMap.get(r.user_id) ?? 0) }))
      .filter((r) => r.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5)
  }, [cur, prev])

  // ⚠️ Active but zero points this month
  const needsAttention = useMemo(
    () => cur.filter((r) => r.total === 0).slice(0, 8),
    [cur],
  )

  const go = (id: string) => navigate(`/employee/${id}`)
  const Person = ({ id, name, right, sub }: { id: string; name: string; right: string; sub?: string }) => (
    <button onClick={() => go(id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-stone-50 text-left">
      <div className="w-7 h-7 rounded-full bg-stone-200 text-stone-600 flex items-center justify-center text-[10px] font-bold shrink-0">{initials(name)}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-stone-700 truncate">{name}</div>
        {sub && <div className="text-[10px] text-stone-400 truncate">{sub}</div>}
      </div>
      <span className="text-sm font-semibold text-stone-700 shrink-0">{right}</span>
    </button>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Stars */}
      <div className="bg-white rounded-2xl border border-stone-100 p-3">
        <div className="flex items-center gap-2 mb-2 text-amber-700"><Star size={14} /><span className="text-xs font-semibold uppercase tracking-wide">Stars · Top per team</span></div>
        {stars.length ? stars.map((s) => <Person key={s.user_id} id={s.user_id} name={s.name} right={`${s.total}`} sub={deptLabel(s.department)} />)
          : <div className="text-xs text-stone-400 py-4 text-center">No points yet this month</div>}
      </div>
      {/* Most improved */}
      <div className="bg-white rounded-2xl border border-stone-100 p-3">
        <div className="flex items-center gap-2 mb-2 text-emerald-700"><TrendingUp size={14} /><span className="text-xs font-semibold uppercase tracking-wide">Most Improved</span></div>
        {improved.length ? improved.map((s) => <Person key={s.user_id} id={s.user_id} name={s.name} right={`+${s.delta}`} sub={deptLabel(s.department)} />)
          : <div className="text-xs text-stone-400 py-4 text-center">No change vs last month</div>}
      </div>
      {/* Needs attention */}
      <div className="bg-white rounded-2xl border border-stone-100 p-3">
        <div className="flex items-center gap-2 mb-2 text-red-600"><AlertTriangle size={14} /><span className="text-xs font-semibold uppercase tracking-wide">Needs Attention · 0 pts</span></div>
        {needsAttention.length ? needsAttention.map((s) => <Person key={s.user_id} id={s.user_id} name={s.name} right="0" sub={deptLabel(s.department)} />)
          : <div className="text-xs text-stone-400 py-4 text-center">Everyone's on the board 🎉</div>}
      </div>
    </div>
  )
}
