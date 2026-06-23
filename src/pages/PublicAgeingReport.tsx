import { useEffect, useState } from 'react'
import { ImprestAgeingSection } from '../components/dashboard/founder/ImprestAgeingSection'
import type { ImprestAgeing } from '../components/dashboard/founder/types'

// Public, no-login Imprest & Finance Ageing report. Linked from the daily
// founder WhatsApp. Reads ?k=<key> and fetches the data from the edge function
// (Supabase neuters HTML served to anonymous browsers, so we render on the hub
// domain and pull JSON). Read-only — no auth, no navigation.
const FN = 'https://tpfvnerrjhqwipyonngf.supabase.co/functions/v1/imprest-ageing-digest'

export function PublicAgeingReport() {
  const [data, setData] = useState<ImprestAgeing | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k') ?? ''
    fetch(`${FN}?data=1&k=${encodeURIComponent(k)}`)
      .then(async (r) => {
        const t = await r.text()
        if (!r.ok) throw new Error('This report link is invalid or has expired.')
        return JSON.parse(t) as ImprestAgeing
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the report.'))
  }, [])

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}>
      <header className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-4 py-3" style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="font-semibold text-stone-800 text-sm">Hagerstone — Imprest &amp; Finance Ageing</div>
          <div className="text-[11px] text-stone-400">Live finance report · read-only</div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        {error ? (
          <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-500 text-sm">{error}</div>
        ) : !data ? (
          <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-400 text-sm animate-pulse">Loading the latest report…</div>
        ) : (
          <ImprestAgeingSection data={data} loading={false} site={null} />
        )}
      </main>
    </div>
  )
}
