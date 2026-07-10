// Shared Maytapi WhatsApp sender for Hub edge functions.
// Product/phone match the working n8n flows (WF1 etc.); the API key lives ONLY in
// the MAYTAPI_API_KEY edge secret (this repo is public — never hardcode the key).
//
// Unlike the old inline callers, this READS the Maytapi JSON response: Maytapi
// returns HTTP 200 even when a send logically fails ({success:false}), so a bare
// `res.ok` check marked failures as "sent". We treat ok = res.ok && body.success.
//
// Two phone contexts:
//   MAYTAPI_*     — business number (46821) for personal task notifications
//   MAYTAPI_GRP_* — Ma'am's number (141590) for group messages + @mentions

const MAYTAPI_PRODUCT_ID = Deno.env.get('MAYTAPI_PRODUCT_ID') ?? 'b8cce1b9-0f9f-4aef-994c-d232716471f0'
const MAYTAPI_PHONE_ID = Deno.env.get('MAYTAPI_PHONE_ID') ?? '46821'
const MAYTAPI_API_KEY = Deno.env.get('MAYTAPI_API_KEY') ?? ''

// Group-send credentials — Ma'am's number, which is a member of all HSIPL groups.
const MAYTAPI_GRP_PRODUCT_ID = Deno.env.get('MAYTAPI_GRP_PRODUCT_ID') ?? 'f09cb10a-0037-4e1f-8895-ee7a607077b4'
// Phone 141590 holds the live 918882979328 session. Slot 145466 is an empty sandbox
// slot stuck on a QR screen — pointing here silently sends nothing.
const MAYTAPI_GRP_PHONE_ID = Deno.env.get('MAYTAPI_GRP_PHONE_ID') ?? '141590'
const MAYTAPI_GRP_API_KEY = Deno.env.get('MAYTAPI_GRP_API_KEY') ?? ''

/** Strip non-digits and ensure a single India country code. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  // Only skip the prefix if it's already a full 12-digit number (91 + 10-digit mobile).
  // A 10-digit number that happens to start with "91" must still get the prefix added.
  return digits.length === 12 && digits.startsWith('91') ? digits : `91${digits}`
}

export interface WhatsAppResult {
  ok: boolean
  msgId: string | null
  raw: unknown
}

/** Internal helper — calls any Maytapi phone's sendMessage endpoint. */
async function maytapiSend(
  productId: string,
  phoneId: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<WhatsAppResult> {
  if (!apiKey) {
    console.error('[maytapi] API key secret is not set')
    return { ok: false, msgId: null, raw: null }
  }
  try {
    const res = await fetch(
      `https://api.maytapi.com/api/${productId}/${phoneId}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-maytapi-key': apiKey },
        body: JSON.stringify(payload),
      },
    )
    let body: Record<string, unknown> | null = null
    try { body = await res.json() } catch { /* non-JSON response */ }
    const data = (body?.data ?? null) as Record<string, unknown> | string | null
    const ok = res.ok && body?.success === true
    const msgId =
      (data && typeof data === 'object' ? (data.msgId ?? data.msg_id ?? data.id) : (typeof data === 'string' ? data : null)) as string | null ?? null
    if (!ok) console.error('[maytapi] send failed', { status: res.status, body })
    return { ok, msgId, raw: body }
  } catch (e) {
    console.error('[maytapi] send threw', String(e))
    return { ok: false, msgId: null, raw: null }
  }
}

/**
 * Send a WhatsApp message to a GROUP chat from Ma'am's number.
 * Uses MAYTAPI_GRP_* credentials (phone 141590 — 918882979328, a member of all HSIPL groups).
 * Passes mentionedList so WhatsApp renders the @tag properly.
 */
export async function sendToGroupWhatsApp({
  groupJid,
  assigneePhone,
  message,
}: {
  groupJid: string      // e.g. "120363143386844428@g.us"
  assigneePhone: string // e.g. "919876543210" — digits only, with country code
  message: string
}): Promise<WhatsAppResult> {
  // Same rule as normalizePhone — a bare startsWith('91') check would leave a 10-digit
  // mobile like 9117715416 without its country code.
  const waId = normalizePhone(assigneePhone)
  return maytapiSend(MAYTAPI_GRP_PRODUCT_ID, MAYTAPI_GRP_PHONE_ID, MAYTAPI_GRP_API_KEY, {
    to_number: groupJid,
    type: 'text',
    message,
    mentionedList: [`${waId}@c.us`],
  })
}

/** Send a WhatsApp text to an individual number via the business Maytapi phone. */
export async function sendWhatsApp(
  { phone, message }: { phone: string; message: string },
): Promise<WhatsAppResult> {
  const toNumber = normalizePhone(phone)
  return maytapiSend(MAYTAPI_PRODUCT_ID, MAYTAPI_PHONE_ID, MAYTAPI_API_KEY, {
    to_number: toNumber,
    type: 'text',
    message,
  })
}
