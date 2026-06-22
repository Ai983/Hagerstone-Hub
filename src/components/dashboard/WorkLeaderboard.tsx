import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Trophy, ChevronDown, Crown } from 'lucide-react'
import { Input } from '../ui/input'
import {
  useWorkScores, deptLabel, initials, type WorkPeriod, type WorkScoreRow,
} from '../../lib/work-scores'

const PERIODS: { key: WorkPeriod; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
]

const MEDAL = ['🥇', '🥈', '🥉']

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-amber-900 flex items-center justify-center text-xs font-bold shrink-0">
      {initials(name)}
    </div>
  )
}

// Mini stacked bar showing the task/ops/coord split of a person's total.
function SplitBar({ t, o, c }: { t: number; o: number; c: number }) {
  const sum = Math.max(t + o + c, 1)
  const seg = (v: number, cls: string, label: string) =>
    v > 0 ? <div className={cls} style={{ width: `${(v / sum) * 100}%` }} title={`${label}: ${v}`} /> : null
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-stone-100">
      {seg(t, 'bg-amber-500', 'Tasks')}
      {seg(o, 'bg-emerald-500', 'Operational')}
      {seg(c, 'bg-violet-500', 'Coordinator')}
    </div>
  )
}

function Row({ r, onClick }: { r: WorkScoreRow; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50/70 rounded-xl transition-colors text-left"
    >
      <span className="w-6 text-center text-sm font-semibold text-stone-400 shrink-0">
        {r.rank_in_dept <= 3 ? MEDAL[r.rank_in_dept - 1] : r.rank_in_dept}
      </span>
      <Avatar name={r.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-stone-800 text-sm truncate">{r.name}</span>
          {r.is_del_super && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 font-medium shrink-0">Coordinator</span>
          )}
        </div>
        <div className="mt-1"><SplitBar t={r.task_points} o={r.ops_points} c={r.coord_points} /></div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-lg font-bold text-stone-800 leading-none">{r.total}</div>
        <div className="text-[10px] text-stone-400 mt-0.5">pts</div>
      </div>
    </button>
  )
}

export function WorkLeaderboard() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<WorkPeriod>('month')
  const [search, setSearch] = useState('')
  const { data: rows = [], isLoading } = useWorkScores(period)

  const filtered = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  )

  // Company-wide Top 5 (across all departments)
  const stars = useMemo(
    () => [...rows].filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 5),
    [rows],
  )

  // Group filtered rows by department, departments ordered by their top score
  const groups = useMemo(() => {
    const m = new Map<string, WorkScoreRow[]>()
    for (const r of filtered) {
      if (!m.has(r.department)) m.set(r.department, [])
      m.get(r.department)!.push(r)
    }
    return [...m.entries()]
      .map(([dept, list]) => ({ dept, list: list.sort((a, b) => a.rank_in_dept - b.rank_in_dept) }))
      .sort((a, b) => (b.list[0]?.total ?? 0) - (a.list[0]?.total ?? 0))
  }, [filtered])

  const go = (id: string) => navigate(`/employee/${id}`)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input
            placeholder="Search employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
        <div className="flex bg-stone-100 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p.key ? 'bg-white text-amber-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Company Stars */}
      {!search && stars.length > 0 && (
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Crown size={15} className="text-amber-600" />
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Company Top 5 · {PERIODS.find((p) => p.key === period)?.label}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {stars.map((s, i) => (
              <button key={s.user_id} onClick={() => go(s.user_id)}
                className="bg-white/80 rounded-xl p-3 text-center hover:shadow-md transition-shadow">
                <div className="text-lg">{i < 3 ? MEDAL[i] : `#${i + 1}`}</div>
                <div className="mx-auto my-1 w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-amber-900 flex items-center justify-center text-xs font-bold">{initials(s.name)}</div>
                <div className="text-xs font-medium text-stone-700 truncate">{s.name}</div>
                <div className="text-base font-bold text-amber-800">{s.total}</div>
                <div className="text-[10px] text-stone-400">{deptLabel(s.department)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Department groups */}
      {isLoading ? (
        <div className="text-center py-10 text-stone-400 text-sm">Loading scores…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-10 text-stone-400 text-sm">No matching employees.</div>
      ) : (
        groups.map(({ dept, list }) => <DeptGroup key={dept} dept={dept} list={list} onPick={go} />)
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-stone-400 px-1">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Tasks</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Operational</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500" /> Coordinator</span>
      </div>
    </div>
  )
}

function DeptGroup({ dept, list, onPick }: { dept: string; list: WorkScoreRow[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const active = list.filter((r) => r.total > 0).length
  return (
    <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 bg-stone-50/70">
        <div className="flex items-center gap-2">
          <Trophy size={14} className="text-amber-500" />
          <span className="font-semibold text-stone-700 text-sm">{deptLabel(dept)}</span>
          <span className="text-xs text-stone-400">· {active}/{list.length} active</span>
        </div>
        <ChevronDown size={16} className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="p-1.5">
          {list.map((r) => <Row key={r.user_id} r={r} onClick={() => onPick(r.user_id)} />)}
        </div>
      )}
    </div>
  )
}
