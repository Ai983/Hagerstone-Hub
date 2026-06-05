import type { Period } from './types'

export const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week',
  month: 'This Month',
  quarter: 'This Quarter',
  ytd: 'YTD',
  all: 'All Time',
}

export function exportToCSV(
  filename: string,
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[]
) {
  const header = columns.map((c) => `"${c.label}"`).join(',')
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key]
        if (val === null || val === undefined) return ''
        const str = String(val)
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      })
      .join(',')
  )
  const csv = [header, ...body].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const inr = (n: unknown) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n ?? 0))

export const num = (n: unknown) => Number(n ?? 0).toLocaleString('en-IN')

export const pct = (n: unknown) =>
  n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`
