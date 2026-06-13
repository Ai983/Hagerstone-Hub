// Founder Dashboard analytics chatbot — read-only natural-language -> SQL.
// Founder/admin only. Streams NDJSON events to the browser. Calls the Anthropic
// Messages API directly (raw fetch) with a two-tool loop: run_sql + present_result.
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
const MAX_TOOL_ITERS = 6
const ROW_CAP = 200
const MAX_RESULT_CHARS = 12000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Schema catalog: fetched once per cold start, cached in the warm isolate ────
let CATALOG_CACHE: { systemPrompt: string; fingerprint: string } | null = null

async function getSystemPrompt(admin: ReturnType<typeof createClient>): Promise<string> {
  if (CATALOG_CACHE) return CATALOG_CACHE.systemPrompt
  const { data, error } = await admin.rpc('chatbot_schema_catalog')
  if (error) throw new Error(`schema catalog failed: ${error.message}`)
  const catalogJson = JSON.stringify(data)
  const fingerprint = (data as { fingerprint?: string })?.fingerprint ?? ''
  const systemPrompt = buildSystemPrompt(catalogJson)
  CATALOG_CACHE = { systemPrompt, fingerprint }
  return systemPrompt
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'run_sql',
    description:
      'Run ONE read-only PostgreSQL SELECT/WITH query against the business schemas and get the rows back as JSON. Always schema-qualify tables and include a LIMIT (<=200) unless using aggregates. Use this to ground every fact.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A single SELECT or WITH query.' } },
      required: ['sql'],
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

// ── One streamed Anthropic turn: forwards text deltas, assembles content blocks ─
async function runClaudeTurn(
  apiKey: string,
  system: string,
  messages: unknown[],
  send: Send,
): Promise<{ content: any[]; stopReason: string | null; usage: any }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      // Thinking is intentionally OFF: with the tool-use loop, an enabled thinking
      // block must be replayed back to the API with its signature on every follow-up
      // turn. Streaming + a hand-rolled parser makes that fragile, and it caused
      // follow-up requests to be rejected. Sonnet 4.6 reasons fine via the
      // query -> inspect -> refine tool loop without it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
      stream: true,
    }),
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
        break
      case 'content_block_delta': {
        const b = blocks[data.index]
        if (!b) break
        if (data.delta?.type === 'text_delta') {
          b.text = (b.text ?? '') + data.delta.text
          send({ type: 'text', delta: data.delta.text })
        } else if (data.delta?.type === 'input_json_delta') {
          b._partial = (b._partial ?? '') + data.delta.partial_json
        }
        // thinking_delta intentionally not forwarded
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
      try { handleEvent(JSON.parse(payload)) } catch { /* ignore malformed keepalive */ }
    }
  }

  // strip internal helpers, drop empty thinking blocks the API may emit
  const content = blocks.filter(Boolean).map((b) => {
    if (b._partial !== undefined) delete b._partial
    return b
  })
  return { content, stopReason, usage }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Auth: active founder/admin only ──────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } =
    await admin.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: emp } = await admin
    .from('employees')
    .select('id, role, name')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
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
    if (!conv || conv.owner_id !== emp.id) conversationId = null // not theirs -> start fresh
    else {
      const { data: msgs } = await admin
        .from('chatbot_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(20)
      history = (msgs ?? []) as { role: string; content: string }[]
    }
  }
  if (!conversationId) {
    const { data: conv, error: convErr } = await admin
      .from('chatbot_conversations')
      .insert({ owner_id: emp.id, title: question.slice(0, 80) })
      .select('id').single()
    if (convErr) return json({ error: `could not start conversation: ${convErr.message}` }, 500)
    conversationId = conv.id
  }
  await admin.from('chatbot_messages').insert({
    conversation_id: conversationId, role: 'user', content: question,
  })

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
              const sql = String(b.input?.sql ?? '')
              const { data, error } = await admin.rpc('chatbot_exec_sql', { q: sql, row_cap: ROW_CAP })
              if (error) {
                sqlLog.push({ sql, row_count: null, error: error.message })
                send({ type: 'sql', sql, rows: null, error: error.message })
                toolResults.push({
                  type: 'tool_result', tool_use_id: b.id, is_error: true,
                  content: `Query failed: ${error.message}. Rewrite the query and try again.`,
                })
              } else {
                const rows = Array.isArray(data) ? data : []
                let payload = JSON.stringify(rows)
                if (payload.length > MAX_RESULT_CHARS) {
                  payload = payload.slice(0, MAX_RESULT_CHARS) +
                    `\n...[truncated — ${rows.length} rows; refine the query or aggregate]`
                }
                sqlLog.push({ sql, row_count: rows.length, error: null })
                send({ type: 'sql', sql, rows: rows.length, error: null })
                toolResults.push({ type: 'tool_result', tool_use_id: b.id, content: payload })
              }
            } else if (b.name === 'present_result') {
              presentedTable = b.input?.table ?? null
              presentedChart = b.input?.chart ?? null
              send({ type: 'result', table: presentedTable, chart: presentedChart })
              toolResults.push({ type: 'tool_result', tool_use_id: b.id, content: 'Displayed to the user.' })
            } else {
              toolResults.push({
                type: 'tool_result', tool_use_id: b.id, is_error: true,
                content: `Unknown tool ${b.name}`,
              })
            }
          }

          messages.push({ role: 'user', content: toolResults })
        }

        if (!finalText) {
          finalText = 'I was unable to complete the answer within the allowed steps. Please try rephrasing.'
          send({ type: 'text', delta: finalText })
        }

        const { data: saved } = await admin.from('chatbot_messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: finalText,
          meta: {
            sql_log: sqlLog,
            table: presentedTable,
            chart: presentedChart,
            model: MODEL,
            usage: lastUsage,
          },
        }).select('id').single()

        await admin.from('chatbot_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId)

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
