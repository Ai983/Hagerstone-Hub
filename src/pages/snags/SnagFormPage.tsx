import { useEffect, useRef, useState } from 'react'

// Public, no-login snag report form for CLIENTS. Opened from a per-project link
// we WhatsApp them after handover: /s/snag?t=<token>.
//
// Deliberately standalone: no useAuth, and no import of lib/supabase — an
// external client has no session, and the anon key has no access to the snag
// tables anyway. Everything goes through the snag-intake edge function, which
// treats the token as the credential. Same shape as PublicAgeingReport.
//
// Almost every visitor opens this on a phone from WhatsApp, so it's mobile-first
// and single-column throughout.

const FN_URL = 'https://tpfvnerrjhqwipyonngf.supabase.co/functions/v1/snag-intake'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
// Kept in step with the same three constants in supabase/functions/snag-intake —
// the function is the one that actually enforces them.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_FILES = 20
// A 200 MB video off a phone is a long PUT. Uploading all of them at once just
// makes every one of them slow, so run a few at a time.
const UPLOAD_CONCURRENCY = 3

const PRIORITIES = [
  { value: 'low', label: 'Low — cosmetic, no rush' },
  { value: 'medium', label: 'Medium — needs attention' },
  { value: 'high', label: 'High — affecting daily use' },
  { value: 'urgent', label: 'Urgent — unsafe or unusable' },
]

interface Attachment { url: string; type: string; name: string; size: number }
interface Site { id: string; name: string; code: string }

/** A link is either for one site, or for a group of them (Vinfast has seven
 *  sites behind a single link) in which case the client picks theirs here. */
type LinkTarget =
  | { kind: 'project'; name: string; code: string }
  | { kind: 'group'; sites: Site[] }

