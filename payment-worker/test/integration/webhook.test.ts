import { SELF, fetchMock } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SECRET = 'a'.repeat(32);

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
});

describe('webhook auth', () => {
  it('returns a banner for GET without requiring webhook auth', async () => {
    const res = await SELF.fetch('https://worker.test/');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('payment-bot is running');
  });

  it('returns a non-mutating health payload without webhook auth', async () => {
    const res = await SELF.fetch('https://worker.test/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      ok: true,
      service: 'payment-bot',
    });
  });

  it('rejects POST without the Telegram webhook secret header', async () => {
    const res = await SELF.fetch('https://worker.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
  });

  it('rejects POST with the wrong Telegram webhook secret header', async () => {
    const res = await SELF.fetch('https://worker.test/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
  });

  it('accepts POST with the correct Telegram webhook secret header', async () => {
    fetchMock
      .get('https://api.telegram.org')
      .intercept({ path: /.*/, method: 'POST' })
      .reply(200, { ok: true, result: {} });

    const res = await SELF.fetch('https://worker.test/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': SECRET,
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 1234, type: 'private' },
          from: { id: 1234, is_bot: false, first_name: 'O' },
          text: '/help',
        },
      }),
    });

    expect(res.status).toBe(200);
  });
});

it('acknowledges a signed WhatsApp reminder in workerd and recognizes a redelivery', async () => {
  const { env } = await import('cloudflare:test');
  const { default: worker } = await import('../../src/index');
  const bindings = {
    ...env,
    WHATSAPP_GRAPH_VERSION: 'v25.0', WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ALLOWED_SENDERS: '61400000001', WHATSAPP_ACCESS_TOKEN: 'access',
    WHATSAPP_APP_SECRET: 'test-meta-secret',
  } as unknown as import('../../src/types').Env;
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{
    field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '123456' },
      messages: [{ id: 'wamid.test', type: 'text', from: '61400000001',
        timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'reminder' } }] },
  }] }] });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode('test-meta-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join('');
  fetchMock.get('https://api.airtable.com').intercept({ path: /^\/v0\/appTEST\//, method: 'GET' })
    .reply(200, { records: [] }).times(2);
  fetchMock.get('https://graph.facebook.com').intercept({ path: '/v25.0/123456/messages', method: 'POST' })
    .reply(200, { messages: [{ id: 'wamid.sent' }] });
  for (let delivery = 0; delivery < 2; delivery++) {
    const res = await worker.fetch(new Request('https://worker.test/webhooks/whatsapp', {
      method: 'POST', body, headers: { 'X-Hub-Signature-256': 'sha256=' + hex },
    }), bindings);
    expect(res.status).toBe(200);
  }
});
