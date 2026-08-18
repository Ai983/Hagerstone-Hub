# Hagerstone WhatsApp Gateway — Final Implementation Plan

Build a self-hosted WhatsApp gateway that replaces Maytapi (~₹5,600/mo → ~₹450/mo
Railway). It exposes a **Maytapi-compatible API**, so every existing caller (Hub edge
functions, n8n workflows) migrates with only a URL + API-key swap.

**Stack:** Node 20 + TypeScript + Fastify + Baileys (WhatsApp Web multi-device
protocol) + Supabase (Hub project) for session storage & message audit log, deployed
as a Railway service.

---

## 0. Architecture

```
Hub edge functions ─┐
n8n workflows      ─┼─► POST https://<gateway>/maytapi/:productId/:phoneId/sendMessage
                    │        (x-maytapi-key header — same contract as Maytapi)
                    ▼
        Fastify Gateway (Railway service, 1 replica)
                    │
        ├── Baileys socket per session (WhatsApp linked device)
        │       └── auth keys → wa_auth_store (Supabase)
        ├── wa_sessions   — one row per WhatsApp number
        ├── wa_messages   — audit log, in + out
        ├── wa_contacts   — name/JID map
        └── inbound messages → POST to wa_sessions.webhook_url (n8n)
                               in Maytapi payload shape (founder YES/OK replies)
```

