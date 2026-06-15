import type { TableSpec } from './types'

// One-click Excel (.xlsx) export of an answer table. Lazy-imports SheetJS so it
// only loads when the user actually downloads.
export async function exportTableToXlsx(filename: string, table: TableSpec) {
  const XLSX = await import('xlsx')
  const aoa = [table.columns, ...table.rows.map((r) => r.map((c) => (c === null ? '' : c)))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Reasonable column widths based on header length.
  ws['!cols'] = table.columns.map((c) => ({ wch: Math.min(40, Math.max(12, String(c).length + 2)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}
