import { SELF, env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';
import { OP_ID, confirmButton } from './helpers';

const AIRTABLE_ORIGIN = 'https://api.airtable.com';
const TELEGRAM_ORIGIN = 'https://api.telegram.org';
const SECRET = 'a'.repeat(32);
const USER_ID = 1234;
const TENANCIES = 'tblvVmo12VikITRH6';
const CHARGES = 'tblNCw6ZxspNxiKCu';
const PAYMENTS = 'tbl8Zl9C9fzBDPllu';
const testEnv = env as unknown as Env;

interface MockReplyOptions {
  body?: unknown;
}

beforeEach(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await testEnv.SESSION_KV.delete(`session:${USER_ID}`);
});

afterEach(() => {
  fetchMock.deactivate();
  vi.restoreAllMocks();
});

function telegramUpdate(body: object): Promise<Response> {
  return SELF.fetch('https://worker.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': SECRET,
    },
    body: JSON.stringify(body),
  });
}

function messageUpdate(updateId: number, text: string, userId = USER_ID): object {
  const commandLength = text.startsWith('/') ? text.split(/\s/, 1)[0]?.length ?? text.length : 0;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: 'private' },
      from: { id: userId, is_bot: false, first_name: 'Operator' },
      text,
      ...(commandLength > 0
        ? { entities: [{ offset: 0, length: commandLength, type: 'bot_command' }] }
        : {}),
    },
  };
}