Design rules:
- Gateway uses the Hub **service-role key** — lives ONLY in Railway env vars (hard rule #8).
- Callers authenticate with `x-maytapi-key: <GATEWAY_SECRET>` (or `?access_token=`).
- Outbound sends are serialized per session with a random 3–8 s delay (ban-risk pacing).
- Sessions survive redeploys: Baileys auth state persists in `wa_auth_store` and
  `restoreAllSessions()` reconnects on boot.

## What we migrate (verified inventory)

Only the **business number** (Maytapi phone 46821) matters. The group product is
being cancelled independently (command system down since 2026-07-16).

| Consumer | Type | Migration |
|---|---|---|
| 5 Hub edge fns via `_shared/maytapi.ts` (del-notify-assign, del-task-followup, del-verify-task, gie-task-reminders, send-onboarding) | text | swap base URL + key (env) |
| n8n Imprest Ageing Digest | text | swap URL + key in HTTP node |
| n8n Founder Gate + Director Gate | text out + **inbound YES/OK webhook** | swap URL/key + point gateway webhook at n8n |
| n8n CPS Build 5 Founder PO Approval | **media** (base64 `data:` PDF + caption + filename) | swap URL + key |
| n8n CPS RFQ/PO dispatch | media (signed URL PDFs) | swap URL + key |
| **Attendance punch system** (Hindi IN/OUT confirmations; calls Maytapi from Google-Cloud IP 34.116.28.5 — likely an Apps Script / Sheets HR system, ~15–25 msgs/day, found in live Maytapi logs 2026-07-19) | text | **find its owner/source first**, then swap URL + key |

API contract all of them use (and the gateway replicates exactly):
`POST /maytapi/{productId}/{phoneId}/sendMessage`, header `x-maytapi-key`,
body `{ to_number, type: 'text'|'media', message, text?, filename?, skip_filter? }`,
response `{ success: true, data: { msgId } }`.

## Risks (tell the founder before starting)

1. **Baileys is an unofficial WhatsApp client** — WhatsApp can ban numbers using it.
   Maytapi rides the same protocol, so exposure is similar, but self-hosting removes
   the vendor buffer. Mitigation: pacing, normal volumes, and prefer a dedicated SIM
   over a founder's personal number.
2. **Single linked device**: if the session logs out, sends fail until re-scan.
   Detection: `wa_messages.status='failed'` rows + Railway logs; re-pair via QR.
3. **Inbound payload shape** is the one silent-breakage risk — Phase 4 step 0 makes
   verifying the n8n gates' parsing mandatory before cutover.
4. Rollback at every stage = revert the URL/key swap per consumer. Maytapi stays paid
   until sign-off.

---

# Phase 1 — Database (Supabase, project `tpfvnerrjhqwipyonngf`)

Apply as one migration (`wa_gateway_core`) via Supabase MCP `apply_migration`:

```sql
-- One row per WhatsApp number/session
CREATE TABLE IF NOT EXISTS wa_sessions (
  id            text PRIMARY KEY,          -- e.g. 'hagerstone-biz' (used as phoneId in URLs)
  label         text NOT NULL,
  phone_number  text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','connecting','connected','logged_out')),
  webhook_url   text,                      -- inbound messages forwarded here (n8n)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_sessions service role" ON wa_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_wa_sessions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.updated_at = now(); RETURN new; END; $$;
CREATE TRIGGER wa_sessions_updated_at
  BEFORE UPDATE ON wa_sessions
  FOR EACH ROW EXECUTE FUNCTION update_wa_sessions_updated_at();

-- Baileys Signal keys (gateway only — never expose)
CREATE TABLE IF NOT EXISTS wa_auth_store (
  session_id  text NOT NULL REFERENCES wa_sessions(id) ON DELETE CASCADE,
  key         text NOT NULL,               -- 'creds' | 'key-<type>-<id>'
  data        jsonb NOT NULL,
  PRIMARY KEY (session_id, key)
);
ALTER TABLE wa_auth_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_auth_store service role" ON wa_auth_store
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Full audit log, inbound + outbound
CREATE TABLE IF NOT EXISTS wa_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          text NOT NULL REFERENCES wa_sessions(id) ON DELETE CASCADE,
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  chat_jid            text,
  counterpart_number  text,
  message_type        text,
  body                text,
  wa_message_id       text,
  status              text,                -- out: queued|sent|failed   in: received
  ts                  timestamptz,
  raw                 jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_messages_session_ts ON wa_messages (session_id, ts DESC);
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_messages service role" ON wa_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Contact name/JID map (from Baileys contact sync)
CREATE TABLE IF NOT EXISTS wa_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  text NOT NULL REFERENCES wa_sessions(id) ON DELETE CASCADE,
  jid         text NOT NULL,
  name        text,
  phone       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, jid)
);
CREATE INDEX IF NOT EXISTS wa_contacts_session_idx ON wa_contacts (session_id);
ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_contacts service role" ON wa_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Verify: `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'wa_%';` → 4 rows.

---

# Phase 2 — Gateway code

Create **`D:\hs\whatsapp-gateway\`** as its own git repo, pushed to a **PRIVATE**
GitHub repo (the Hub repo is public — this code must never live there).

```
whatsapp-gateway/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .gitignore            (node_modules, dist, .env)
├── .env                  (local dev only — never committed)
└── src/
    ├── index.ts
    ├── supabase.ts
    ├── types.ts
    ├── authState.ts
    ├── sessionManager.ts
    ├── queue.ts
    └── routes/
        ├── sessions.ts
        └── maytapi.ts
```

### `package.json`
```json
{
  "name": "hagerstone-wa-gateway",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "2.45.4",
    "@whiskeysockets/baileys": "^7.0.0-rc13",
    "dotenv": "16.4.5",
    "fastify": "4.28.1",
    "pino": "9.5.0",
    "qrcode": "1.5.4"
  },
  "devDependencies": {
    "@types/node": "20.14.0",
    "@types/qrcode": "1.5.5",
    "ts-node-dev": "2.0.0",
    "typescript": "5.5.3"
  }
}
```
Baileys must be **v7+** — v6 has a stale Signal handshake that WhatsApp rejects for
business numbers ("Bad MAC" / status 408 on QR scan).

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `Dockerfile`
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

### `src/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

export const supabase = createClient(url, key, { auth: { persistSession: false } });
```

### `src/types.ts`
```typescript
export type SessionStatus = 'pending' | 'connecting' | 'connected' | 'logged_out';

export interface CreateSessionBody {
  id: string;
  label: string;
}

// Body of the Maytapi-compatible sendMessage route — matches what our edge fns
// and n8n workflows already send today.
export interface MaytapiSendBody {
  to_number: string;            // digits, or a group JID ending @g.us
  type: string;                 // 'text' | 'media' | 'link'
  message: string;              // text body, or data: URI / https URL for media
  text?: string;                // caption for media
  filename?: string;
  mentionedList?: string[];     // ["91…@c.us"] — group @mentions
  skip_filter?: boolean;        // accepted, ignored
}
```

### `src/authState.ts`
```typescript
import {
  initAuthCreds,
  BufferJSON,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalKeyStore,
} from '@whiskeysockets/baileys';
import { supabase } from './supabase';

