import { useEffect, useState } from 'react'
import { ImprestAgeingSection } from '../components/dashboard/founder/ImprestAgeingSection'
import { CpsPrAgeingSection } from '../components/dashboard/founder/CpsPrAgeingSection'
import type { ImprestAgeing, CpsPrAgeing } from '../components/dashboard/founder/types'

// Public, no-login Imprest & Finance Ageing + CPS PR Ageing report. Linked from the daily
// founder WhatsApp. Reads ?k=<key> and fetches both datasets from their edge functions
// (Supabase neuters HTML served to anonymous browsers, so we render on the hub
// domain and pull JSON). Read-only — no auth, no navigation.
const IMPREST_FN = 'https://tpfvnerrjhqwipyonngf.supabase.co/functions/v1/imprest-ageing-digest'
const CPS_PR_FN = 'https://tpfvnerrjhqwipyonngf.supabase.co/functions/v1/cps-pr-ageing-digest'

type Tab = 'finance' | 'cps'

export function PublicAgeingReport() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') === 'cps' ? 'cps' : 'finance'))
  const [imprestData, setImprestData] = useState<ImprestAgeing | null>(null)
  const [cpsData, setCpsData] = useState<CpsPrAgeing | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k') ?? ''

    fetch(`${IMPREST_FN}?data=1&k=${encodeURIComponent(k)}`)
      .then(async (r) => {
        const t = await r.text()
        if (!r.ok) throw new Error('This report link is invalid or has expired.')
        return JSON.parse(t) as ImprestAgeing
      })
      .then(setImprestData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the report.'))

    fetch(`${CPS_PR_FN}?data=1&k=${encodeURIComponent(k)}`)
      .then(async (r) => {
        const t = await r.text()
        if (!r.ok) throw new Error('This report link is invalid or has expired.')
        return JSON.parse(t) as CpsPrAgeing
      })
      .then(setCpsData)
      .catch((e) => setError((prev) => prev ?? (e instanceof Error ? e.message : 'Could not load the report.')))
  }, [])

  const TabButton = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        tab === id ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}>
      <header className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-4 py-3" style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="font-semibold text-stone-800 text-sm">Hagerstone — Ageing Reports</div>
          <div className="text-[11px] text-stone-400">Live finance &amp; procurement reports · read-only</div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-6 space-y-5">
        {error && !imprestData && !cpsData ? (
          <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-500 text-sm">{error}</div>
        ) : (
          <>
            <div className="flex gap-2">
              <TabButton id="finance" label="⏳ Imprest & Finance" />
              <TabButton id="cps" label="🛒 CPS PR Ageing" />
            </div>

            {tab === 'finance' && (
              !imprestData
                ? <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-400 text-sm animate-pulse">Loading the latest report…</div>
                : <ImprestAgeingSection data={imprestData} loading={false} site={null} />
            )}

            {tab === 'cps' && (
              !cpsData
                ? <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-400 text-sm animate-pulse">Loading the latest report…</div>
                : <CpsPrAgeingSection data={cpsData} loading={false} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
