import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { TableSpec } from './types'

type Cell = string | number | null

function fmt(cell: Cell): string {
  if (cell === null || cell === undefined) return '—'
  if (typeof cell === 'number') return cell.toLocaleString('en-IN')
  return String(cell)
}

// Sortable, sticky-header table for answer data. Numeric columns sort numerically
// and render right-aligned with en-IN grouping.
export function SortableTable({ table }: { table: TableSpec }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)

  const isNumericCol = useMemo(
    () => table.columns.map((_, c) => table.rows.length > 0 && table.rows.every(
      (r) => r[c] === null || typeof r[c] === 'number')),
    [table],
  )

  const rows = useMemo(() => {
    if (!sort) return table.rows
    const { col, dir } = sort
    return [...table.rows].sort((a, b) => {
      const av = a[col], bv = b[col]
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [table.rows, sort])

  if (!table.columns?.length) return null
  const toggle = (c: number) => setSort((s) => s && s.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: 1 })

  return (
    <div className="mt-2 overflow-auto rounded-xl border border-stone-200 max-h-[28rem]">
      <table className="w-full text-xs">
        <thead className="bg-stone-50 sticky top-0 z-10">
          <tr>
            {table.columns.map((c, i) => (
              <th
                key={i}
                onClick={() => toggle(i)}
                className={`px-2.5 py-2 font-medium text-stone-500 whitespace-nowrap cursor-pointer select-none hover:text-stone-700 ${isNumericCol[i] ? 'text-right' : 'text-left'}`}
              >
                <span className="inline-flex items-center gap-1">
                  {c}
                  {sort?.col === i && (sort.dir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-t border-stone-100 hover:bg-amber-50/40">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-2.5 py-1.5 whitespace-nowrap ${isNumericCol[ci] ? 'text-right tabular-nums text-stone-700' : 'text-stone-600'}`}>
                  {fmt(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
