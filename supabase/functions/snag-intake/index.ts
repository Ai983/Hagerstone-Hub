// snag-intake — public client-facing intake for post-handover snags.
//
// Clients open /s/snag?t=<token> on the hub domain (a genuinely unauthenticated
// page) and submit a defect report with photos/videos. This function is the only
// server side of that form: it validates the per-project token, mints signed
// upload URLs, records the report, and WhatsApps Saksham + Ritu.
//
// Deployed with verify_jwt = false — callers are anonymous browsers with no
// Authorization header. The per-project token IS the authentication, and every
// failure returns 404 rather than 401/403 so the endpoint gives nothing away
// about which tokens exist (same posture as imprest-ageing-digest's data mode).
//
// The client never touches the database directly: this runs under the service
// role, and the snag tables carry no anon RLS policy at all.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWhatsApp, normalizePhone } from '../_shared/maytapi.ts'

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

/** Deliberately opaque: an invalid, revoked and never-existed token look identical. */
function notFound() {
  return json({ error: 'Not found' }, 404)
}

const BUCKET = 'snag-uploads'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const MAX_ATTACHMENTS = 10

/** Storage rejects keys with characters outside a restricted set (e.g. "~",
 *  non-ASCII), which silently broke uploads elsewhere — same sanitisation as
 *  uploadAttachment() in src/lib/delegation.ts. */
function safeName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'file'
}

/** Placeholder rows like AI Team (9800000000) normalise to real, dialable numbers —
 *  auto-WhatsApping one would message a stranger. Mirrors gie-summarise. */
function isRealMobile(raw: string | null | undefined): boolean {
  const digits = (raw ?? '').replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  if (local.length !== 10) return false
  if (!/^[6-9]/.test(local)) return false
  return !/(\d)\1{6,}/.test(local)
}

interface Attachment { url: string; type: string; name: string; size: number }

/** Trust nothing from an anonymous caller: rebuild each attachment from scratch
 *  rather than storing whatever JSON was posted. */
function sanitizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_ATTACHMENTS).flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const { url, type, name, size } = a as Record<string, unknown>
    if (typeof url !== 'string' || !url.startsWith('http')) return []
    return [{
      url,
      type: typeof type === 'string' ? type.slice(0, 100) : '',
      name: typeof name === 'string' ? name.slice(0, 200) : 'file',
      size: typeof size === 'number' && Number.isFinite(size) ? size : 0,
    }]
  })
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** The form asks the client one question ("describe the problem"), but
 *  snag_reports.title is NOT NULL and is what the Hub queue lists. Derive a
 *  headline from the first line/sentence rather than making the client write the
 *  same thing twice. */
