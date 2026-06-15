// Founder Dashboard analytics chatbot — read-only natural-language -> SQL.
// Founder/admin only. Streams NDJSON to the browser. Calls the Anthropic Messages
// API (raw fetch). Tools: run_sql, sample_distinct, lookup_person, present_result.
// A curated business-rules layer (chatbot_semantics_doc) makes answers accurate.
// All SQL goes through public.chatbot_exec_sql (read-only, guarded). See migrations.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildSystemPrompt } from './_prompt.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-sonnet-4-6'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MAX_TOOL_ITERS = 10
const ROW_CAP = 200
const MAX_RESULT_CHARS = 12000
// Extended thinking is opt-in: enabled thinking blocks must be replayed (with their
// signature) on every follow-up tool turn. Capture logic below supports it; default OFF.
const THINKING = (Deno.env.get('CHATBOT_THINKING') ?? 'off').toLowerCase()
const THINKING_ON = THINKING === 'on' || THINKING === 'adaptive'

const ALLOWED_SCHEMAS = new Set(['public', 'cps', 'cps_archive', 'finance', 'facade', 'marketing', 'lcs', 'scraper'])
const IDENT = /^[a-z_][a-z0-9_]*$/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── System prompt (catalog + business rules): fetched once per cold start ───────
let SYSTEM_CACHE: string | null = null
async function getSystemPrompt(admin: ReturnType<typeof createClient>): Promise<string> {
  if (SYSTEM_CACHE) return SYSTEM_CACHE
  const [{ data: catalog, error: catErr }, { data: semantics, error: semErr }] = await Promise.all([
    admin.rpc('chatbot_schema_catalog'),
    admin.rpc('chatbot_semantics_doc'),
  ])
  if (catErr) throw new Error(`schema catalog failed: ${catErr.message}`)
  if (semErr) throw new Error(`semantics doc failed: ${semErr.message}`)
  SYSTEM_CACHE = buildSystemPrompt(JSON.stringify(catalog), String(semantics ?? ''))
  return SYSTEM_CACHE
}

// ── Tools ───────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'run_sql',
    description:
      'Run ONE read-only PostgreSQL SELECT/WITH query against the business schemas and get rows back as JSON. Always schema-qualify tables and include a LIMIT (<=200) unless using aggregates. Ground every fact with this.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A single SELECT or WITH query.' } },
      required: ['sql'],
    },
  },
  {
    name: 'sample_distinct',
    description:
      'Get the top distinct values (with counts) of a column, to confirm a status/category vocabulary or find an id before filtering. Use this whenever unsure of an exact stored value.',
    input_schema: {
      type: 'object',
      properties: {
        schema: { type: 'string' },
        table: { type: 'string' },
        column: { type: 'string' },
        limit: { type: 'integer', description: 'Max distinct values (default 30, max 50).' },
      },
      required: ['schema', 'table', 'column'],
    },
  },
  {
    name: 'lookup_person',
    description:
      'Resolve a person name to candidate ids across all identity tables (public.employees, cps.cps_users, finance.employees, marketing.profiles, lcs.workers/contractor_profiles). Returns {module, table, id, name, email, role}. Call before filtering by a person.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'present_result',
    description:
      'Optionally attach a tidy data table and/or a chart to your answer, built from query results. Call at most once, only when it helps. Omit for single numbers or trivial results.',
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'object',
          properties: {
            columns: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array' } },
          },
          required: ['columns', 'rows'],
        },
        chart: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['bar', 'line', 'doughnut'] },
            title: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
            datasets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  data: { type: 'array', items: { type: 'number' } },
                },
                required: ['label', 'data'],
              },
            },
          },
          required: ['kind', 'labels', 'datasets'],
        },
      },
    },
  },
]

type Send = (obj: Record<string, unknown>) => void

