import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 p-6">
      <div className="max-w-sm text-center space-y-4">{children}</div>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { employee, status, refresh, signOut } = useAuth()

  if (status === 'loading') {
    return (
      <Screen>
        <div className="text-amber-800 text-sm animate-pulse">Loading...</div>
      </Screen>
    )
  }

  // Only a genuinely missing session sends the user back to the login screen.
  if (status === 'anon') return <Navigate to="/login" replace />

  // Session is valid but the profile lookup failed. Redirecting here is what
  // made a network blip look like "the Hub logged me out by itself" — the user
  // would sign in again (successfully) and hit the same blip in a loop.
  if (status === 'error') {
    return (
      <Screen>
        <p className="text-stone-800 font-medium">Couldn't load your profile</p>
        <p className="text-sm text-stone-500">
          You are still signed in — this is a connection problem, not a password problem.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={refresh}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)' }}
          >
            Try again
          </button>
          <button onClick={signOut} className="px-4 py-2 rounded-lg text-sm text-stone-500 hover:text-stone-700">
            Sign out
          </button>
        </div>
      </Screen>
    )
  }

  if (status === 'no-profile' || !employee) {
    return (
      <Screen>
        <p className="text-stone-800 font-medium">No active Hub access</p>
        <p className="text-sm text-stone-500">
          Your sign-in worked, but this account has no active employee record. Contact IT at{' '}
          <a href="mailto:admin@hagerstone.com" className="text-amber-700 hover:underline">
            admin@hagerstone.com
          </a>
          .
        </p>
        <button onClick={signOut} className="px-4 py-2 rounded-lg text-sm text-stone-500 hover:text-stone-700">
          Sign out
        </button>
      </Screen>
    )
  }

  return <>{children}</>
}