function deriveTitle(description: string): string {
  const firstLine = description.split('\n').map((l) => l.trim()).find(Boolean) ?? description
  // Cut at the first sentence end if one lands within a sensible headline length.
  const sentence = firstLine.match(/^(.{15,90}?[.!?])(\s|$)/)
  const head = (sentence ? sentence[1] : firstLine).trim().replace(/[.\s]+$/, '')
  return head.length > 90 ? `${head.slice(0, 89).trimEnd()}…` : head
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)

  // ── Resolve the per-project token first — every action needs it ────────────
  let token = url.searchParams.get('t') ?? ''
  let body: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try { body = await req.json() } catch { return notFound() }
    if (!token) token = str(body.t, 200)
  }
  if (!token) return notFound()

  const { data: link } = await supabase
    .from('snag_form_links')
    .select('id, project_id, is_active, revoked_at, projects!inner(name, code)')
    .eq('token', token)
    .maybeSingle()

  if (!link || !link.is_active || link.revoked_at) return notFound()

  const project = (link.projects ?? {}) as { name?: string; code?: string }

  // ── GET: what project is this link for? ───────────────────────────────────
  if (req.method === 'GET') {
    return json({ project_name: project.name ?? '', project_code: project.code ?? '' })
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const action = str(body.action, 40)

  // ── Mint a signed upload URL ──────────────────────────────────────────────
  // The browser uploads straight to storage with this. Keeps large videos off the
  // edge runtime, and means the bucket needs no anon write policy.
  if (action === 'upload-url') {
    const filename = str(body.filename, 200)
    const contentType = str(body.content_type, 100)
    const size = typeof body.size === 'number' ? body.size : -1

    if (!filename || size < 0) return json({ error: 'filename and size are required' }, 400)

    const isImage = IMAGE_TYPES.includes(contentType)
    const isVideo = VIDEO_TYPES.includes(contentType)
    if (!isImage && !isVideo) {
      return json({ error: 'Only photos (JPEG/PNG/WebP/HEIC) and videos (MP4/MOV/WebM) can be attached.' }, 400)
    }
    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
    if (size > limit) {
      return json({ error: `That file is too large. Limit is ${Math.round(limit / 1024 / 1024)} MB.` }, 400)
    }

    const path = `snag/${link.project_id}/${crypto.randomUUID()}-${safeName(filename)}`
    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)

    if (error || !signed) {
      console.error('[snag-intake] signed upload url failed', error?.message)
      return json({ error: 'Could not prepare the upload. Please try again.' }, 500)
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return json({
      path,
      token: signed.token,
      signed_url: signed.signedUrl,
      public_url: pub.publicUrl,
    })
  }

  // ── Submit the snag ───────────────────────────────────────────────────────
  if (action === 'submit') {
    const reporterName = str(body.reporter_name, 120)
    const description = str(body.description, 5000)

    if (!reporterName || !description) {
      return json({ error: 'Your name and a description of the problem are required.' }, 400)
    }

    const priorityRaw = str(body.priority, 20).toLowerCase()
    const priority = PRIORITIES.includes(priorityRaw) ? priorityRaw : 'medium'
    const attachments = sanitizeAttachments(body.attachments)

    // A photo or video is mandatory: a snag the team can't see is a snag they
    // have to drive to the site to understand. Enforced here too, not just in
    // the form — the form is only a convenience wrapper around this endpoint.
    if (!attachments.length) {
      return json({ error: 'Please attach at least one photo or video of the problem.' }, 400)
    }

    const title = deriveTitle(description)

    const { data: snag, error: insertErr } = await supabase
      .from('snag_reports')
      .insert({
        project_id: link.project_id,
        form_link_id: link.id,
        reporter_name: reporterName,
        reporter_phone: str(body.reporter_phone, 30) || null,
        reporter_email: str(body.reporter_email, 200) || null,
        priority,
        title,
        description,
        attachments,
      })
      .select('id, ref')
      .single()

    if (insertErr || !snag) {
      console.error('[snag-intake] insert failed', insertErr?.message)
      return json({ error: 'Could not save your report. Please try again.' }, 500)
    }

    await supabase.from('snag_events').insert({
      snag_id: snag.id,
      event_type: 'created',
      to_status: 'open',
      note: `Submitted by ${reporterName}`,
    })

    // ── Notify ──────────────────────────────────────────────────────────────
    // Never fails the submission: the client has already handed us the report,
    // and telling them it failed would just make them submit again. A failed
    // send is recorded instead, and surfaces on the Snags page.
    try {
      const { data: recipients } = await supabase
        .from('employees')
        .select('id, name, phone')
        .eq('snag_notify', true)
        .eq('is_active', true)

      const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
      const linkUrl = `${hubBase}/snags?ref=${encodeURIComponent(snag.ref)}`
      const lines = [
        `🔧 *New snag reported*`,
        ``,
        `*Ref:* ${snag.ref}`,
        `*Project:* ${project.name ?? '—'}${project.code ? ` (${project.code})` : ''}`,
        `*Client:* ${reporterName}${body.reporter_phone ? ` · ${str(body.reporter_phone, 30)}` : ''}`,
        `*Priority:* ${priority.toUpperCase()}`,
        ``,
        // No separate headline: title is derived from this text, so printing both
        // would just repeat the first sentence.
        description.length > 600 ? `${description.slice(0, 600)}…` : description,
        ``,
        `📎 ${attachments.length} attachment(s)`,
        `👉 ${linkUrl}`,
      ]
      const message = lines.join('\n')

      // De-duplicate by normalised phone. Ritu has two employee accounts; without
      // this, flagging both would WhatsApp her twice for one snag.
      const seen = new Set<string>()
      const targets = (recipients ?? []).filter((r) => {
        if (!isRealMobile(r.phone)) return false
        const key = normalizePhone(r.phone!)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      for (const r of targets) {
        const result = await sendWhatsApp({ phone: r.phone!, message })
        await supabase.from('snag_events').insert({
          snag_id: snag.id,
          event_type: 'notified',
          note: result.ok
            ? `WhatsApp queued for ${r.name}`
            : `WhatsApp send failed for ${r.name}`,
          recipient_phone: normalizePhone(r.phone!),
          // For a text send the gateway returns wa_messages.id — the join key the
          // Snags page uses to show real delivery status. `ok` only means queued.
          wa_message_id: result.ok ? result.msgId : null,
        })
      }
    } catch (e) {
      console.error('[snag-intake] notification step threw', String(e))
    }

    return json({ ok: true, ref: snag.ref })
  }

  return json({ error: 'Unknown action' }, 400)
})
