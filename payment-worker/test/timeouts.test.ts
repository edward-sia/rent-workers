import { AirtableClient } from '@rent/airtable-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';

const { webhookCallback } = vi.hoisted(() => ({
  webhookCallback: vi.fn(() => async () => new Response('ok')),
}));

vi.mock('grammy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('grammy')>()),
  webhookCallback,
}));

const SECRET = 'a'.repeat(32);
const env = {
  TELEGRAM_BOT_TOKEN: 'test:bot:token',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  AIRTABLE_TOKEN: 'test-token',
  AIRTABLE_BASE_ID: 'appTEST',
  AUTHORIZED_USER_ID: '1234',
  SESSION_KV: {} as KVNamespace,
  CONFIRM_LOCK: {} as Env['CONFIRM_LOCK'],
} satisfies Env;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timeouts', () => {
  // A move-in Confirm makes up to eight Airtable calls, so grammY's 10 s default could cut it off.
  it('gives the webhook handler 50 seconds', async () => {
    const { default: worker } = await import('../src/index');

    const res = await worker.fetch(new Request('https://worker.test/', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: '{}',
    }), env);

    expect(res.status).toBe(200);
    expect(webhookCallback).toHaveBeenCalledWith(
      expect.anything(),
      'cloudflare-mod',
      { timeoutMilliseconds: 50_000 },
    );
  });

  it('builds the Airtable client with a 4 second request timeout', async () => {
    const { airtableFor } = await import('../src/airtable');

    const client = airtableFor(env);

    expect(client).toBeInstanceOf(AirtableClient);
    expect(client).toEqual(new AirtableClient(env, { timeoutMs: 4000 }));
    expect(client).not.toEqual(new AirtableClient(env));
  });

  // The longest Confirm is a move-in with the most rent charges and a bond. If every Airtable
  // call runs to its timeout, grammY must still not give up before the writes finish.
  it('the slowest move-in Confirm fits in the webhook timeout', async () => {
    const { MOVE_IN_CONFIRM_WORST_CASE_MS, OTHER_CALLS_ALLOWANCE_MS, WEBHOOK_TIMEOUT_MS } = await import('../src/budget');

    expect(MOVE_IN_CONFIRM_WORST_CASE_MS + OTHER_CALLS_ALLOWANCE_MS).toBeLessThanOrEqual(WEBHOOK_TIMEOUT_MS);
  });
});
