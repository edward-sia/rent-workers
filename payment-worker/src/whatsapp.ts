import { z } from 'zod';
import { logAirtableFailure } from './format';
import { fetchReminderBuckets } from './outstanding';
import { formatReminderMessages } from './reminder';
import type { Env } from './types';

const SERVICE_WINDOW_SECONDS = 24 * 60 * 60;

const webhook = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({ changes: z.array(z.object({ field: z.string(), value: z.unknown() })) })),
});

const incoming = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({ phone_number_id: z.string() }),
  messages: z.array(z.unknown()),
});

const reminder = z.object({
  type: z.literal('text'),
  id: z.string().min(1).max(256),
  timestamp: z.string().regex(/^\d+$/),
  from: z.string().regex(/^\d+$/),
  group_id: z.undefined(),
  text: z.object({ body: z.string().trim().regex(/^\/?reminder$/i) }),
});

async function hasValidSignature(signature: string | null, raw: ArrayBuffer, secret: string) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature ?? '');
  if (!match?.[1]) return false;
  const bytes = Uint8Array.from(match[1].match(/../g)!, hex => parseInt(hex, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, raw);
}

async function sendReport(env: Env, endpoint: string, to: string) {
  let buckets;
  try {
    buckets = await fetchReminderBuckets(env);
  } catch (error) {
    logAirtableFailure('whatsapp', 'read reminder', error);
    return false;
  }

  for (const body of formatReminderMessages(buckets, { channel: 'whatsapp' })) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to,
          type: 'text', text: { body, preview_url: false } }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) continue;
      console.error('[whatsapp] send reminder HTTP', response.status);
    } catch {
      console.error('[whatsapp] send reminder request failed');
    }
    return false;
  }
  return true;
}

export async function whatsappWebhook(request: Request, env: Env): Promise<Response> {
  const version = env.WHATSAPP_GRAPH_VERSION;
  if (!version) return new Response(null, { status: 404 });

  if (request.method === 'GET') {
    const query = new URL(request.url).searchParams;
    const challenge = query.get('hub.challenge');
    if (env.WHATSAPP_VERIFY_TOKEN && query.get('hub.mode') === 'subscribe' && challenge &&
        query.get('hub.verify_token') === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge);
    }
    return new Response(null, { status: 403 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });

  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!env.WHATSAPP_APP_SECRET || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_ALLOWED_SENDERS?.trim() ||
      !/^v\d+\.\d+$/.test(version) || !phoneId || !/^\d+$/.test(phoneId)) {
    return new Response(null, { status: 503 });
  }

  const raw = await request.arrayBuffer();
  if (!await hasValidSignature(request.headers.get('X-Hub-Signature-256'), raw, env.WHATSAPP_APP_SECRET)) {
    return new Response(null, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response(null, { status: 400 });
  }

  const batch = webhook.safeParse(payload);
  if (!batch.success) return new Response(null, { status: 200 });
  const allowed = new Set(env.WHATSAPP_ALLOWED_SENDERS.split(',').map(sender => sender.trim()));
  const endpoint = `https://graph.facebook.com/${version}/${phoneId}/messages`;
  let delivered = true;
  for (const message of requestedReminders(batch.data, phoneId, allowed)) {
    const receipt = `whatsapp:reminder:${phoneId}:${message.from}:${message.id}`;
    if (await env.SESSION_KV.get(receipt)) continue;
    if (await sendReport(env, endpoint, message.from)) {
      await env.SESSION_KV.put(receipt, 'sent', { expirationTtl: SERVICE_WINDOW_SECONDS });
    } else {
      delivered = false;
    }
  }
  return new Response(null, { status: delivered ? 200 : 503 });
}

function* requestedReminders(batch: z.infer<typeof webhook>, phoneId: string, allowed: Set<string>) {
  const cutoff = Date.now() / 1000 - SERVICE_WINDOW_SECONDS;
  for (const entry of batch.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = incoming.safeParse(change.value);
      if (!value.success || value.data.metadata.phone_number_id !== phoneId) continue;
      for (const item of value.data.messages) {
        const message = reminder.safeParse(item);
        if (message.success && allowed.has(message.data.from) && Number(message.data.timestamp) > cutoff) {
          yield message.data;
        }
      }
    }
  }
}
