import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { RecognitionStrip } from '../components/dashboard/RecognitionStrip'
import { WorkLeaderboard } from '../components/dashboard/WorkLeaderboard'

export function LeaderboardPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}><ArrowLeft size={14} className="mr-1" /> Dashboard</Button>
          <span className="text-stone-300">|</span>
          <h1 className="font-semibold text-stone-800">Team Performance</h1>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        <div>
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Recognition · This Month</h2>
          <RecognitionStrip />
        </div>
        <div>
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Leaderboard</h2>
          <WorkLeaderboard />
        </div>
      </main>
    </div>
  )
}