function callbackUpdate(updateId: number, data: string): object {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq-${updateId}`,
      chat_instance: 'ci',
      from: { id: USER_ID, is_bot: false, first_name: 'Operator' },
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: USER_ID, type: 'private' },
      },
      data,
    },
  };
}

function parseBody(body: unknown): any {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return Object.fromEntries(new URLSearchParams(body));
    }
  }
  if (body instanceof ArrayBuffer) return parseBody(new TextDecoder().decode(body));
  if (body instanceof Uint8Array) return parseBody(new TextDecoder().decode(body));
  throw new Error(`Unexpected mock body: ${String(body)}`);
}

function stubTelegram(times = 20): any[] {
  const payloads: any[] = [];
  fetchMock
    .get(TELEGRAM_ORIGIN)
    .intercept({ path: /.*/, method: 'POST' })
    .reply((opts: MockReplyOptions) => {
      payloads.push(parseBody(opts.body));
      return { statusCode: 200, data: { ok: true, result: {} } };
    })
    .times(times);
  return payloads;
}

function mockTenancy(label = '6B Sun Peng', balance = 1650, times = 2): void {
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
    .reply(200, {
      records: [{ id: 'recT1', fields: { Label: label, Balance: balance } }],
    })
    .times(times);
}

function mockCharges(records = [{
  id: 'recC1',
  fields: {
    Label: '6B Sun Peng 2026-05 Rent',
    Balance: 1650,
    Status: 'Unpaid',
    'Due Date': '2026-05-01',
    Tenancy: ['recT1'],
  },
}], times = 2): void {
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
    .reply(200, { records })
    .times(times);
}

const PAY_CONFIRM_SESSION = {
  flow: 'pay', step: 'confirm', tenancyId: 'recT1', tenancyLabel: '6B Sun Peng',
  chargeId: 'recC1', chargeLabel: '6B Sun Peng 2026-05 Rent', chargeBalance: 1650,
  amount: 1650, method: 'Cash', date: '2026-05-01', opId: OP_ID,
};

describe('payment wizard', () => {
  it('replies to non-authorized Telegram users without writing session state', async () => {
    const telegramPayloads = stubTelegram(1);

    const res = await telegramUpdate(messageUpdate(1, '/pay', 999));

    expect(res.status).toBe(200);
    expect(await testEnv.SESSION_KV.get('session:999')).toBeNull();
    expect(telegramPayloads.some(payload => String(payload.text).includes('Unauthorised'))).toBe(true);
  });

  it('runs the full payment wizard and creates a Payment record', async () => {
    const telegramPayloads = stubTelegram(12);
    mockTenancy();
    mockCharges();

    let createBody: any = null;
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: `/v0/appTEST/${PAYMENTS}`, method: 'POST' })
      .reply((opts: MockReplyOptions) => {
        createBody = parseBody(opts.body);
        return {
          statusCode: 200,
          data: {
            id: 'recPNew',
            fields: {
              Label: 'Sun Peng 2026-04-26 $1,650.00',
              Charge: ['recC1'],
              Amount: 1650,
              'Paid Date': '2026-04-26',
              Method: 'Cash',
            },
          },
        };
      });

    await telegramUpdate(messageUpdate(1, '/pay'));
    await telegramUpdate(callbackUpdate(2, 'tenancy:recT1'));
    await telegramUpdate(callbackUpdate(3, 'charge:recC1'));
    await telegramUpdate(messageUpdate(4, '1650'));
    await telegramUpdate(callbackUpdate(5, 'method:Cash'));
    const today = new Date().toISOString().slice(0, 10);
    await telegramUpdate(callbackUpdate(6, `date:${today}`));
    await telegramUpdate(callbackUpdate(7, confirmButton(telegramPayloads, 'confirm:yes')));

    expect(createBody).not.toBeNull();
    expect(createBody.fields).toEqual(expect.objectContaining({
      Charge: ['recC1'],
      Amount: 1650,
      'Paid Date': today,
      Method: 'Cash',
    }));
    expect(telegramPayloads.some(payload =>
      String(payload.text).includes(`https://airtable.com/appTEST/${PAYMENTS}/recPNew`),
    )).toBe(true);
    expect(await testEnv.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
  });

  it('keeps the session unchanged for an invalid amount', async () => {
    const telegramPayloads = stubTelegram(1);
    const seeded = {
      step: 'enter_amount',
      tenancyId: 'recT1',
      tenancyLabel: '6B Sun Peng',
      chargeId: 'recC1',
      chargeLabel: '6B Sun Peng 2026-05 Rent',
      chargeBalance: 1650,
    };
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify(seeded), {
      expirationTtl: 3600,
    });

    await telegramUpdate(messageUpdate(20, 'abc'));

    expect(JSON.parse((await testEnv.SESSION_KV.get(`session:${USER_ID}`)) ?? '{}')).toEqual(seeded);
    expect(telegramPayloads.some(payload => String(payload.text).includes('Invalid amount'))).toBe(true);
  });

  it('keeps the session unchanged for an invalid manual date', async () => {
    const telegramPayloads = stubTelegram(1);
    const seeded = {
      step: 'enter_date',
      tenancyId: 'recT1',
      tenancyLabel: '6B Sun Peng',
      chargeId: 'recC1',
      chargeLabel: '6B Sun Peng 2026-05 Rent',
      chargeBalance: 1650,
      amount: 1650,
      method: 'Cash',
    };
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify(seeded), {
      expirationTtl: 3600,
    });

    await telegramUpdate(messageUpdate(30, '2026-13-01'));

    expect(JSON.parse((await testEnv.SESSION_KV.get(`session:${USER_ID}`)) ?? '{}')).toEqual(seeded);
    expect(telegramPayloads.some(payload => String(payload.text).includes('Invalid date'))).toBe(true);
  });

  it('/pay asks Airtable for active tenancies and ended ones that still owe', async () => {
    stubTelegram(1);
    let requestPath = '';
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply((opts: { path: string }) => {
        requestPath = opts.path;
        return { statusCode: 200, data: { records: [] } };
      });

    await telegramUpdate(messageUpdate(70, '/pay'));

    const formula = new URL(requestPath, 'https://api.airtable.com').searchParams.get('filterByFormula');
    expect(formula).toBe('OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()), {Balance} > 0)');
  });

  it('/cancel lists all commands', async () => {
    const telegramPayloads = stubTelegram(1);

    await telegramUpdate(messageUpdate(71, '/cancel'));

    const text = String(telegramPayloads[0]?.text);
    expect(text).toContain('/movein');
    expect(text).toContain('/moveout');
  });

  it('clears the session on /cancel', async () => {
    const telegramPayloads = stubTelegram(1);
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify({ step: 'confirm' }), {
      expirationTtl: 3600,
    });

    await telegramUpdate(messageUpdate(40, '/cancel'));

    expect(await testEnv.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
    expect(telegramPayloads.some(payload => String(payload.text).includes('Cancelled'))).toBe(true);
  });

  it('shows only the HTTP status when saving the payment fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegramPayloads = stubTelegram(2);
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify({
      flow: 'pay', step: 'confirm', tenancyId: 'recT1', tenancyLabel: '6B Sun Peng',
      chargeId: 'recC1', chargeLabel: '6B Sun Peng 2026-05 Rent', chargeBalance: 1650,
      amount: 1650, method: 'Cash', date: '2026-05-01', opId: OP_ID,
    }), { expirationTtl: 3600 });
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: `/v0/appTEST/${PAYMENTS}`, method: 'POST' })
      .reply(422, { error: { type: 'INVALID_VALUE', message: 'secret-airtable-detail' } });

    await telegramUpdate(callbackUpdate(45, `confirm:yes:${OP_ID}`));

    const text = String(telegramPayloads.filter((payload) => payload.text !== undefined).at(-1).text);
    expect(text).toContain('Failed to save payment');
    expect(text).toContain('HTTP 422');
    expect(text).not.toContain('secret-airtable-detail');
    expect(error).toHaveBeenCalledWith('[payment-bot] pay failed: create Payments: HTTP 422');
    expect(error.mock.calls.flat().map(String).join('\n')).not.toContain('secret-airtable-detail');
    expect(await testEnv.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
  });

  it('two Confirm taps at the same time record one payment', async () => {
    const telegramPayloads = stubTelegram(4);
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify(PAY_CONFIRM_SESSION), { expirationTtl: 3600 });
    let posts = 0;
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: `/v0/appTEST/${PAYMENTS}`, method: 'POST' })
      .reply(() => {
        posts += 1;
        return { statusCode: 200, data: { id: 'recPNew', fields: { Label: 'Sun Peng 2026-05-01 $1,650.00' } } };
      });

    await Promise.all([
      telegramUpdate(callbackUpdate(70, `confirm:yes:${OP_ID}`)),
      telegramUpdate(callbackUpdate(71, `confirm:yes:${OP_ID}`)),
    ]);

    expect(posts).toBe(1);
    const replies = telegramPayloads.filter((payload) => payload.text !== undefined).map((payload) => String(payload.text));
    expect(replies.filter((text) => text.includes('Payment recorded'))).toHaveLength(1);
    expect(replies.filter((text) => text.includes('already being saved'))).toHaveLength(1);
    expect(await testEnv.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
  });

  it('a Confirm from an older screen does not record the current payment', async () => {
    const telegramPayloads = stubTelegram(4);
    const current = { ...PAY_CONFIRM_SESSION, opId: 'bbbbbbbbbbbb' };
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify(current), { expirationTtl: 3600 });

    await telegramUpdate(callbackUpdate(72, 'confirm:yes:aaaaaaaaaaaa'));
    await telegramUpdate(callbackUpdate(73, 'confirm:yes'));

    const replies = telegramPayloads.filter((payload) => payload.text !== undefined).map((payload) => String(payload.text));
    expect(replies).toHaveLength(2);
    expect(replies.every((text) => text.includes('Session expired'))).toBe(true);
    expect(JSON.parse(String(await testEnv.SESSION_KV.get(`session:${USER_ID}`)))).toEqual(current);
  });

  it('does not write a payment when confirm runs after the session expires', async () => {
    const telegramPayloads = stubTelegram(2);

    await telegramUpdate(callbackUpdate(50, `confirm:yes:${OP_ID}`));

    expect(await testEnv.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
    expect(telegramPayloads.some(payload => String(payload.text).includes('Session expired'))).toBe(true);
  });

  it('does not advance to charge selection when the tenant has no outstanding charges', async () => {
    const telegramPayloads = stubTelegram(3);
    mockTenancy('6B Sun Peng', 1650, 2);
    mockCharges([], 1);

    await telegramUpdate(messageUpdate(60, '/pay'));
    await telegramUpdate(callbackUpdate(61, 'tenancy:recT1'));

    expect(await testEnv.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
    expect(telegramPayloads.some(payload => String(payload.text).includes('no outstanding charges'))).toBe(true);
  });

  it('escapes Airtable labels interpolated into Telegram Markdown messages', async () => {
    const telegramPayloads = stubTelegram(12);
    mockTenancy('6B A_B [Tenant](One) *VIP* `code`', 1650, 2);
    mockCharges([{
      id: 'recC1',
      fields: {
        Label: 'Rent_[May] (unit) *due* `soon`',
        Balance: 1650,
        Status: 'Unpaid',
        'Due Date': '2026-05-01',
        Tenancy: ['recT1'],
      },
    }], 2);

    await telegramUpdate(messageUpdate(70, '/pay'));
    await telegramUpdate(callbackUpdate(71, 'tenancy:recT1'));
    await telegramUpdate(callbackUpdate(72, 'charge:recC1'));
    await telegramUpdate(messageUpdate(73, '1650'));
    await telegramUpdate(callbackUpdate(74, 'method:Cash'));
    await telegramUpdate(callbackUpdate(75, 'date:2026-04-26'));

    const markdownPayloads = telegramPayloads
      .filter(payload => payload.parse_mode === 'Markdown')
      .map(payload => String(payload.text));

    expect(markdownPayloads.some(text =>
      text.includes('6B A\\_B \\[Tenant\\]\\(One\\) \\*VIP\\* \\`code\\`'),
    )).toBe(true);
    expect(markdownPayloads.some(text =>
      text.includes('Rent\\_\\[May\\] \\(unit\\) \\*due\\* \\`soon\\`'),
    )).toBe(true);
    expect(markdownPayloads.some(text => text.includes('📋 *Confirm Payment*'))).toBe(true);
  });
});
