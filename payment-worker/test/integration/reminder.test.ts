import { SELF, env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';

const AIRTABLE_ORIGIN = 'https://api.airtable.com';
const TELEGRAM_ORIGIN = 'https://api.telegram.org';
const SECRET = 'a'.repeat(32);
const USER_ID = 1234;
const TENANCIES = 'tblvVmo12VikITRH6';
const CHARGES = 'tblNCw6ZxspNxiKCu';
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

function stubTelegram(times = 10): any[] {
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

function mockTenancies(): void {
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
    .reply(200, {
      records: [
        { id: 'recT1', fields: { Label: '6B Sun Peng' } },
      ],
    });
}

function mockCharges(): void {
  const today = todayISOInMelbourne();
  const overdueOne = addDaysISO(today, -74);
  const overdueTwo = addDaysISO(today, -43);
  const overdueThree = addDaysISO(today, -13);
  const dueSoon = addDaysISO(today, 2);
  const paidDueSoon = addDaysISO(today, 3);

  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
    .reply(200, {
      records: [
        { id: 'recC1', fields: { Label: 'March Rent', Balance: 1650, Status: 'Overdue', 'Due Date': overdueOne, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recC2', fields: { Label: 'April Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': overdueTwo, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recC3', fields: { Label: 'May Rent', Balance: 1650, Status: 'Partial', 'Due Date': overdueThree, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recC4', fields: { Label: 'June Rent', Balance: 1650, Status: 'Due', 'Due Date': dueSoon, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recPaid', fields: { Label: 'Paid Rent', Balance: 1650, Status: 'Paid', 'Due Date': paidDueSoon, Tenancy: ['recT1'], Type: 'Rent' } },
      ],
    });
}

function todayISOInMelbourne(): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to resolve current rent date');
  return `${year}-${month}-${day}`;
}

function addDaysISO(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('/reminder command', () => {
  it('lists overdue and due-soon charges without changing the wizard session', async () => {
    const telegramPayloads = stubTelegram(1);
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify({
      step: 'enter_amount',
      chargeId: 'recOld',
    }), {
      expirationTtl: 3600,
    });
    mockTenancies();
    mockCharges();

    const res = await telegramUpdate(messageUpdate(1, '/reminder'));

    expect(res.status).toBe(200);
    expect(JSON.parse((await testEnv.SESSION_KV.get(`session:${USER_ID}`)) ?? '{}')).toEqual({
      step: 'enter_amount',
      chargeId: 'recOld',
    });
    const text = String(telegramPayloads[0].text);
    expect(text).toContain('Pay now - subtotal $4,950.00');
    expect(text).toContain('6B Sun Peng - subtotal $4,950.00');
    expect(text).toContain('Due in next 14 days - subtotal $1,650.00');
    expect(text).toContain('6B Sun Peng - subtotal $1,650.00');
    expect(text).toContain('Rent');
    expect(text).not.toContain('Paid Rent');
  });

  it('rejects non-authorized users before reading Airtable', async () => {
    const telegramPayloads = stubTelegram(1);

    const res = await telegramUpdate(messageUpdate(2, '/reminder', 999));

    expect(res.status).toBe(200);
    expect(telegramPayloads.some((payload) => String(payload.text).includes('Unauthorised'))).toBe(true);
  });
});
