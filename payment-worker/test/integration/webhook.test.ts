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