export async function useSupabaseAuthState(sessionId: string): Promise<{
  state: { creds: AuthenticationCreds; keys: SignalKeyStore };
  saveCreds: () => Promise<void>;
}> {
  const { data: credsRow } = await supabase
    .from('wa_auth_store')
    .select('data')
    .eq('session_id', sessionId)
    .eq('key', 'creds')
    .maybeSingle();

  const creds: AuthenticationCreds = credsRow?.data
    ? JSON.parse(JSON.stringify(credsRow.data), BufferJSON.reviver)
    : initAuthCreds();

  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      if (ids.length === 0) return result;
      const keyNames = ids.map((id) => `key-${type}-${id}`);
      const { data } = await supabase
        .from('wa_auth_store')
        .select('key, data')
        .eq('session_id', sessionId)
        .in('key', keyNames);
      for (const row of data ?? []) {
        const id = row.key.slice(`key-${type}-`.length);
        result[id] = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
      }
      return result;
    },

    async set(data: {
      [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] | null };
    }): Promise<void> {
      const upserts: Array<{ session_id: string; key: string; data: unknown }> = [];
      const deletes: string[] = [];
      for (const type of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
        const typeData = data[type];
        if (!typeData) continue;
        for (const [id, val] of Object.entries(typeData)) {
          const rowKey = `key-${type}-${id}`;
          if (val != null) {
            upserts.push({
              session_id: sessionId,
              key: rowKey,
              data: JSON.parse(JSON.stringify(val, BufferJSON.replacer)),
            });
          } else {
            deletes.push(rowKey);
          }
        }
      }
      if (upserts.length > 0) {
        await supabase.from('wa_auth_store').upsert(upserts, { onConflict: 'session_id,key' });
      }
      if (deletes.length > 0) {
        await supabase.from('wa_auth_store').delete()
          .eq('session_id', sessionId).in('key', deletes);
      }
    },
  };

  const saveCreds = async (): Promise<void> => {
    await supabase.from('wa_auth_store').upsert(
      {
        session_id: sessionId,
        key: 'creds',
        data: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      },
      { onConflict: 'session_id,key' }
    );
  };

  return { state: { creds, keys }, saveCreds };
}
```

### `src/sessionManager.ts`
Socket lifecycle, QR generation, exponential-backoff reconnect, inbound logging,
contact sync, and **inbound webhook forwarding to n8n in Maytapi payload shape**.

```typescript
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import { supabase } from './supabase';
import { useSupabaseAuthState } from './authState';

const sockets = new Map<string, WASocket>();
const qrCache = new Map<string, string>();
const retryCount = new Map<string, number>();
// webhook_url cache with short TTL so a DB update takes effect within a minute
const webhookCache = new Map<string, { url: string | null; at: number }>();
const WEBHOOK_TTL_MS = 60_000;

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export function getSocket(sessionId: string): WASocket | undefined {
  return sockets.get(sessionId);
}
export function getQr(sessionId: string): string | null {
  return qrCache.get(sessionId) ?? null;
}

async function getWebhookUrl(sessionId: string): Promise<string | null> {
  const cached = webhookCache.get(sessionId);
  if (cached && Date.now() - cached.at < WEBHOOK_TTL_MS) return cached.url;
  const { data } = await supabase
    .from('wa_sessions').select('webhook_url').eq('id', sessionId).maybeSingle();
  const url = data?.webhook_url ?? null;
  webhookCache.set(sessionId, { url, at: Date.now() });
  return url;
}

// Forward an inbound message to n8n in the same shape Maytapi used, so the
// Founder/Director Gate workflows keep working unchanged. 2 retries.
async function forwardInbound(
  sessionId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const url = await getWebhookUrl(sessionId);
  if (!url) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
      logger.warn({ sessionId, status: res.status, attempt }, 'Webhook forward non-2xx');
    } catch (err) {
      logger.warn({ err, sessionId, attempt }, 'Webhook forward failed');
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

async function setStatus(sessionId: string, status: string, phoneNumber?: string): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (phoneNumber) update.phone_number = phoneNumber;
  await supabase.from('wa_sessions').update(update).eq('id', sessionId);
}

function backoffDelay(sessionId: string): number {
  const attempt = (retryCount.get(sessionId) ?? 0) + 1;
  retryCount.set(sessionId, attempt);
  return Math.min(3000 * Math.pow(2, attempt - 1), 300_000); // 3s→5min cap
}

