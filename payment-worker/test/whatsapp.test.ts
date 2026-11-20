import { createHmac } from 'node:crypto';
import { TABLES } from '@rent/airtable-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

const url = 'https://worker.test/webhooks/whatsapp';
const owner = '61400000001';
const colleague = '61400000002';
const receipts = new Map<string, string>();
const config = {
  SESSION_KV: {
    get: async (key: string) => receipts.get(key) ?? null,
    put: async (key: string, value: string) => { receipts.set(key, value); },
  },
  WHATSAPP_GRAPH_VERSION: 'v25.0',
  WHATSAPP_PHONE_NUMBER_ID: '98765',
  WHATSAPP_VERIFY_TOKEN: 'test-verification-token',
  WHATSAPP_APP_SECRET: 'test-meta-secret',
  WHATSAPP_ACCESS_TOKEN: 'test-access-token',
  WHATSAPP_ALLOWED_SENDERS: owner,
  AIRTABLE_BASE_ID: 'appTEST',
  AIRTABLE_TOKEN: 'test-airtable-token',
} as unknown as Env;

beforeEach(() => receipts.clear());
afterEach(() => vi.unstubAllGlobals());

function message(from: string, command = 'reminder') {
  return { from, id: 'wamid.' + from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: command } };
}

function envelope(messages: object[], phoneId = '98765') {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages',
    value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, messages },
  }] }] };
}

function post(payload: object, env = config, signedBody = JSON.stringify(payload)) {
  const signature = createHmac('sha256', 'test-meta-secret').update(signedBody).digest('hex');
  return worker.fetch(new Request(url, { method: 'POST', body: JSON.stringify(payload),
    headers: { 'X-Hub-Signature-256': 'sha256=' + signature },
  }), env);
}

it('answers the staging verification challenge only with the configured token and mode', async () => {
  const verify = (token: string, mode = 'subscribe', env = config) => worker.fetch(new Request(
    url + '?hub.mode=' + mode + '&hub.challenge=123456&hub.verify_token=' + token,
  ), env);
  expect(await (await verify('test-verification-token')).text()).toBe('123456');
  expect((await verify('bad')).status).toBe(403);
  expect((await verify('test-verification-token', 'unsubscribe')).status).toBe(403);
  expect((await verify('', 'subscribe', {} as Env)).status).toBe(404);
});

it('rejects a signature for a different body before any external request', async () => {
  const outbound = vi.fn();
  vi.stubGlobal('fetch', outbound);
  expect((await post(envelope([message(owner)]), config, '{}')).status).toBe(401);
  expect(outbound).not.toHaveBeenCalled();
});

it('ignores unrelated numbers, unlisted senders, status callbacks and write commands', async () => {
  const outbound = vi.fn();
  vi.stubGlobal('fetch', outbound);
  for (const body of [envelope([message(owner)], '999'), envelope([message(colleague)]),
    envelope([message(owner, '/pay')]), envelope([{ ...message(owner), timestamp: '100' }]),
    envelope([{ ...message(owner), group_id: 'group' }]), envelope([])]) {
    expect((await post(body)).status).toBe(200);
  }
  expect(outbound).not.toHaveBeenCalled();
});

it('delivers the same read-only report privately to each configured sender in a batched update', async () => {
  const recipients: string[] = [];
  const outbound = vi.fn(async (target: string, init: RequestInit) => {
    const dest = new URL(target);
    if (dest.hostname === 'api.airtable.com') {
      expect(init.method ?? 'GET').toBe('GET');
      const records = dest.pathname.endsWith(TABLES.TENANCIES)
        ? [{ id: 't1', fields: { Label: 'Unit [A]' } }]
        : [{ id: 'c1', fields: { Label: 'Rent', Balance: 15, Status: 'Due',
          'Due Date': '2020-01-01', Tenancy: ['t1'] } }];
      return Response.json({ records });
    }
    expect(dest.href).toBe('https://graph.facebook.com/v25.0/98765/messages');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-access-token');
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe('text');
    expect(body.text.body).toContain('Unit [A] - subtotal $15.00');
    recipients.push(body.to);
    return Response.json({ messages: [{ id: 'accepted' }] });
  });
  vi.stubGlobal('fetch', outbound);
  const res = await post(envelope([message(owner), message('61400000003'), message(colleague, ' /Reminder ')]),
    { ...config, WHATSAPP_ALLOWED_SENDERS: owner + ', ' + colleague });
  expect(res.status).toBe(200);
  expect(recipients).toEqual([owner, colleague]);
  const count = outbound.mock.calls.length;
  expect((await post(envelope([message(owner)]))).status).toBe(200);
  expect(outbound).toHaveBeenCalledTimes(count);
});

it('returns a retryable error if Graph rejects a reply', async () => {
  vi.stubGlobal('fetch', async (target: string) => target.startsWith('https://api.airtable.com/')
    ? Response.json({ records: [] }) : new Response('sensitive provider response', { status: 503 }));
  const res = await post(envelope([message(owner)]));
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain('sensitive');
});

it('splits a long Unicode label into deliverable WhatsApp texts without dropping characters', async () => {
  const label = '🏠'.repeat(2500);
  const chunks: string[] = [];
  vi.stubGlobal('fetch', async (target: string, init: RequestInit) => {
    if (target.startsWith('https://api.airtable.com/')) {
      const records = new URL(target).pathname.endsWith(TABLES.TENANCIES)
        ? [{ id: 't1', fields: { Label: label } }]
        : [{ id: 'c1', fields: { Label: 'Rent', Balance: 1, 'Due Date': '2020-01-01', Tenancy: ['t1'] } }];
      return Response.json({ records });
    }
    chunks.push(JSON.parse(String(init.body)).text.body);
    return Response.json({});
  });
  expect((await post(envelope([message(owner)]))).status).toBe(200);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(text => text.length <= 4096 && !/[\uD800-\uDFFF]/u.test(text))).toBe(true);
  expect(chunks.join('')).toContain(label);
});
