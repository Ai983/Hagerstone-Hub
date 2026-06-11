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

  async function fetchEmployee(authUserId: string) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle() // returns null (not a 406) when there is no matching row

    if (error) {
      // Transient/auth error (e.g. token not yet attached) — do NOT null out the
      // employee, otherwise the user gets bounced back to the login screen.
      console.warn('[useAuth] fetchEmployee failed:', error.message)
      setLoading(false)
      return
    }

    setEmployee(data ?? null)
    setLoading(false)
  }

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return
      if (session?.user) fetchEmployee(session.user.id)
      else setLoading(false)
    })

    // IMPORTANT: never `await` a Supabase data call directly inside the
    // onAuthStateChange callback. The auth client holds an internal lock while
    // the callback runs; an awaited Supabase call inside it deadlocks the lock,
    // so the JWT never attaches to subsequent requests (they go out as anon →
    // 401/406) and the session gets dropped — i.e. "logged in for a second then
    // kicked back to login". Defer the work out of the callback with setTimeout.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id
      if (uid) {
        setTimeout(() => { if (active) fetchEmployee(uid) }, 0)
      } else {
        setEmployee(null)
        setLoading(false)
      }
    })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

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
