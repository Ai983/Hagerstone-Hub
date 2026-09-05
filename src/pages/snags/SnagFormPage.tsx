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
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const MAX_FILES = 10

const PRIORITIES = [
  { value: 'low', label: 'Low — cosmetic, no rush' },
  { value: 'medium', label: 'Medium — needs attention' },
  { value: 'high', label: 'High — affecting daily use' },
  { value: 'urgent', label: 'Urgent — unsafe or unusable' },
]

interface Attachment { url: string; type: string; name: string; size: number }

export function SnagFormPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? ''

  const [project, setProject] = useState<{ name: string; code: string } | null>(null)
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
        return r.json() as Promise<{ project_name: string; project_code: string }>
      })
      .then((d) => setProject({ name: d.project_name, code: d.project_code }))
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
    setFormError(errs.length ? errs.join(' · ') : null)
    setFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES))
    e.target.value = ''
  }

  /** Ask the function for a signed URL, then PUT the file straight to storage —
   *  large videos never pass through the edge runtime. */
  async function uploadOne(file: File): Promise<Attachment> {
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

    const put = await fetch(signed_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!put.ok) throw new Error(`${file.name} failed to upload`)

    return { url: public_url, type: file.type, name: file.name, size: file.size }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
      const results = await Promise.allSettled(files.map(uploadOne))
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

  if (!project) {
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
        <div className="text-xs text-stone-400 mb-0.5">Reporting an issue for</div>
        <div className="font-semibold text-stone-800">
          {project.name}{project.code ? <span className="text-stone-400 font-normal"> · {project.code}</span> : null}
        </div>
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
            Photos up to 10 MB, videos up to 50 MB. Up to {MAX_FILES} files.
          </p>
          <input
            ref={fileRef} type="file" multiple
            accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')}
            onChange={handleFileChange} className="hidden"
          />
          <button
            type="button" onClick={() => fileRef.current?.click()}
            className="text-sm font-medium text-amber-800 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 hover:bg-amber-100 transition-colors"
          >
            + Add photo or video
          </button>

          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs bg-stone-50 rounded-lg px-3 py-2">
                  <span className="truncate text-stone-600">
                    {f.type.startsWith('video/') ? '🎬' : '🖼️'} {f.name}
                    <span className="text-stone-400"> · {(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  </span>
                  <button
                    type="button" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-stone-400 hover:text-red-600 shrink-0" aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
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