// Validate + build a safe sample_distinct query (identifiers only, allowed schemas).
function buildSampleSql(input: any): string | null {
  const schema = String(input?.schema ?? '').toLowerCase()
  const table = String(input?.table ?? '')
  const column = String(input?.column ?? '')
  const limit = Math.min(Math.max(parseInt(String(input?.limit ?? '30'), 10) || 30, 1), 50)
  if (!ALLOWED_SCHEMAS.has(schema)) return null
  if (!IDENT.test(table) || !IDENT.test(column)) return null
  return `select ${column} as value, count(*) as n from ${schema}.${table} group by 1 order by 2 desc limit ${limit}`
}

// ── One streamed Anthropic turn: forwards text deltas, assembles content blocks ─
async function runClaudeTurn(
  apiKey: string,
  system: string,
  messages: unknown[],
  send: Send,
): Promise<{ content: any[]; stopReason: string | null; usage: any }> {
  const reqBody: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages,
    stream: true,
  }
  if (THINKING_ON) reqBody.thinking = { type: 'adaptive' }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(reqBody),
  })
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 500)}`)
  }

  const blocks: any[] = []
  let stopReason: string | null = null
  let usage: any = null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleEvent = (data: any) => {
    switch (data.type) {
      case 'message_start':
        usage = data.message?.usage ?? usage
        break
      case 'content_block_start':
        blocks[data.index] = data.content_block?.type === 'tool_use'
          ? { ...data.content_block, _partial: '' }
          : { ...data.content_block }
        if (data.content_block?.type === 'thinking') send({ type: 'status', label: 'thinking…' })
        break
      case 'content_block_delta': {
        const b = blocks[data.index]
        if (!b) break
        const d = data.delta
        if (d?.type === 'text_delta') { b.text = (b.text ?? '') + d.text; send({ type: 'text', delta: d.text }) }
        else if (d?.type === 'input_json_delta') { b._partial = (b._partial ?? '') + d.partial_json }
        else if (d?.type === 'thinking_delta') { b.thinking = (b.thinking ?? '') + d.thinking }
        else if (d?.type === 'signature_delta') { b.signature = (b.signature ?? '') + d.signature }
        break
      }
      case 'content_block_stop': {
        const b = blocks[data.index]
        if (b && b.type === 'tool_use') {
          try { b.input = b._partial ? JSON.parse(b._partial) : {} } catch { b.input = {} }
          delete b._partial
        }
        break
      }
      case 'message_delta':
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason
        if (data.usage) usage = { ...(usage ?? {}), ...data.usage }
        break
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try { handleEvent(JSON.parse(payload)) } catch { /* ignore keepalive */ }
    }
  }

  const content = blocks.filter(Boolean).map((b) => { if (b._partial !== undefined) delete b._partial; return b })
  return { content, stopReason, usage }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ── Auth: active founder/admin only ──────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: emp } = await admin
    .from('employees').select('id, role, name')
    .eq('auth_user_id', user.id).eq('is_active', true).single()
  if (!emp || (emp.role !== 'founder' && emp.role !== 'admin')) {
    return json({ error: 'Forbidden: founders and admins only' }, 403)
  }

  // ── Parse input ──────────────────────────────────────────────────────────────
  let body: { question?: string; conversation_id?: string | null }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const question = (body.question ?? '').trim()
  if (!question) return json({ error: 'question is required' }, 400)

  const system = await getSystemPrompt(admin)

  // ── Conversation bootstrap (history for multi-turn context) ──────────────────
  let conversationId = body.conversation_id ?? null
  let history: { role: string; content: string }[] = []
  if (conversationId) {
    const { data: conv } = await admin
      .from('chatbot_conversations').select('id, owner_id').eq('id', conversationId).single()
    if (!conv || conv.owner_id !== emp.id) conversationId = null
    else {
      const { data: msgs } = await admin
        .from('chatbot_messages').select('role, content')
        .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(20)
      history = (msgs ?? []) as { role: string; content: string }[]
    }
  }
  if (!conversationId) {
    const { data: conv, error: convErr } = await admin
      .from('chatbot_conversations').insert({ owner_id: emp.id, title: question.slice(0, 80) })
      .select('id').single()
    if (convErr) return json({ error: `could not start conversation: ${convErr.message}` }, 500)
    conversationId = conv.id
  }
  await admin.from('chatbot_messages').insert({ conversation_id: conversationId, role: 'user', content: question })

  // ── Stream the answer ────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send: Send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

      const sqlLog: { sql: string; row_count: number | null; error: string | null }[] = []
      let presentedTable: unknown = null
      let presentedChart: unknown = null
      let finalText = ''
      let lastUsage: any = null

      const messages: any[] = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: question },
      ]

      const runSql = async (sql: string, blockId: string, toolResults: any[]) => {
        const { data, error } = await admin.rpc('chatbot_exec_sql', { q: sql, row_cap: ROW_CAP })
        if (error) {
          sqlLog.push({ sql, row_count: null, error: error.message })
          send({ type: 'sql', sql, rows: null, error: error.message })
          toolResults.push({ type: 'tool_result', tool_use_id: blockId, is_error: true,
            content: `Query failed: ${error.message}. Rewrite the query and try again.` })
        } else {
          const rows = Array.isArray(data) ? data : []
          let payload = JSON.stringify(rows)
          if (payload.length > MAX_RESULT_CHARS) {
            payload = payload.slice(0, MAX_RESULT_CHARS) + `\n...[truncated — ${rows.length} rows; refine/aggregate]`
          }
          sqlLog.push({ sql, row_count: rows.length, error: null })
          send({ type: 'sql', sql, rows: rows.length, error: null })
          toolResults.push({ type: 'tool_result', tool_use_id: blockId, content: payload })
        }
      }

      try {
        send({ type: 'meta', conversationId })

        for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
          const { content, stopReason, usage } = await runClaudeTurn(apiKey, system, messages, send)
          lastUsage = usage ?? lastUsage

          if (stopReason !== 'tool_use') {
            finalText = content.filter((b) => b.type === 'text').map((b) => b.text).join('')
            break
          }

          messages.push({ role: 'assistant', content })
          const toolResults: any[] = []

          for (const b of content) {
            if (b.type !== 'tool_use') continue
            if (b.name === 'run_sql') {
              await runSql(String(b.input?.sql ?? ''), b.id, toolResults)
            } else if (b.name === 'sample_distinct') {
              send({ type: 'status', label: 'checking values…' })
              const sampleSql = buildSampleSql(b.input)
              if (!sampleSql) {
                toolResults.push({ type: 'tool_result', tool_use_id: b.id, is_error: true,
                  content: 'Invalid schema/table/column. Use exact lowercase identifiers from a business schema.' })
              } else {
                await runSql(sampleSql, b.id, toolResults)
              }
            } else if (b.name === 'lookup_person') {
              send({ type: 'status', label: 'finding people…' })
              const { data, error } = await admin.rpc('chatbot_resolve_person', { p_name: String(b.input?.name ?? '') })
              toolResults.push({ type: 'tool_result', tool_use_id: b.id,
                content: error ? `lookup failed: ${error.message}` : JSON.stringify(data ?? []) })
            } else if (b.name === 'present_result') {
              presentedTable = b.input?.table ?? null
              presentedChart = b.input?.chart ?? null
              send({ type: 'result', table: presentedTable, chart: presentedChart })
              toolResults.push({ type: 'tool_result', tool_use_id: b.id, content: 'Displayed to the user.' })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: `Unknown tool ${b.name}` })
            }
          }
          messages.push({ role: 'user', content: toolResults })
        }

        if (!finalText) {
          finalText = 'I could not complete a grounded answer within the allowed steps. Please rephrase or narrow the question.'
          send({ type: 'text', delta: finalText })
        }

        const { data: saved } = await admin.from('chatbot_messages').insert({
          conversation_id: conversationId, role: 'assistant', content: finalText,
          meta: { sql_log: sqlLog, table: presentedTable, chart: presentedChart, model: MODEL, usage: lastUsage },
        }).select('id').single()

        await admin.from('chatbot_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
        send({ type: 'done', conversationId, messageId: saved?.id ?? null })
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  })
})