export function SnagFormPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? ''

  const [target, setTarget] = useState<LinkTarget | null>(null)
  const [siteId, setSiteId] = useState('')
  // A missing ?t= is knowable on first render — derive it rather than setting
  // state from an effect just to say so.
  const [linkError, setLinkError] = useState<string | null>(
    () => token ? null : 'This link is missing its code. Please use the link we sent you.',
  )

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [priority, setPriority] = useState('medium')
  // One free-text question, not a title + a description. The Hub's queue headline
  // is derived server-side from the first sentence of this.
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  // Per-file upload percentage, keyed by index into `files`.
  const [pct, setPct] = useState<Record<number, number>>({})

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [doneRef, setDoneRef] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    fetch(`${FN_URL}?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('invalid')
        return r.json() as Promise<{ project_name?: string; project_code?: string; sites?: Site[] }>
      })
      .then((d) => {
        setTarget(d.sites
          ? { kind: 'group', sites: d.sites }
          : { kind: 'project', name: d.project_name ?? '', code: d.project_code ?? '' })
      })
      .catch(() => setLinkError('This link is not valid or has expired. Please contact your Hagerstone project manager for a new one.'))
  }, [token])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const errs: string[] = []
    const valid = picked.filter((f) => {
      const isImage = IMAGE_TYPES.includes(f.type)
      const isVideo = VIDEO_TYPES.includes(f.type)
      if (!isImage && !isVideo) { errs.push(`${f.name}: only photos and videos can be attached`); return false }
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
      if (f.size > limit) { errs.push(`${f.name}: too large (max ${limit / 1024 / 1024} MB)`); return false }
      return true
    })
    setFiles((prev) => {
      const room = MAX_FILES - prev.length
      // Silently dropping the tail reads as "the picker didn't work" on a phone.
      if (valid.length > room) {
        errs.push(`Only ${MAX_FILES} files can be attached — the last ${valid.length - room} were not added`)
      }
      return [...prev, ...valid.slice(0, Math.max(room, 0))]
    })
    setFormError(errs.length ? errs.join(' · ') : null)
    e.target.value = ''
  }

  /** Ask the function for a signed URL, then PUT the file straight to storage —
   *  large videos never pass through the edge runtime.
   *
   *  XHR rather than fetch purely for upload.onprogress: a 200 MB video on mobile
   *  data is minutes of silence otherwise, and clients assume it has hung. */
  async function uploadOne(file: File, onProgress: (pct: number) => void): Promise<Attachment> {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: token, action: 'upload-url',
        filename: file.name, content_type: file.type, size: file.size,
      }),
    })
    if (!res.ok) throw new Error(`${file.name} could not be prepared for upload`)
    const { signed_url, public_url } = await res.json() as { signed_url: string; public_url: string }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', signed_url)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve() }
        else reject(new Error(`${file.name} failed to upload`))
      }
      xhr.onerror = () => reject(new Error(`${file.name} failed to upload`))
      xhr.onabort = () => reject(new Error(`${file.name} upload was cancelled`))
      xhr.send(file)
    })

    return { url: public_url, type: file.type, name: file.name, size: file.size }
  }

  /** Promise.allSettled over every file at once saturates a phone's uplink and
   *  makes each upload slower. Same settled-results shape, `limit` at a time. */
  async function uploadAll(list: File[]): Promise<PromiseSettledResult<Attachment>[]> {
    const results = new Array<PromiseSettledResult<Attachment>>(list.length)
    let next = 0
    const worker = async () => {
      while (next < list.length) {
        const i = next++
        try {
          const value = await uploadOne(list[i], (pct) => setPct((p) => ({ ...p, [i]: pct })))
          results[i] = { status: 'fulfilled', value }
        } catch (reason) {
          results[i] = { status: 'rejected', reason }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, list.length) }, worker),
    )
    return results
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (target?.kind === 'group' && !siteId) {
      setFormError('Please choose which site you are reporting for.')
      return
    }
    if (!name.trim() || !description.trim()) {
      setFormError('Please fill in your name and describe the problem.')
      return
    }
    // Mandatory, and checked again server-side. Caught here so the client is told
    // before we spend time uploading anything.
    if (!files.length) {
      setFormError('Please add at least one photo or video of the problem.')
      return
    }
    setSubmitting(true)
    setFormError(null)

    try {
      // allSettled so one bad file can't sink a report the client has already
      // typed out — upload what we can and tell them what didn't make it.
      const failed: string[] = []
      setProgress(`Uploading ${files.length} file(s)…`)
      setPct({})
      const results = await uploadAll(files)
      const attachments = results
        .filter((r): r is PromiseFulfilledResult<Attachment> => r.status === 'fulfilled')
        .map((r) => r.value)
      files.forEach((f, i) => { if (results[i].status === 'rejected') failed.push(f.name) })

      // An attachment is required, so "every upload failed" is a dead end rather
      // than a partial success — say so instead of letting the server 400.
      if (!attachments.length) {
        throw new Error('Your photo/video could not be uploaded, so the report was not submitted. Please check your connection and try again.')
      }

      setProgress('Submitting your report…')
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          t: token, action: 'submit',
          ...(target?.kind === 'group' ? { site_id: siteId } : {}),
          reporter_name: name.trim(),
          reporter_phone: phone.trim(),
          reporter_email: email.trim(),
          priority,
          description: description.trim(),
          attachments,
        }),
      })
      const data = await res.json() as { ok?: boolean; ref?: string; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Could not submit your report.')

      if (failed.length) {
        setFormError(`Submitted, but these files did not upload: ${failed.join(', ')}. You can send them to your project manager.`)
      }
      setDoneRef(data.ref ?? '')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
      setProgress('')
    }
  }

  const shell = (children: React.ReactNode) => (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fef9ec 0%, #fffbf0 40%, #fef3c7 100%)' }}
    >
      <header
        className="bg-white/70 backdrop-blur-md border-b border-amber-100/80 px-4 py-3"
        style={{ boxShadow: '0 2px 24px rgba(146,64,14,0.08)' }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="font-semibold text-stone-800 text-sm">Hagerstone — Report an Issue</div>
          <div className="text-[11px] text-stone-400">Post-handover snag reporting</div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-3 sm:px-4 py-5 sm:py-6">{children}</main>
    </div>
  )

  if (linkError) {
    return shell(
      <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center">
        <div className="text-3xl mb-3">🔗</div>
        <div className="text-stone-600 text-sm">{linkError}</div>
      </div>,
    )
  }

  if (doneRef !== null) {
    return shell(
      <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center">
        <div className="text-4xl mb-3">✅</div>
        <div className="text-stone-800 font-semibold mb-1">Thank you — your issue has been logged.</div>
        {doneRef && (
          <div className="text-sm text-stone-500 mb-3">
            Your reference number is <span className="font-mono font-semibold text-stone-800">{doneRef}</span>
          </div>
        )}
        <div className="text-sm text-stone-500">
          Our team has been notified and will get in touch with you shortly.
          Please quote the reference number in any follow-up.
        </div>
        {formError && <div className="mt-4 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">{formError}</div>}
      </div>,
    )
  }

  if (!target) {
    return shell(
      <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-400 text-sm animate-pulse">
        Loading…
      </div>,
    )
  }

  const inputCls = 'w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700'
  const labelCls = 'block text-xs font-semibold text-stone-600 mb-1.5'

  return shell(
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white rounded-2xl border border-stone-100 p-4 sm:p-5">
        {target.kind === 'project' ? (
          <>
            <div className="text-xs text-stone-400 mb-0.5">Reporting an issue for</div>
            <div className="font-semibold text-stone-800">
              {target.name}{target.code ? <span className="text-stone-400 font-normal"> · {target.code}</span> : null}
            </div>
          </>
        ) : (
          <div>
            <label className={labelCls} htmlFor="site">
              Which site are you reporting for? <span className="text-red-500">*</span>
            </label>
            <select
              id="site" className={inputCls} value={siteId}
              onChange={(e) => setSiteId(e.target.value)} required
            >
              <option value="">Select your site…</option>
              {target.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 p-4 sm:p-5 space-y-4">
        <div>
          <label className={labelCls} htmlFor="name">Your name <span className="text-red-500">*</span></label>
          <input id="name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="phone">Phone number</label>
            <input id="phone" type="tel" inputMode="tel" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="So we can call you back" />
          </div>
          <div>
            <label className={labelCls} htmlFor="email">Email</label>
            <input id="email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 p-4 sm:p-5 space-y-4">
        <div>
          <label className={labelCls} htmlFor="description">Describe the problem <span className="text-red-500">*</span></label>
          <textarea
            id="description" className={`${inputCls} min-h-[130px]`} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is the issue, where exactly is it, and when did you notice it? e.g. Water seepage on the bedroom ceiling, near the window — started after last week's rain."
            required
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="priority">How urgent is it?</label>
          <select id="priority" className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>Photos or video <span className="text-red-500">*</span></label>
          <p className="text-[11px] text-stone-400 mb-2">
            At least one is required — it is how our team sees the problem before visiting.
            You can attach as many as you need: photos up to {MAX_IMAGE_BYTES / 1024 / 1024} MB,
            videos up to {MAX_VIDEO_BYTES / 1024 / 1024} MB, {MAX_FILES} files in total.
          </p>
          <input
            ref={fileRef} type="file" multiple
            accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')}
            onChange={handleFileChange} className="hidden"
          />
          <button
            type="button" onClick={() => fileRef.current?.click()}
            disabled={submitting || files.length >= MAX_FILES}
            className="text-sm font-medium text-amber-800 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            + Add photos or videos
          </button>
          {files.length > 0 && (
            <span className="ml-2 text-[11px] text-stone-400">
              {files.length} of {MAX_FILES} attached
            </span>
          )}

          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="text-xs bg-stone-50 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-stone-600">
                      {f.type.startsWith('video/') ? '🎬' : '🖼️'} {f.name}
                      <span className="text-stone-400"> · {(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    </span>
                    {submitting ? (
                      <span className="text-stone-400 shrink-0 tabular-nums">{pct[i] ?? 0}%</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-stone-400 hover:text-red-600 shrink-0" aria-label={`Remove ${f.name}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {submitting && (
                    <div className="mt-1.5 h-1 rounded-full bg-stone-200 overflow-hidden">
                      <div
                        className="h-full bg-amber-700 transition-[width] duration-200"
                        style={{ width: `${pct[i] ?? 0}%` }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {formError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{formError}</div>
      )}

      <button
        type="submit" disabled={submitting}
        className="w-full bg-amber-800 text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-60 hover:bg-amber-900 transition-colors"
      >
        {submitting ? (progress || 'Submitting…') : 'Submit issue'}
      </button>
      <p className="text-[11px] text-stone-400 text-center pb-4">
        Your report goes straight to the Hagerstone team. You will get a reference number once submitted.
      </p>
    </form>,
  )
}
