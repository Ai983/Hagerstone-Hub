import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ModuleId } from '../types'

export function useModules(employeeId: string | null) {
  const [accessibleModules, setAccessibleModules] = useState<ModuleId[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!employeeId) {
      setLoading(false)
      return
    }

    supabase
      .from('employee_module_access')
      .select('module_id, can_access')
      .eq('employee_id', employeeId)
      .then(({ data }) => {
        const accessible = (data ?? [])
          .filter(r => r.can_access)
          .map(r => r.module_id as ModuleId)
        setAccessibleModules(accessible)
        setLoading(false)
      })
  }, [employeeId])

  return { accessibleModules, loading }
}
