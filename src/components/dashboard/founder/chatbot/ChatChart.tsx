import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import type { ChartSpec } from './types'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend)

// Warm amber/stone palette to match the dashboard.
const PALETTE = ['#b45309', '#d97706', '#f59e0b', '#92400e', '#fbbf24', '#a16207', '#78350f', '#fcd34d']

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const datasets = spec.datasets.map((d, i) => ({
    label: d.label,
    data: d.data,
    backgroundColor: spec.kind === 'doughnut'
      ? spec.labels.map((_, j) => PALETTE[j % PALETTE.length])
      : PALETTE[i % PALETTE.length],
    borderColor: PALETTE[i % PALETTE.length],
    borderWidth: spec.kind === 'line' ? 2 : 0,
    tension: 0.3,
  }))

  const data = { labels: spec.labels, datasets }
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: spec.kind === 'doughnut' || spec.datasets.length > 1, labels: { font: { size: 11 } } },
      title: spec.title ? { display: true, text: spec.title, font: { size: 12 } } : { display: false },
    },
    scales: spec.kind === 'doughnut' ? undefined : {
      x: { ticks: { font: { size: 10 } } },
      y: { ticks: { font: { size: 10 } }, beginAtZero: true },
    },
  }

  return (
    <div className="h-56 w-full">
      {spec.kind === 'bar' && <Bar data={data} options={options} />}
      {spec.kind === 'line' && <Line data={data} options={options} />}
      {spec.kind === 'doughnut' && <Doughnut data={data} options={options} />}
    </div>
  )
}
