import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import { Users, MapPin, AlertTriangle } from 'lucide-react'

// Shape returned by public.hr_attendance_overview() (admin/founder-gated RPC).
interface Overview {
  as_of: string
  ist_date: string
  today: {
    total_active: number; checked_in: number; present: number; late: number
    on_site_now: number; on_leave: number; absent: number
  }
  out_of_site: { name: string; code: string; site: string | null; distance_m: number | null; at: string; type: string }[]
  team: { employee_id: string; name: string; code: string; latitude: number; longitude: number; site_name: string | null; captured_at: string; live: boolean }[]
}

function useOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['hr-attendance-overview'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Overview | null> => {
      const { data, error } = await supabase.rpc('hr_attendance_overview')
      if (error) throw error
      return (data as Overview) ?? null
    },
  })
}

const fmtTime = (d: string) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function Kpi({ label, value, tone = 'stone' }: { label: string; value: number; tone?: string }) {
  const tones: Record<string, string> = {
    stone: 'text-stone-800', green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', blue: 'text-blue-600',
  }
  return (
    <div className="bg-white rounded-xl border border-stone-100 px-4 py-3" style={{ boxShadow: '0 2px 10px rgba(146,64,14,0.06)' }}>
      <div className={`text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-stone-400 mt-0.5">{label}</div>
    </div>
  )
}

export function AttendanceSection({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useOverview(enabled)

  return (
    <section id="attendance" className="scroll-mt-24 space-y-4">
      <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
        <Users size={15} /> Attendance — live
        {data?.ist_date && <span className="text-stone-400 font-normal">· {new Date(data.ist_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>}
      </h2>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">Couldn’t load attendance overview.</div>
      ) : isLoading ? (
        <div className="text-stone-400 text-sm animate-pulse px-1">Loading attendance…</div>
      ) : !data ? (
        <div className="text-stone-400 text-sm px-1">No access to attendance data.</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Kpi label="Active staff" value={data.today.total_active} />
            <Kpi label="Checked in" value={data.today.checked_in} tone="blue" />
            <Kpi label="On time" value={data.today.present} tone="green" />
            <Kpi label="Late" value={data.today.late} tone="amber" />
            <Kpi label="On site now" value={data.today.on_site_now} tone="green" />
            <Kpi label="On leave" value={data.today.on_leave} />
            <Kpi label="Absent" value={data.today.absent} tone="red" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Out of site */}
            <div className="bg-white rounded-2xl border border-stone-100" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
              <h3 className="px-4 py-3 font-medium text-stone-700 text-sm border-b border-stone-100 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" /> Off-site punches today
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 bg-stone-50/60">
                    <th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">Chose</th>
                    <th className="px-4 py-2 font-medium text-right">Distance</th><th className="px-4 py-2 font-medium">When</th>
                  </tr></thead>
                  <tbody>
                    {data.out_of_site.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400">Everyone on site 🎯</td></tr>
                    ) : data.out_of_site.map((r, i) => (
                      <tr key={i} className="border-t border-stone-50">
                        <td className="px-4 py-2 text-stone-700">{r.name} <span className="text-stone-400 text-xs">{r.code}</span></td>
                        <td className="px-4 py-2 text-stone-600">{r.site ?? '—'}</td>
                        <td className="px-4 py-2 text-right text-red-600 font-semibold">{r.distance_m != null ? `${r.distance_m} m` : '—'}</td>
                        <td className="px-4 py-2 text-stone-500">{fmtTime(r.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Team map (last-known positions) */}
            <div className="bg-white rounded-2xl border border-stone-100" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
              <h3 className="px-4 py-3 font-medium text-stone-700 text-sm border-b border-stone-100 flex items-center gap-2">
                <MapPin size={14} className="text-emerald-500" /> Team map — last known ({data.team.length})
              </h3>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 bg-stone-50/60">
                    <th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">Site</th>
                    <th className="px-4 py-2 font-medium">Seen</th><th className="px-4 py-2 font-medium">Map</th>
                  </tr></thead>
                  <tbody>
                    {data.team.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400">No location pings in the last 24h.</td></tr>
                    ) : data.team.map((p) => (
                      <tr key={p.employee_id} className="border-t border-stone-50">
                        <td className="px-4 py-2 text-stone-700">
                          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${p.live ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                          {p.name} <span className="text-stone-400 text-xs">{p.code}</span>
                        </td>
                        <td className="px-4 py-2 text-stone-600">{p.site_name ?? '—'}</td>
                        <td className="px-4 py-2 text-stone-500">{p.live ? 'live' : fmtTime(p.captured_at)}</td>
                        <td className="px-4 py-2">
                          <a href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">📍 open</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
