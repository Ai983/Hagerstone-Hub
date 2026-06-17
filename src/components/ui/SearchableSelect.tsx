import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'

export interface SearchOption {
  value: string
  label: string       // primary text (e.g. employee / project name)
  sublabel?: string   // secondary text shown muted (e.g. role / project code)
}

interface Props {
  options: SearchOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  /** Shown as a small grey hint when nothing is selected and not searching */
  ariaLabel?: string
}

/** Normalise for forgiving, spelling-tolerant matching: lowercase + strip
 *  non-alphanumerics so "arman ali" matches "Arman  Ali" / "armanali". */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function SearchableSelect({
  options, value, onChange, placeholder = 'Search…', emptyText = 'Koi match nahi', ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value) ?? null

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const filtered = useMemo(() => {
    const q = norm(query)
    if (!q) return options
    // rank: name starts-with first, then contains, on the normalised text
    const scored = options
      .map((o) => {
        const hay = norm(`${o.label} ${o.sublabel ?? ''}`)
        const idx = hay.indexOf(q)
        return { o, idx, starts: norm(o.label).startsWith(q) }
      })
      .filter((x) => x.idx !== -1)
      .sort((a, b) => (Number(b.starts) - Number(a.starts)) || (a.idx - b.idx))
    return scored.map((x) => x.o)
  }, [query, options])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => { setOpen((v) => !v); setQuery('') }}
        className="w-full flex items-center justify-between text-sm rounded-lg border border-input bg-background px-3 h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <span className={selected ? 'text-stone-800 truncate' : 'text-stone-400'}>
          {selected
            ? <>{selected.label}{selected.sublabel ? <span className="text-stone-400"> · {selected.sublabel}</span> : null}</>
            : placeholder}
        </span>
        <ChevronDown size={15} className="text-stone-400 shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white rounded-lg border border-stone-200 shadow-lg max-h-64 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100 sticky top-0 bg-white">
            <Search size={14} className="text-stone-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full text-sm outline-none placeholder:text-stone-400"
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-stone-400 text-center">{emptyText}</div>
            ) : (
              filtered.map((o) => {
                const isSel = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); setQuery('') }}
                    className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-amber-50 ${isSel ? 'bg-amber-50' : ''}`}
                  >
                    <span className="text-sm text-stone-700 truncate">
                      {o.label}
                      {o.sublabel ? <span className="text-stone-400"> · {o.sublabel}</span> : null}
                    </span>
                    {isSel && <Check size={14} className="text-amber-600 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
