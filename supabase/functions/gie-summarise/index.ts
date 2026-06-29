// GIE — Summary brain. Reads new gie_raw_messages per due group, asks Claude for a
// structured brief (memo + rolling summary + leadership flags + draft tasks) in ONE
// forced-tool call, writes gie_summaries / gie_flagged_items / gie_draft_tasks, then
// advances last_summarised_at and bumps gie_pulse (realtime). Machine-only: callers
// must present the service-role key as a bearer (n8n Schedule Trigger does this).
//
// Body (optional): { group_id?: string, force?: boolean }
//   - group_id: process just one group (used for manual tests)
//   - force:    ignore the cadence gate and summarise any group with new messages

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'claude-sonnet-4-6'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MAX_MESSAGES = 400      // hard cap per group per run
const MAX_FLAGS = 15
const MAX_DRAFTS = 15

// Command Center v2 — points are a reward currency drawn from a fixed ladder.
// The AI suggests a tier; we snap to the nearest allowed value and prefill it as
// custom_points so the operator table shows a ready tier (operator can override).
const POINTS_LADDER = [50, 100, 150, 200, 300, 500, 1000, 2000]
function snapPoints(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 100
  let best = POINTS_LADDER[0], bd = Infinity
  for (const v of POINTS_LADDER) { const d = Math.abs(v - n); if (d < bd) { bd = d; best = v } }
  return best
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normName(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Decode a Supabase JWT's payload and return its `role` claim (no signature check —
// verify_jwt=true already validated the signature/issuer at the gateway).
function jwtRole(token: string): string | null {
  try {
    const p = token.split('.')[1]
    if (!p) return null
    return (JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).role as string) ?? null
  } catch {
    return null
  }
}

// Single structured output: everything the Command Center needs for one group/window.
const BRIEF_TOOL = {
  name: 'record_brief',
  description: 'Record the structured brief for this WhatsApp work group window.',
  input_schema: {
    type: 'object',
    properties: {
      memo_md: {
        type: 'string',
        description:
          'Markdown memo with EXACTLY these four sections as bold headers: **Key points**, **Decisions**, **Open items**, **Action requests from leadership**. Use short bullets. Factual only — never invent.',
      },
      rolling_summary: {
        type: 'string',
        description: 'A compact running summary (<= 200 tokens) that supersedes prior context for the next run.',
      },
      flags: {
        type: 'array',
        description: 'One entry ONLY for messages where a [LEADERSHIP] member explicitly @mentioned someone (shown as [MENTIONS: Name] in the transcript). Messages without a [MENTIONS:] tag are context only — do NOT flag them. Empty array if no @mention delegations found.',
        items: {
          type: 'object',
          properties: {
            excerpt: { type: 'string', description: 'The leadership ask, quoted or tightly paraphrased.' },
            leader_phone: { type: 'string', description: 'Phone of the leader who asked, if identifiable, else empty.' },
          },
          required: ['excerpt'],
        },
      },
      drafts: {
        type: 'array',
        description: 'A draft task ONLY for messages where a [LEADERSHIP] member @mentioned someone (shown as [MENTIONS: Name]). Do NOT generate drafts for status reports, updates, or any message without a [MENTIONS:] tag. Empty array if no @mention delegations found.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short imperative task title.' },
            description: { type: 'string' },
            assignee_name: { type: 'string', description: 'Best match from the known-people list, or empty if unclear.' },
            role_group: { type: 'string', description: 'Department/role of the assignee if known, else empty.' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            due_date: { type: 'string', description: 'ISO YYYY-MM-DD if stated/implied, else empty.' },
            suggested_points: { type: 'integer', description: 'Reward tier for completing this task — MUST be one of 50, 100, 150, 200, 300, 500, 1000, 2000. Pick by effort/size: trivial ack = 50, normal task = 100-200, multi-day or high-stakes = 300-1000.' },
          },
          required: ['title'],
        },
      },
    },
    required: ['memo_md', 'rolling_summary', 'flags', 'drafts'],
  },
}

