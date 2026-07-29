import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

/**
 * Auth status, kept separate from `employee` so callers can tell the three
 * "no employee" cases apart. Collapsing them into `employee === null` is what
 * caused users to be bounced to /login on a transient network error — i.e.
 * "I log in, I'm in for a second, then it logs me out again".
 *
 *   anon       — no Supabase session. Genuinely signed out; send to /login.
 *   ready      — session + employee row loaded. Normal case.
 *   no-profile — session is valid but there is no active public.employees row
 *                (deactivated / never onboarded). NOT a login failure.
 *   error      — session is valid but the employee lookup failed (network,
 *                RLS blip, token mid-refresh). Retry — never sign the user out.
 */
export type AuthStatus = 'loading' | 'anon' | 'ready' | 'no-profile' | 'error'

interface AuthState {
  employee: Employee | null
  loading: boolean
  status: AuthStatus
  isAdmin: boolean
  refresh: () => void
  signOut: () => Promise<void>
}

interface Snapshot {
  employee: Employee | null
  loading: boolean
  status: AuthStatus
}

/**
 * useAuth is consumed by ~18 components. As a plain hook, each one mounted its
 * own copy: N parallel getSession() calls, N employees queries and N
 * onAuthStateChange subscriptions on every dashboard render. One shared store
 * instead — a single fetch, a single subscription, one consistent answer for
 * every consumer.
 */
let snapshot: Snapshot = { employee: null, loading: true, status: 'loading' }
const listeners = new Set<() => void>()
let started = false
let currentUserId: string | null = null

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((l) => l())
}

const RETRIES = 3

async function loadEmployee(authUserId: string, attempt = 0): Promise<void> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle() // returns null (not a 406) when there is no matching row

  // The user may have signed out (or switched accounts) while this was in
  // flight — drop the stale result rather than write it over the new state.
  if (currentUserId !== authUserId) return

  if (error) {
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
      return loadEmployee(authUserId, attempt + 1)
    }
    console.warn('[useAuth] employee lookup failed after retries:', error.message)
    // Keep whatever employee we already had. The session is still valid, so the
    // user must NOT be redirected to /login — ProtectedRoute shows a retry.
    emit({ loading: false, status: snapshot.employee ? 'ready' : 'error' })
    return
  }

  emit({
    employee: data ?? null,
    loading: false,
    status: data ? 'ready' : 'no-profile',
  })
}

function start() {
  if (started) return
  started = true

  supabase.auth.getSession().then(({ data: { session } }) => {
    const uid = session?.user?.id ?? null
    currentUserId = uid
    if (uid) loadEmployee(uid)
    else emit({ employee: null, loading: false, status: 'anon' })
  })

  // IMPORTANT: never `await` a Supabase data call directly inside the
  // onAuthStateChange callback. The auth client holds an internal lock while
  // the callback runs; an awaited Supabase call inside it deadlocks the lock,
  // so the JWT never attaches to subsequent requests (they go out as anon →
  // 401/406) and the session gets dropped — i.e. "logged in for a second then
  // kicked back to login". Defer the work out of the callback with setTimeout.
  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null

    // TOKEN_REFRESHED / USER_UPDATED fire for the session we already have.
    // Re-fetching on those is pure noise, and a failure there used to be what
    // knocked a working session back to the login screen.
    if (uid && uid === currentUserId && snapshot.status === 'ready') return

    currentUserId = uid
    if (uid) {
      setTimeout(() => loadEmployee(uid), 0)
    } else if (event === 'SIGNED_OUT') {
      emit({ employee: null, loading: false, status: 'anon' })
    }
  })
}

export function refreshAuth() {
  if (currentUserId) loadEmployee(currentUserId)
}

export function useAuth(): AuthState {
  const [, forceRender] = useState(0)

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1)
    listeners.add(listener)
    start()
    return () => { listeners.delete(listener) }
  }, [])

  async function signOut() {
    currentUserId = null
    emit({ employee: null, loading: false, status: 'anon' })
    await supabase.auth.signOut()
  }

  return {
    employee: snapshot.employee,
    loading: snapshot.loading,
    status: snapshot.status,
    isAdmin: snapshot.employee?.role === 'admin',
    refresh: refreshAuth,
    signOut,
  }
}
