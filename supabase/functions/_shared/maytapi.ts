// Shared Maytapi WhatsApp sender for Hub edge functions.
// Product/phone match the working n8n flows (WF1 etc.); the API key lives ONLY in
// the MAYTAPI_API_KEY edge secret (this repo is public — never hardcode the key).
//
// Unlike the old inline callers, this READS the Maytapi JSON response: Maytapi
// returns HTTP 200 even when a send logically fails ({success:false}), so a bare
// `res.ok` check marked failures as "sent". We treat ok = res.ok && body.success.

const MAYTAPI_PRODUCT_ID = Deno.env.get('MAYTAPI_PRODUCT_ID') ?? 'b8cce1b9-0f9f-4aef-994c-d232716471f0'
const MAYTAPI_PHONE_ID = Deno.env.get('MAYTAPI_PHONE_ID') ?? '46821'
const MAYTAPI_API_KEY = Deno.env.get('MAYTAPI_API_KEY') ?? ''

/** Strip non-digits and ensure a single India country code. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.startsWith('91') ? digits : `91${digits}`
}

export interface WhatsAppResult {
  ok: boolean
  msgId: string | null
  raw: unknown
}

/** Send a WhatsApp text via Maytapi. Returns ok only when Maytapi confirms success. */
export async function sendWhatsApp(
  { phone, message }: { phone: string; message: string },
): Promise<WhatsAppResult> {
  if (!MAYTAPI_API_KEY) {
    console.error('[maytapi] MAYTAPI_API_KEY secret is not set')
    return { ok: false, msgId: null, raw: null }
  }
  const toNumber = normalizePhone(phone)
  try {
    const res = await fetch(
      `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-maytapi-key': MAYTAPI_API_KEY },
        body: JSON.stringify({ to_number: toNumber, type: 'text', message }),
      },
    )
    let body: Record<string, unknown> | null = null
    try { body = await res.json() } catch { /* non-JSON response */ }
    const data = (body?.data ?? null) as Record<string, unknown> | string | null
    const ok = res.ok && body?.success === true
    const msgId =
      (data && typeof data === 'object' ? (data.msg_id ?? data.id) : (typeof data === 'string' ? data : null)) as string | null ?? null
    if (!ok) console.error('[maytapi] send failed', { status: res.status, body })
    return { ok, msgId, raw: body }
  } catch (e) {
    console.error('[maytapi] send threw', String(e))
    return { ok: false, msgId: null, raw: null }
  }
}
