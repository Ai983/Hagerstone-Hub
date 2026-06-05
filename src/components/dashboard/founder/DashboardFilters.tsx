import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import type { FilterState, Period } from './types'
import { PERIOD_LABELS } from './exportUtils'

const PERIODS: Period[] = ['week', 'month', 'quarter', 'ytd', 'all']

interface Employee { id: string; name: string; role: string }

interface Props {
  filters: FilterState
  onChange: (next: Partial<FilterState>) => void
  sites: string[]
  employees: Employee[]
  lastUpdated: Date | null
  onRefresh: () => void
  isLoading: boolean
}

export function DashboardFilters({
  filters,
  onChange,
  sites,
  employees,
  lastUpdated,
  onRefresh,
  isLoading,
}: Props) {
  const minsAgo = lastUpdated
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 60000)
    : null

  return (
    <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-amber-100/80 px-4 py-3"
      style={{ boxShadow: '0 2px 12px rgba(146,64,14,0.06)' }}>
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">

        {/* Period pills */}
        <div className="flex rounded-lg overflow-hidden border border-stone-200 shrink-0">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => onChange({ period: p })}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filters.period === p
                  ? 'bg-amber-800 text-white'
                  : 'bg-white text-stone-600 hover:bg-amber-50'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Site filter */}
        <Select
          value={filters.site ?? '__all__'}
          onValueChange={(v) => onChange({ site: v === '__all__' ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs w-44 border-stone-200">
            <SelectValue placeholder="All Sites" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Sites</SelectItem>
            {sites.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Person filter */}
        <Select
          value={filters.employeeId ?? '__all__'}
          onValueChange={(v) => onChange({ employeeId: v === '__all__' ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs w-44 border-stone-200">
            <SelectValue placeholder="All People" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All People</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Team / role group filter */}
        <Select
          value={filters.roleGroup ?? '__all__'}
          onValueChange={(v) => onChange({ roleGroup: v === '__all__' ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs w-40 border-stone-200">
            <SelectValue placeholder="All Teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Teams</SelectItem>
            <SelectItem value="procurement">Procurement</SelectItem>
            <SelectItem value="finance">Finance</SelectItem>
            <SelectItem value="site_engineer">Site Engineers</SelectItem>
            <SelectItem value="management">Management</SelectItem>
          </SelectContent>
        </Select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Live indicator + refresh */}
        <div className="flex items-center gap-2">
          {minsAgo !== null && (
            <span className="text-xs text-stone-400">
              Updated {minsAgo < 1 ? 'just now' : `${minsAgo}m ago`}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${isLoading ? 'animate-pulse' : ''}`} />
            Live
          </span>
          <button
            onClick={onRefresh}
            className="text-xs text-stone-400 hover:text-stone-600 px-2 py-1 rounded hover:bg-stone-100"
          >
            ↻ Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
