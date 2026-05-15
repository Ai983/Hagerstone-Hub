import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

interface AuthState {
  employee: Employee | null
  loading: boolean
  isAdmin: boolean
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchEmployee(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchEmployee(session.user.id)
      } else {
        setEmployee(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchEmployee(authUserId: string) {
    const { data } = await supabase
      .from('employees')
      .select('*')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .single()

    setEmployee(data ?? null)
    setLoading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setEmployee(null)
  }

  return {
    employee,
    loading,
    isAdmin: employee?.role === 'admin',
    signOut,
  }
}
