import { Download } from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { ProjectCostRow } from './types'
import { inr, exportToCSV } from './exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

interface Props {
  data: ProjectCostRow[]
  loading: boolean
  period: string
}

function EmptyState() {
  return <div className="py-10 text-center text-stone-400 text-sm">Is period mein data nahi 📊</div>
}

export function ProjectCostsSection({ data, loading, period }: Props) {
  const handleExport = () => {
    exportToCSV(`project-costs-${period}`, data as unknown as Record<string, unknown>[], [
      { key: 'display_name', label: 'Project' },
      { key: 'finance_actual', label: 'Finance Actual (INR)' },
      { key: 'cps_committed', label: 'CPS Committed (INR)' },
      { key: 'grand_total', label: 'Grand Total (INR)' },
    ])
  }

  const top10 = (data ?? []).slice(0, 10)

  const chartData = {
    labels: top10.map(r => r.display_name.length > 16 ? r.display_name.slice(0, 15) + '…' : r.display_name),
    datasets: [
      {
        label: 'Finance',
        data: top10.map(r => r.finance_actual),
        backgroundColor: '#d97706',
        borderRadius: 2,
      },
      {
        label: 'CPS PO',
        data: top10.map(r => r.cps_committed),
        backgroundColor: '#92400e',
        borderRadius: 2,
      },
    ],
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-stone-700">🏗️ Per-Project Cost Rollup</h2>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 border border-stone-200 rounded px-2 py-1"
        >
          <Download size={11} /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-stone-100 h-48 animate-pulse" />
      ) : !data?.length ? (
        <div className="bg-white rounded-2xl border border-stone-100 p-6"><EmptyState /></div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="bg-white rounded-2xl border border-stone-100 p-4" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
            <h3 className="text-xs font-medium text-stone-500 mb-3">Finance Actual vs CPS Committed (Top 10)</h3>
            <div style={{ height: 220 }}>
              <Bar
                data={chartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: 'y' as const,
                  scales: {
                    x: { stacked: true, ticks: { callback: (v) => `₹${(+v / 1000).toFixed(0)}K` } },
                    y: { stacked: true },
                  },
                  plugins: {
                    legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${inr(ctx.parsed.x)}` } },
                  },
                } as Parameters<typeof Bar>[0]['options']}
              />
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-stone-100 overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium text-right">Finance Actual</th>
                  <th className="px-4 py-3 font-medium text-right">CPS Committed</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.display_name} className="border-t border-stone-100 hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-2.5 text-stone-700">{r.display_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-600">{inr(r.finance_actual)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-stone-600">{inr(r.cps_committed)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-stone-800">{inr(r.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-2">
            {data.map((r) => (
              <div key={r.display_name} className="bg-white rounded-xl border border-stone-100 p-3">
                <div className="font-medium text-stone-800 text-sm mb-2">{r.display_name}</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-stone-400 block">Finance</span><span className="font-medium text-stone-700">{inr(r.finance_actual)}</span></div>
                  <div><span className="text-stone-400 block">CPS PO</span><span className="font-medium text-stone-700">{inr(r.cps_committed)}</span></div>
                  <div><span className="text-stone-400 block">Total</span><span className="font-semibold text-amber-800">{inr(r.grand_total)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
