import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// TODO — Schedule this function:
// Weekly:  Monday 00:05 UTC  →  runs for the just-ended ISO week
// Monthly: 1st of month 00:05 UTC  →  also runs the just-ended month
//
// Current Supabase scheduling approach (as of 2026):
// Option A — pg_cron (if enabled on your project):
//   SELECT cron.schedule('del-finalize-weekly',  '5 0 * * 1', $$SELECT net.http_post(url,body,headers) FROM ...$$);
//   SELECT cron.schedule('del-finalize-monthly', '5 0 1 * *', $$...$$);
// Option B — Supabase Scheduled Functions (Dashboard > Edge Functions > Schedule):
//   Add a schedule for this function with cron '5 0 * * 1' and '5 0 1 * *'.
// Either way, pass { "finalize": "week" } or { "finalize": "both" } in the body.
//
// For manual testing:  curl -X POST <fn-url> -H "Authorization: Bearer <service-key>" -d '{"finalize":"both"}'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Returns the Monday of the ISO week for a given date string (YYYY-MM-DD). */
function isoWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1))
  return d.toISOString().slice(0, 10)
}

/** Returns "YYYY-MM-DD" for the Sunday ending the week starting on mondayStr. */
function weekSunday(mondayStr: string): string {
  const d = new Date(mondayStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toISOString().slice(0, 10)
}

/** Returns the last day of a month given its first-of-month string "YYYY-MM-01". */
function monthEnd(firstStr: string): string {
  const d = new Date(firstStr + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d.toISOString().slice(0, 10)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Auth: service-role or admin only ──────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const token = authHeader.replace('Bearer ', '')

  // Allow service-role key (no user session) or an admin employee
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const isServiceRole = token === serviceKey

  if (!isServiceRole) {
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: emp } = await supabase
      .from('employees').select('role').eq('auth_user_id', user.id).single()
    if (!emp || !['admin', 'founder'].includes(emp.role)) {
      return json({ error: 'Forbidden' }, 403)
    }
  }

  // ── Determine what to finalize ─────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const mode: 'week' | 'month' | 'both' = body.finalize ?? 'both'

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  // Just-ended ISO week: the week before the current one.
  // If running Monday, "just ended" = last Mon–Sun. Use a ref date = yesterday.
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const lastWeekMonday = isoWeekMonday(yesterday.toISOString().slice(0, 10))
  const lastWeekSunday = weekSunday(lastWeekMonday)

  // Just-ended month: the month before the current one.
  const lastMonthFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10)
  const lastMonthEnd = monthEnd(lastMonthFirst)

  const results: Record<string, unknown> = {}

  // ── Finalize weekly ────────────────────────────────────────────────────────
  if (mode === 'week' || mode === 'both') {
    const { data: scores, error: scErr } = await supabase.rpc('get_delegation_scores', {
      p_period: 'week',
      p_as_of:  lastWeekSunday,
    })
    if (scErr) return json({ error: `score fetch failed: ${scErr.message}` }, 500)

    const byRole: Record<string, typeof scores> = {}
    for (const row of (scores ?? [])) {
      if (!byRole[row.role_group]) byRole[row.role_group] = []
      byRole[row.role_group].push(row)
    }

    for (const [role, rows] of Object.entries(byRole)) {
      const winners = rows
        .sort((a: { total: number }, b: { total: number }) => b.total - a.total)
        .slice(0, 5)
        .map((r: { rank: number; user_id: string; user_name: string; total: number }, i: number) => ({
          rank: i + 1,
          user_id: r.user_id,
          name: r.user_name,
          points: r.total,
        }))

      const { error } = await supabase.from('del_period_winners').upsert({
        period_type:  'week',
        role_group:   role,
        start_date:   lastWeekMonday,
        end_date:     lastWeekSunday,
        winners,
        finalized:    true,
        finalized_at: now.toISOString(),
      }, { onConflict: 'period_type,role_group,start_date' })

      if (error) console.error(`week upsert ${role}:`, error.message)
    }
    results.week = { monday: lastWeekMonday, sunday: lastWeekSunday, roles: Object.keys(byRole) }
  }

  // ── Finalize monthly ───────────────────────────────────────────────────────
  if (mode === 'month' || mode === 'both') {
    const { data: scores, error: scErr } = await supabase.rpc('get_delegation_scores', {
      p_period: 'month',
      p_as_of:  lastMonthEnd,
    })
    if (scErr) return json({ error: `monthly score fetch failed: ${scErr.message}` }, 500)

    const byRole: Record<string, typeof scores> = {}
    for (const row of (scores ?? [])) {
      if (!byRole[row.role_group]) byRole[row.role_group] = []
      byRole[row.role_group].push(row)
    }

    for (const [role, rows] of Object.entries(byRole)) {
      const winners = rows
        .sort((a: { total: number }, b: { total: number }) => b.total - a.total)
        .slice(0, 5)
        .map((r: { rank: number; user_id: string; user_name: string; total: number }, i: number) => ({
          rank: i + 1,
          user_id: r.user_id,
          name: r.user_name,
          points: r.total,
        }))

      const { error } = await supabase.from('del_period_winners').upsert({
        period_type:  'month',
        role_group:   role,
        start_date:   lastMonthFirst,
        end_date:     lastMonthEnd,
        winners,
        finalized:    true,
        finalized_at: now.toISOString(),
      }, { onConflict: 'period_type,role_group,start_date' })

      if (error) console.error(`month upsert ${role}:`, error.message)
    }
    results.month = { first: lastMonthFirst, end: lastMonthEnd, roles: Object.keys(byRole) }
  }

  return json({ success: true, finalized_at: todayStr, ...results })
})
