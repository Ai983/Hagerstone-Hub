// ════════════════════════════════════════════════════════════════════════
// n8n Workflow — "Del Assign Notify" (SPEC-DELEGATION-TASK-TYPE-CATALOG §6)
// Head→Employee assignment WhatsApp notification via Maytapi + delivery tracking.
//
// HOW TO CREATE (when the n8n MCP server is reconnected, or build in the n8n UI):
//   Build a workflow with these 4 nodes wired in sequence.
//
// TRIGGER: Webhook (POST /del-assign-notify)
//   The Hub Edge Function `del-notify-assign` fires this with body:
//   {
//     notification_id, task_id, task_title, task_type_label,
//     head_name, due_date, deep_link, recipient_phone, recipient_name, message
//   }
//
// ENV / CREDENTIALS NEEDED in n8n:
//   - Maytapi: Phone ID 46821, Product ID b8cce1b9-0f9f-4aef-994c-d232716471f0
//     ⚠️ VERIFY current endpoint + payload in Maytapi docs before wiring — they change.
//   - "Supabase Hub" Header Auth credential (already created for the scoring workflow):
//     Header Name: apikey   Value: <service_role key>   (+ Authorization: Bearer <key>)
//
// ════════════════════════════════════════════════════════════════════════

/*
NODE 1 — Webhook "Receive Assignment"
  httpMethod: POST
  path: del-assign-notify
  responseMode: onReceived  (respond immediately)
  options.noResponseBody: true

NODE 2 — HTTP Request "Send WhatsApp (Maytapi)"
  method: POST
  url:  https://api.maytapi.com/api/b8cce1b9-0f9f-4aef-994c-d232716471f0/46821/sendMessage
        ⚠️ VERIFY this URL in current Maytapi docs.
  authentication: genericCredentialType → httpHeaderAuth
  headers:
    x-maytapi-key: <Maytapi token>   (store as credential, NOT inline)
    Content-Type: application/json
  body (raw JSON):
    {
      "to_number": "{{ $json.body.recipient_phone }}",
      "type": "text",
      "message": "{{ $json.body.message }}"
    }
  options.response.response.neverError: true   (so a Maytapi failure still hits Node 3/4)
  options.response.response.fullResponse: true

NODE 3 — IF "Sent OK?"
  condition: {{ $json.statusCode }} (or Maytapi success flag) between 200 and 299
  TRUE  → Node 4a (mark sent)
  FALSE → Node 4b (mark failed)

NODE 4a — HTTP Request "Mark Sent"
  method: PATCH
  url: https://tpfvnerrjhqwipyonngf.supabase.co/rest/v1/del_notifications?id=eq.{{ $('Receive Assignment').item.json.body.notification_id }}
  auth: Supabase Hub header credential  (apikey + Authorization: Bearer)
  headers: Content-Type: application/json, Prefer: return=minimal
  body: {"status":"sent","attempts":1,"provider_msg_id":"{{ $json.body.data.msg_id }}"}

NODE 4b — HTTP Request "Mark Failed"
  method: PATCH
  url: https://tpfvnerrjhqwipyonngf.supabase.co/rest/v1/del_notifications?id=eq.{{ $('Receive Assignment').item.json.body.notification_id }}
  auth: Supabase Hub header credential
  headers: Content-Type: application/json, Prefer: return=minimal
  body: {"status":"failed","attempts":1}
  // On 2 cumulative failures the Hub treats the pending/failed row as the in-app
  // inbox fallback (SPEC §6 step 3). Email can be added as a further Node if configured.

After creating: set N8N_DEL_ASSIGN_WEBHOOK in Supabase Edge Function secrets to the
PRODUCTION webhook URL of Node 1, e.g.:
  supabase secrets set N8N_DEL_ASSIGN_WEBHOOK=https://primary-production-72e3f.up.railway.app/webhook/del-assign-notify
*/

// SDK-script form (paste into Workflow tool `script` when n8n MCP is reconnected):
export const meta = {
  name: 'del-assign-notify',
  description: 'Head→employee task assignment WhatsApp notification with delivery tracking',
}
