// del-create-task-type — Ritu/admin/founder adds a NEW delegation task type that
// persists forever in del_task_types (name + existing category + tier). Needed
// because del_task_types RLS is read-only for users; this runs as service role
// after authorizing the caller.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TIERS = ['S', 'M', 'L', 'XL']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Authorize caller
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } =
    await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: caller } = await supabase
    .from('employees')
    .select('role, is_active, del_super')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden' }, 403)
  const allowed = caller.role === 'founder' || caller.role === 'admin' || caller.del_super === true
  if (!allowed) return json({ error: 'Forbidden: not allowed to add task types' }, 403)

  // 2. Input
  const body = await req.json()
  const label = String(body.label ?? '').trim()
  const category = String(body.category ?? '').trim()
  const tier = String(body.tier ?? '').trim().toUpperCase()

  if (!label) return json({ error: 'label is required' }, 400)
  if (!TIERS.includes(tier)) return json({ error: 'tier must be S, M, L, or XL' }, 400)

  // 3. Category must already exist (keeps every type under a known AI rubric)
  const { data: cats } = await supabase
    .from('del_task_types')
    .select('role_group')
    .eq('role_group', category)
    .limit(1)
  if (!cats || cats.length === 0) {
    return json({ error: 'category does not exist' }, 400)
  }

  // 4. Unique code: category_slug, with numeric suffix if taken
  const base = `${category}_${slug(label)}` || `${category}_type`
  let code = base
  for (let i = 2; i < 50; i++) {
    const { data: existing } = await supabase
      .from('del_task_types').select('code').eq('code', code).limit(1)
    if (!existing || existing.length === 0) break
    code = `${base}_${i}`
  }

  // 5. Insert
  const { data: row, error: insErr } = await supabase
    .from('del_task_types')
    .insert({
      code,
      label,
      role_group: category,
      effort_tier: tier,
      scored_by: 'agent',
      active: true,
      daily_cap: null,
    })
    .select('id, code, label, role_group, effort_tier, scored_by, active')
    .single()
  if (insErr) return json({ error: insErr.message }, 500)

  return json({ success: true, task_type: row })
})
