import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'

export function useFounderRealtime(enabled: boolean) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('founder-analytics-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'finance', table: 'expenses' },
        () => {
          qc.invalidateQueries({ queryKey: ['founder_headline_kpis'] })
          qc.invalidateQueries({ queryKey: ['founder_finance_summary'] })
          qc.invalidateQueries({ queryKey: ['founder_project_costs'] })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'cps', table: 'cps_purchase_orders' },
        () => {
          qc.invalidateQueries({ queryKey: ['founder_headline_kpis'] })
          qc.invalidateQueries({ queryKey: ['founder_cps_summary'] })
          qc.invalidateQueries({ queryKey: ['founder_project_costs'] })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'finance', table: 'imprest_requests' },
        () => {
          qc.invalidateQueries({ queryKey: ['founder_headline_kpis'] })
          qc.invalidateQueries({ queryKey: ['founder_finance_summary'] })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [enabled, qc])
}