export async function startSession(sessionId: string): Promise<void> {
  const existing = sockets.get(sessionId);
  if (existing) {
    sockets.delete(sessionId);
    try { existing.end(undefined); } catch { /* ignore */ }
  }

  await setStatus(sessionId, 'connecting');
  const { state, saveCreds } = await useSupabaseAuthState(sessionId);
  const { version } = await fetchLatestBaileysVersion();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const silentLogger = pino({ level: 'silent' }) as any;
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: silentLogger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sockets.set(sessionId, sock);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        qrCache.set(sessionId, await qrcode.toDataURL(qr));
        await setStatus(sessionId, 'connecting');
      } catch (err) {
        logger.error({ err, sessionId }, 'QR generation failed');
      }
    }

    if (connection === 'open') {
      qrCache.delete(sessionId);
      retryCount.delete(sessionId);
      const phoneNumber = sock.user?.id?.split(':')[0] ?? null;
      await setStatus(sessionId, 'connected', phoneNumber ?? undefined);
      logger.info({ sessionId, phoneNumber }, 'Session connected');
    }

    if (connection === 'close') {
      qrCache.delete(sessionId);
      sockets.delete(sessionId);
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        logger.warn({ sessionId }, 'Logged out — stopping');
        retryCount.delete(sessionId);
        await setStatus(sessionId, 'logged_out');
      } else if (statusCode === DisconnectReason.badSession) {
        // Corrupt auth — wipe so next connect gets a fresh QR
        logger.warn({ sessionId }, 'Bad session — clearing auth state');
        await supabase.from('wa_auth_store').delete().eq('session_id', sessionId);
        await setStatus(sessionId, 'connecting');
        await new Promise((r) => setTimeout(r, backoffDelay(sessionId)));
        await startSession(sessionId);
      } else {
        const attempt = (retryCount.get(sessionId) ?? 0) + 1;
        if (attempt > 10) {
          logger.warn({ sessionId, attempt }, 'Too many reconnects — stopping');
          retryCount.delete(sessionId);
          await setStatus(sessionId, 'logged_out');
          return;
        }
        logger.info({ sessionId, statusCode, attempt }, 'Reconnecting');
        await setStatus(sessionId, 'connecting');
        await new Promise((r) => setTimeout(r, backoffDelay(sessionId)));
        await startSession(sessionId);
      }
    }
  });

  // Inbound: log to wa_messages, then forward to n8n webhook (Maytapi shape)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid ?? '';
      if (!jid) continue;
      const isGroup = jid.endsWith('@g.us');

      const counterpart = isGroup
        ? (msg.key.participant ?? '').replace(/@.*$/, '')
        : jid.replace(/@.*$/, '');
      const body =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        msg.message.imageMessage?.caption ??
        msg.message.videoMessage?.caption ??
        null;
      const messageType = Object.keys(msg.message)[0] ?? 'unknown';

      try {
        await supabase.from('wa_messages').insert({
          session_id: sessionId,
          direction: 'in',
          chat_jid: jid,
          counterpart_number: counterpart,
          message_type: messageType,
          body,
          wa_message_id: msg.key.id,
          status: 'received',
          ts: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
          raw: msg as unknown as Record<string, unknown>,
        });
      } catch (err) {
        logger.error({ err, sessionId, jid }, 'Failed to log inbound message');
      }

      // Only forward individual text-bearing chats (approval replies). Groups are
      // skipped until a group flow needs them.
      if (!isGroup && body) {
        const ownNumber = sock.user?.id?.split(':')[0] ?? '';
        forwardInbound(sessionId, {
          type: 'message',
          product_id: 'hagerstone',
          phone_id: sessionId,
          message: { id: msg.key.id, type: 'text', text: body, fromMe: false },
          user: {
            id: `${counterpart}@c.us`,
            phone: counterpart,
            name: msg.pushName ?? '',
          },
          conversation: `${counterpart}@c.us`,
          receiver: ownNumber,
          timestamp: Number(msg.messageTimestamp),
        }).catch(() => { /* logged inside */ });
      }
    }
  });

  // Contact sync → wa_contacts (fires on first history sync)
  sock.ev.on('contacts.upsert', async (contacts) => {
    for (const contact of contacts) {
      const name = contact.notify ?? contact.verifiedName ?? null;
      const phone = contact.id.replace(/@.*$/, '');
      try {
        await supabase.from('wa_contacts').upsert(
          { session_id: sessionId, jid: contact.id, name, phone },
          { onConflict: 'session_id,jid' }
        );
      } catch (err) {
        logger.error({ err, sessionId, jid: contact.id }, 'Contact upsert failed');
      }
    }
  });
}

