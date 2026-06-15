import { useState } from 'react'
import { FileSpreadsheet, FileText, ImageDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TableSpec } from './types'
import { exportTableToXlsx } from './exportXlsx'
import { downloadReport } from './exportPdf'

interface Props {
  question?: string
  answer: string
  table: TableSpec | null
  hasChart: boolean
  getChartPng: () => string | null
}

function slug(s: string | undefined): string {
  const base = (s ?? 'answer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `hagerstone-${base || 'answer'}`
}

export function MessageActions({ question, answer, table, hasChart, getChartPng }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  if (!table && !hasChart) return null
  const name = slug(question)

  const run = async (key: string, fn: () => void | Promise<void>) => {
    try { setBusy(key); await fn() } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed') } finally { setBusy(null) }
  }

  const btn = 'inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-amber-800 border border-stone-200 hover:border-amber-300 rounded-lg px-2 py-1 transition-colors disabled:opacity-50'

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
      {table && (
        <button className={btn} disabled={!!busy} onClick={() => run('xlsx', () => exportTableToXlsx(name, table))}>
          {busy === 'xlsx' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />} Excel
        </button>
      )}
      {hasChart && (
        <button className={btn} disabled={!!busy} onClick={() => run('png', () => {
          const png = getChartPng()
          if (!png) { toast.error('Chart not ready'); return }
          const a = document.createElement('a'); a.href = png; a.download = `${name}-chart.png`; a.click()
        })}>
          {busy === 'png' ? <Loader2 size={12} className="animate-spin" /> : <ImageDown size={12} />} Chart PNG
        </button>
      )}
      <button className={btn} disabled={!!busy} onClick={() => run('pdf', () =>
        downloadReport(name, { question, answer, table, chartPng: hasChart ? getChartPng() : null }))}>
        {busy === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Report (PDF)
      </button>
    </div>
  )
}