async function callClaude(apiKey: string, system: string, user: string) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [BRIEF_TOOL],
      tool_choice: { type: 'tool', name: 'record_brief' },
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText)
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = await res.json()
  const block = (data.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === 'record_brief')
  if (!block?.input) throw new Error('Claude returned no record_brief output')
  return { brief: block.input as any, usage: data.usage }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  // Auth: accept EITHER the service_role key (n8n Schedule / cron) OR a logged-in
  // founder / admin / del_super user (the Command Center "Refresh" button).
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  let authorized = jwtRole(bearer) === 'service_role'
  if (!authorized && bearer) {
    const { data: { user } } = await admin.auth.getUser(bearer)
    if (user) {
      const { data: emp } = await admin
        .from('employees').select('role, del_super')
        .eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()
      authorized = !!emp && (emp.role === 'founder' || emp.role === 'admin' || emp.del_super === true)
    }
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401)

  let body: { group_id?: string; force?: boolean } = {}
  try { body = await req.json() } catch { /* empty body = process all due groups */ }

  // ── Due groups ────────────────────────────────────────────────────────────────
  let gq = admin.from('gie_groups').select('*').eq('is_active', true)
  if (body.group_id) gq = gq.eq('id', body.group_id)
  const { data: groups, error: gErr } = await gq
  if (gErr) return json({ error: gErr.message }, 500)

  const now = Date.now()
  const due = (groups ?? []).filter((g: any) =>
    body.force || body.group_id || !g.last_summarised_at ||
    (now - new Date(g.last_summarised_at).getTime()) >= g.summarise_every_minutes * 60000,
  )

  // ── Known people (for assignee grounding + name→id resolution) ──────────────────
  const { data: emps } = await admin
    .from('employees').select('id, name, role')
    .eq('is_active', true).is('points_alias_of', null)
  const peopleList = (emps ?? []).map((e: any) => `${e.name} (${e.role})`).join(', ')
  const empByName = new Map((emps ?? []).map((e: any) => [normName(e.name), e.id]))
  const empById  = new Map((emps ?? []).map((e: any) => [e.id, e.name]))

  const results: any[] = []

  for (const g of due) {
    const since = g.last_summarised_at ?? '1970-01-01T00:00:00Z'
    const { data: msgs, error: mErr } = await admin
      .from('gie_raw_messages').select('*')
      .eq('group_id', g.id).gt('sent_at', since)
      .order('sent_at', { ascending: true }).limit(MAX_MESSAGES)
    if (mErr) { results.push({ group: g.name, error: mErr.message }); continue }
    if (!msgs || msgs.length === 0) { results.push({ group: g.name, skipped: 'no new messages' }); continue }

    const { data: lastSum } = await admin
      .from('gie_summaries').select('rolling_summary')
      .eq('group_id', g.id).order('window_end', { ascending: false }).limit(1).maybeSingle()
    const rolling = lastSum?.rolling_summary ?? ''

    const windowStart = msgs[0].sent_at
    const windowEnd = msgs[msgs.length - 1].sent_at
    const transcript = msgs.map((m: any) => {
      const who = m.sender_name ?? m.sender_phone ?? 'Unknown'
      const lead = m.is_from_leadership ? ' [LEADERSHIP]' : ''
      const txt = m.body ?? m.transcript ?? `(${m.msg_type ?? 'non-text'})`
      // Enrich with phone-resolved mention names so Claude gets reliable assignee info
      const mentionIds: string[] = Array.isArray(m.mentioned_employee_ids) ? m.mentioned_employee_ids : []
      const mentionNames = mentionIds.map((id: string) => empById.get(id)).filter(Boolean).join(', ')
      const mentionTag = mentionNames ? ` [MENTIONS: ${mentionNames}]` : ''
      return `${who}${lead}${mentionTag}: ${txt}`
    }).join('\n')

    const system =
      `You summarise an internal company WhatsApp work group for leadership. Be concise and strictly factual — never invent facts, names, or commitments. ` +
      `CRITICAL RULE: Only generate flags and draft tasks for messages where a [LEADERSHIP] member explicitly tagged someone with @mention — these appear as [MENTIONS: Name] in the transcript. ` +
      `Messages WITHOUT a [MENTIONS:] tag are background context only — include them in the memo and summary but do NOT generate flags or drafts from them. ` +
      `When drafting tasks, the assignee is always the person named in [MENTIONS: Name]. Choose from this known-people list: ${peopleList || '(none provided)'}. ` +
      `Respond ONLY by calling the record_brief tool.`
    const user = `PRIOR ROLLING SUMMARY:\n${rolling || '(none)'}\n\nNEW MESSAGES (chronological):\n${transcript}`

    let brief: any, usage: any
    try { ({ brief, usage } = await callClaude(apiKey, system, user)) }
    catch (e) { results.push({ group: g.name, error: e instanceof Error ? e.message : String(e) }); continue }

    // Summary
    const { data: sum, error: sErr } = await admin.from('gie_summaries').insert({
      group_id: g.id,
      window_start: windowStart,
      window_end: windowEnd,
      memo_md: String(brief.memo_md ?? '').trim() || '(no memo produced)',
      rolling_summary: brief.rolling_summary ?? null,
      model: MODEL,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
    }).select('id').single()
    if (sErr) { results.push({ group: g.name, error: sErr.message }); continue }

    // Build phone-resolved mention map FIRST — used to gate both flags and drafts.
    // Only leadership messages with explicit @mentions qualify for flags/tasks.
    const windowMentionIds: string[] = msgs
      .filter((m: any) => m.is_from_leadership && Array.isArray(m.mentioned_employee_ids))
      .flatMap((m: any) => m.mentioned_employee_ids as string[])
    const mentionFreq = new Map<string, number>()
    for (const id of windowMentionIds) mentionFreq.set(id, (mentionFreq.get(id) ?? 0) + 1)
    const topMentionId = mentionFreq.size
      ? [...mentionFreq.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null
    const hasDelegation = mentionFreq.size > 0

    // Deterministic "who asked" + original message — the most recent leadership
    // message that carries an @mention. Drives the table's Assigned-by + excerpt.
    const leadMsg = [...msgs].reverse().find(
      (m: any) => m.is_from_leadership && Array.isArray(m.mentioned_employee_ids) && m.mentioned_employee_ids.length,
    )
    const assignedByName = leadMsg?.sender_name ?? null
    const assignedByPhone = leadMsg?.sender_phone ?? null
    const sourceExcerpt = leadMsg?.body ?? leadMsg?.transcript ?? null

    // Flags — only when a leadership member explicitly @mentioned someone
    const flags = (Array.isArray(brief.flags) ? brief.flags : [])
      .filter((f: any) => f?.excerpt && String(f.excerpt).trim())
      .slice(0, MAX_FLAGS)
    if (flags.length && hasDelegation) {
      await admin.from('gie_flagged_items').insert(flags.map((f: any) => ({
        group_id: g.id, summary_id: sum.id,
        leader_phone: f.leader_phone || assignedByPhone || null,
        excerpt: String(f.excerpt).trim(), status: 'open',
      })))
    }

    // Drafts — only when a leadership member explicitly @mentioned someone
    const drafts = (Array.isArray(brief.drafts) ? brief.drafts : [])
      .filter((d: any) => d?.title && String(d.title).trim())
      .slice(0, MAX_DRAFTS)
    if (drafts.length && hasDelegation) {
      await admin.from('gie_draft_tasks').insert(drafts.map((d: any) => {
        // 1st priority: phone-resolved mention ID  2nd: Claude's name match  3rd: null
        const nameMatch = d.assignee_name ? (empByName.get(normName(d.assignee_name)) ?? null) : null
        const assigneeId = nameMatch ?? topMentionId ?? null
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(d.due_date ?? '') ? d.due_date : null
        const pts = snapPoints(d.suggested_points)
        return {
          group_id: g.id, summary_id: sum.id,
          title: String(d.title).trim(),
          description: d.description || null,
          suggested_assignee_employee_id: assigneeId,
          role_group: d.role_group || null,
          task_date: dueDate,
          status: 'pending',
          // ── v2 operator-table enrichment ──
          on_behalf_of:        assignedByName,                         // originating leader
          assigned_by_name:    assignedByName,
          assigned_by_phone:   assignedByPhone,
          source_excerpt:      sourceExcerpt,
          assignee_confidence: assigneeId ? 'high' : 'low',
          due_at:              dueDate ? new Date(`${dueDate}T18:00:00`).toISOString() : null,
          suggested_points:    pts,
          custom_points:       pts,                                    // prefill the ladder tier (operator can override)
          needs_info:          !assigneeId || !dueDate,
        }
      }))
    }

    // Advance cursor only after successful writes → clean retry on failure.
    await admin.from('gie_groups').update({ last_summarised_at: windowEnd }).eq('id', g.id)
    results.push({ group: g.name, messages: msgs.length, flags: flags.length, drafts: drafts.length })
  }

  // One pulse bump → Command Center invalidates + refreshes live.
  await admin.from('gie_pulse').update({ bumped_at: new Date().toISOString() }).eq('id', 1)

  return json({ ok: true, processed_groups: results.length, results })
})