export async function stopSession(sessionId: string): Promise<void> {
  const sock = sockets.get(sessionId);
  sockets.delete(sessionId);
  qrCache.delete(sessionId);
  if (sock) {
    try { await sock.logout(); } catch { /* ignore */ }
  }
}

export async function restoreAllSessions(): Promise<void> {
  const { data: sessions, error } = await supabase
    .from('wa_sessions').select('id, status').neq('status', 'logged_out');
  if (error) {
    logger.error({ error }, 'Failed to fetch sessions for restore');
    return;
  }
  logger.info({ count: sessions?.length ?? 0 }, 'Restoring sessions');
  for (const session of sessions ?? []) {
    try { await startSession(session.id); }
    catch (err) { logger.error({ err, sessionId: session.id }, 'Restore failed'); }
  }
}
```

### `src/queue.ts`
Per-session serialized send queue with pacing. Handles group JIDs and mentions.

```typescript
import { supabase } from './supabase';
import { getSocket } from './sessionManager';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const chains = new Map<string, Promise<void>>();

export interface SendOpts {
  mentions?: string[]; // full JIDs, e.g. "919876543210@s.whatsapp.net"
}

// Group JIDs (…@g.us) pass through untouched; plain numbers become person JIDs.
export function normalizeJid(number: string): string {
  if (number.includes('@g.us')) return number;
  return `${number.replace(/\D/g, '')}@s.whatsapp.net`;
}

function randomDelayMs(): number {
  const min = parseInt(process.env.SEND_MIN_DELAY_MS ?? '3000', 10);
  const max = parseInt(process.env.SEND_MAX_DELAY_MS ?? '8000', 10);
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function performSend(
  rowId: string,
  sessionId: string,
  toNumber: string,
  message: string,
  opts: SendOpts
): Promise<void> {
  const jid = normalizeJid(toNumber);
  const sock = getSocket(sessionId);

  if (!sock) {
    await supabase.from('wa_messages').update({ status: 'failed' }).eq('id', rowId);
    logger.warn({ sessionId, rowId }, 'Send failed: no active socket');
    return;
  }

  try {
    const content = opts.mentions?.length
      ? { text: message, mentions: opts.mentions }
      : { text: message };
    const result = await sock.sendMessage(jid, content);
    const msgId = result?.key?.id ?? null;
    const actualJid = result?.key?.remoteJid ?? jid; // Baileys may resolve to a LID JID

    if (actualJid !== jid) {
      await supabase.from('wa_messages')
        .update({ chat_jid: actualJid, counterpart_number: actualJid.replace(/@.*$/, '') })
        .eq('session_id', sessionId).eq('chat_jid', jid);
    }

    await supabase.from('wa_messages')
      .update({ status: 'sent', wa_message_id: msgId, chat_jid: actualJid })
      .eq('id', rowId);
    logger.info({ sessionId, rowId, jid: actualJid }, 'Message sent');
  } catch (err) {
    await supabase.from('wa_messages').update({ status: 'failed' }).eq('id', rowId);
    logger.error({ err, sessionId, rowId, jid }, 'Message send failed');
  }

  await new Promise((r) => setTimeout(r, randomDelayMs())); // anti-ban pacing
}

export async function enqueueSend(
  sessionId: string,
  toNumber: string,
  message: string,
  opts: SendOpts = {}
): Promise<string> {
  const jid = normalizeJid(toNumber);

  const { data: row, error } = await supabase
    .from('wa_messages')
    .insert({
      session_id: sessionId,
      direction: 'out',
      chat_jid: jid,
      counterpart_number: toNumber,
      message_type: 'text',
      body: message,
      status: 'queued',
      ts: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !row) throw new Error(`Failed to insert message row: ${error?.message}`);

  const rowId: string = row.id;
  const prev = chains.get(sessionId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => performSend(rowId, sessionId, toNumber, message, opts));
  chains.set(sessionId, next.catch(() => {}));
  return rowId;
}
```

### `src/routes/sessions.ts`
```typescript
import type { FastifyInstance } from 'fastify';
import { supabase } from '../supabase';
import { startSession, stopSession, getQr } from '../sessionManager';
import type { CreateSessionBody } from '../types';

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    if (request.headers['x-gateway-key'] !== process.env.GATEWAY_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Create + start a session (then poll /qr and scan)
  app.post<{ Body: CreateSessionBody }>('/sessions', async (request, reply) => {
    const { id, label } = request.body;
    if (!id || !label) return reply.code(400).send({ error: 'id and label are required' });

    const { error } = await supabase.from('wa_sessions')
      .insert({ id, label, status: 'pending' });
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Session id already exists' });
      return reply.code(500).send({ error: error.message });
    }

    // Wipe any stale auth state so the QR pairing always starts clean —
    // leftover Signal keys from an aborted scan cause "Couldn't login".
    await supabase.from('wa_auth_store').delete().eq('session_id', id);
    await startSession(id);

    const { data: session } = await supabase.from('wa_sessions')
      .select('id, status, label, phone_number').eq('id', id).single();
    return reply.code(201).send(session);
  });

  app.get('/sessions', async (_request, reply) => {
    const { data, error } = await supabase.from('wa_sessions')
      .select('id, label, phone_number, status, webhook_url, created_at, updated_at')
      .order('created_at', { ascending: true });
    if (error) return reply.code(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/qr', async (request, reply) => {
    return reply.send({ qr: getQr(request.params.id) });
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/status', async (request, reply) => {
    const { data, error } = await supabase.from('wa_sessions')
      .select('status, phone_number').eq('id', request.params.id).maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Session not found' });
    return reply.send(data);
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    await stopSession(request.params.id);
    const { error } = await supabase.from('wa_sessions').delete().eq('id', request.params.id);
    if (error) return reply.code(500).send({ error: error.message });
    return reply.code(204).send();
  });
}
```

### `src/routes/maytapi.ts` — the drop-in Maytapi-compatible route
```typescript
import type { FastifyInstance } from 'fastify';
import { enqueueSend, normalizeJid } from '../queue';
import { getSocket } from '../sessionManager';
import type { MaytapiSendBody } from '../types';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function mimetypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

function buildMediaContent(
  mimetype: string, data: Buffer | { url: string }, caption: string, filename?: string
): Record<string, unknown> {
  if (mimetype.startsWith('video/')) return { video: data, caption, mimetype, fileName: filename };
  if (mimetype.startsWith('image/')) return { image: data, caption };
  return { document: data, fileName: filename ?? 'file', mimetype, caption };
}

export async function registerMaytapiRoutes(app: FastifyInstance): Promise<void> {
  // Same auth options Maytapi callers already use
  app.addHook('preHandler', async (request, reply) => {
    const key = request.headers['x-maytapi-key']
      ?? (request.query as Record<string, string>)['access_token'];
    if (key !== process.env.GATEWAY_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Drop-in for: POST https://api.maytapi.com/api/:productId/:phoneId/sendMessage
  // phoneId = our session id; productId accepted but ignored.
  app.post<{
    Params: { productId: string; phoneId: string };
    Body: MaytapiSendBody;
  }>('/maytapi/:productId/:phoneId/sendMessage', async (request, reply) => {
    const { phoneId } = request.params;
    const { to_number, type, message, text: caption = '', filename, mentionedList } = request.body;

    if (!to_number || !message) {
      return reply.code(400).send({ success: false, message: 'to_number and message are required' });
    }

    // "91…@c.us" (Maytapi convention) → Baileys person JIDs
    const mentions = (mentionedList ?? []).map(
      (m) => `${m.replace(/\D/g, '')}@s.whatsapp.net`
    );

    if (type === 'text') {
      try {
        const rowId = await enqueueSend(phoneId, to_number, message, { mentions });
        return reply.send({ success: true, data: { msgId: rowId } });
      } catch (err) {
        return reply.code(500).send({ success: false, message: String(err) });
      }
    }

    if (type === 'media') {
      const sock = getSocket(phoneId);
      if (!sock) {
        return reply.code(503).send({ success: false, message: `Session '${phoneId}' not connected` });
      }
      const jid = normalizeJid(to_number);
      try {
        let msgContent: Record<string, unknown>;
        if (message.startsWith('data:')) {
          // base64 data URI (CPS Build 5 sends PO PDFs this way)
          const commaIdx = message.indexOf(',');
          const meta = message.substring(0, commaIdx);
          const b64 = message.substring(commaIdx + 1);
          const mimetype = meta.match(/data:([^;]+)/)?.[1]
            ?? (filename ? mimetypeFromFilename(filename) : 'application/octet-stream');
          msgContent = buildMediaContent(mimetype, Buffer.from(b64, 'base64'), caption, filename);
        } else if (message.startsWith('http')) {
          // remote URL (RFQ/PO dispatch uses signed Supabase URLs)
          const mimetype = filename ? mimetypeFromFilename(filename) : 'application/pdf';
          msgContent = buildMediaContent(mimetype, { url: message }, caption, filename);
        } else {
          return reply.code(400).send({ success: false, message: 'Unrecognised media payload' });
        }
        const result = await sock.sendMessage(jid, msgContent as Parameters<typeof sock.sendMessage>[1]);
        return reply.send({ success: true, data: { msgId: result?.key?.id ?? null } });
      } catch (err) {
        logger.error({ err, phoneId, jid }, 'Media send failed');
        return reply.code(500).send({ success: false, message: String(err) });
      }
    }

    if (type === 'link') {
      const fullText = caption ? `${caption}\n${message}` : message;
      try {
        const rowId = await enqueueSend(phoneId, to_number, fullText, {});
        return reply.send({ success: true, data: { msgId: rowId } });
      } catch (err) {
        return reply.code(500).send({ success: false, message: String(err) });
      }
    }

    return reply.code(400).send({ success: false, message: `Message type '${type}' is not supported` });
  });
}
```

### `src/index.ts`
```typescript
import 'dotenv/config';
import Fastify from 'fastify';
import pino from 'pino';
import { restoreAllSessions } from './sessionManager';
import { registerSessionRoutes } from './routes/sessions';
import { registerMaytapiRoutes } from './routes/maytapi';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function main(): Promise<void> {
  const app = Fastify({ logger, bodyLimit: 50 * 1024 * 1024 }); // base64 PDFs

  app.get('/health', async () => ({ ok: true })); // no auth — Railway healthcheck

  await app.register(registerSessionRoutes);
  await app.register(registerMaytapiRoutes);

  const port = parseInt(process.env.PORT ?? '8080', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Gateway listening');

  await restoreAllSessions();
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
```

Finish the phase: `npm install && npm run build` — must compile clean. Commit and
push to the private GitHub repo.

---

# Phase 3 — Deploy to Railway

1. Generate a fresh secret (PowerShell):
   `-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})` — or any
   64-hex-char random string. Store it in a password manager.
2. Railway → existing project → new service `wa-gateway`, source = the private repo.
   **1 replica, no sleep/serverless** (Baileys sockets live in memory).
3. Env vars:
   ```
   SUPABASE_URL=https://tpfvnerrjhqwipyonngf.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<HUB_SERVICE_ROLE_KEY from hagerstone-hub/.env>
   GATEWAY_SECRET=<fresh secret from step 1>
   PORT=8080
   SEND_MIN_DELAY_MS=3000
   SEND_MAX_DELAY_MS=8000
   ```
4. Generate a Railway domain; note it as `<GATEWAY>` below.
5. Verify: `GET https://<GATEWAY>/health` → `{"ok":true}`.

---

# Phase 4 — Pair the WhatsApp number

**Step 0 (do this FIRST — highest-risk compatibility point):** open Founder Gate and
Director Gate in n8n (`get_workflow_details`) and write down every field their
webhook-parsing nodes read from the Maytapi inbound payload (e.g.
`body.message.text`, `body.user.phone`, `body.conversation`). If any field differs
from what `forwardInbound()` in `sessionManager.ts` emits, adjust `forwardInbound()`
to match **before** cutover. Also note the exact n8n webhook URL(s) Maytapi currently
posts to (visible in the Maytapi console → Webhook settings).

1. Decide the number with Aniket: a dedicated SIM (recommended) or the existing
   business number. Note: WhatsApp allows up to 4 linked devices, so Baileys can pair
   alongside Maytapi during the parallel run — confirm Maytapi's link stays alive
   after scanning.
2. Create the session:
   ```
   POST https://<GATEWAY>/sessions
   x-gateway-key: <GATEWAY_SECRET>
   { "id": "hagerstone-biz", "label": "Hagerstone Business" }
   ```
3. Poll `GET /sessions/hagerstone-biz/qr` (x-gateway-key header) → save the returned
   data-URL into an `<img src>` in a local HTML file, open it, scan from the phone
   (WhatsApp → Settings → Linked Devices).
4. Confirm `GET /sessions/hagerstone-biz/status` → `{"status":"connected", ...}`.
5. Set the inbound webhook (Supabase SQL):
   ```sql
   UPDATE wa_sessions SET webhook_url = '<n8n inbound webhook URL from step 0>'
   WHERE id = 'hagerstone-biz';
   ```
6. Smoke tests (all against `POST https://<GATEWAY>/maytapi/hagerstone/hagerstone-biz/sendMessage`,
   header `x-maytapi-key: <GATEWAY_SECRET>`):
   - text → `{ "to_number": "91<your number>", "type": "text", "message": "gateway test" }` arrives;
   - media → small PDF as `data:application/pdf;base64,…` with `text` caption + `filename` arrives with caption;
   - inbound → reply "YES" from the phone → `wa_messages` gets a `direction='in'` row
     AND the n8n webhook execution fires with the expected fields.

---

# Phase 5 — Rewire consumers (one at a time; Maytapi stays live)

**5.1 Hub edge functions** (single shared file):
- In [supabase/functions/_shared/maytapi.ts](supabase/functions/_shared/maytapi.ts),
  change `maytapiSend()`'s URL to
  `` `${Deno.env.get('WA_GATEWAY_URL')}/maytapi/${productId}/${phoneId}/sendMessage` ``
  and the key header to `Deno.env.get('WA_GATEWAY_KEY')`.
- Set edge secrets: `WA_GATEWAY_URL=https://<GATEWAY>`, `WA_GATEWAY_KEY=<GATEWAY_SECRET>`,
  and override `MAYTAPI_PHONE_ID=hagerstone-biz` (product id can stay — it's ignored).
- The existing response parsing (`body.success === true`, `data.msgId`) already
  matches the gateway. Redeploy all 5 functions; trigger `del-notify-assign` on a
  test task and confirm delivery.

**5.2 n8n text workflows** (Imprest Ageing Digest, Founder Gate sends, Director Gate
sends): in each HTTP node, swap the URL to
`https://<GATEWAY>/maytapi/hagerstone/hagerstone-biz/sendMessage` and the
`x-maytapi-key` value to the new secret — move the key into an n8n credential while
you're there (today it's hardcoded plaintext in workflow JSON). n8n MCP edits create
drafts: **publish in the UI** and confirm `activeVersionId` changed.

**5.3 n8n media workflows** (CPS Build 5 Founder PO Approval, RFQ/PO dispatch): same
URL/key swap. Test Build 5 end-to-end with a real PO: PDF + caption arrives to both
founders, and a "YES" reply round-trips through the gateway webhook → n8n → PO
approved.

**5.4 Inbound cutover:** once 5.3 is verified, remove the webhook URL from the
Maytapi console (otherwise both Maytapi and the gateway deliver every inbound reply
→ double-processing of YES replies).

---

# Phase 6 — Parallel run (1–2 weeks) and sign-off

- Maytapi stays paid but idle (instant rollback = revert URL/key per consumer).
- Daily check: `SELECT count(*) FROM wa_messages WHERE status='failed' AND created_at > now() - interval '1 day';` → expect 0; scan Railway logs for reconnect loops / `logged_out`.
- Success = 1–2 weeks of imprest approvals + task notifications + ≥1 full PO
  approval cycle with zero missed messages. Get Aniket's sign-off.

# Phase 7 — Cancel Maytapi

- Group product `f09cb10a…` (~₹2,800/mo): safe to cancel **now**, independent of this
  project (command system is down).
- Business product `b8cce1b9…` (~₹2,800/mo): cancel only after Phase 6 sign-off.
- Net saving ≈ ₹5,600/mo − ~₹450/mo Railway.

---

# Later / optional (not needed for cutover)

- Hub admin page for session status + QR re-pairing (read `wa_sessions` via a
  service-role edge function; add `authenticated` read policies then).
- n8n health-check workflow: ping `/health` + alert if `wa_sessions.status != 'connected'`.
- Group sends + `mentionedList` are already supported end-to-end if the GIE command
  system is ever revived — pair Ma'am's number as a second session (`id: hagerstone-grp`).
