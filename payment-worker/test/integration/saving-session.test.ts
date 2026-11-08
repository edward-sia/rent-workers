import { fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AIRTABLE_ORIGIN,
  OP_ID,
  USER_ID,
  buttonData,
  callbackUpdate,
  messageUpdate,
  stubTelegram,
  telegramUpdate,
  testEnv,
} from './helpers';

// Nothing may move a session out of `saving` except the save itself. A button from an earlier
// screen that could do so would let a second Confirm write the same operation again.
// When you add a button, add its callback data to BUTTONS.

const SESSION_KEY = `session:${USER_ID}`;
const airtable = { calls: 0 };

beforeAll(() => {
  // One set of interceptors for the whole file. Each request fails, so a handler that gets
  // this far can't go on to show a new screen.
  for (const method of ['GET', 'POST', 'PATCH']) {
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: /.*/, method })
      .reply(() => {
        airtable.calls += 1;
        return { statusCode: 500, data: {} };
      })
      .persist();
  }
});

beforeEach(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  airtable.calls = 0;
  await testEnv.SESSION_KV.delete(SESSION_KEY);
});

afterEach(() => {
  fetchMock.deactivate();
  vi.restoreAllMocks();
});

async function stored(): Promise<unknown> {
  const raw = await testEnv.SESSION_KV.get(SESSION_KEY);
  return raw === null ? null : JSON.parse(raw);
}

const SESSION = {
  tenancyId: 'recT1', tenancyLabel: '6B-R6 Sun Peng', opId: OP_ID, step: 'saving',
};
const SAVING = [
  {
    flow: 'pay',
    session: {
      ...SESSION, flow: 'pay', chargeId: 'recC1', chargeLabel: '6B Sun Peng 2026-05 Rent', chargeBalance: 1650,
      amount: 1650, method: 'Cash', date: '2026-05-01',
    },
  },
  {
    flow: 'movein',
    session: {
      flow: 'movein', step: 'saving', opId: OP_ID, roomId: 'recR1', roomCode: '6B-R6', roomOccupied: false,
      defaultRent: 1500, tenantName: 'Sun Peng', monthlyRent: 1500, startDate: '2027-01-01',
      firstOption: 'regular', firstAmount: 1500, bond: 1500,
    },
  },
  {
    flow: 'moveout',
    session: {
      ...SESSION, flow: 'moveout', startDate: '2026-01-01', roomId: 'recR1', roomCode: '6B-R6',
      endDate: '2026-11-30',
    },
  },
];

// Every button the bot sends, except the two that start a new operation on purpose:
// `/pay`'s tenant list (`tenancy:`) and `/movein`'s room list (`mi:r:`).
const BUTTONS = [
  'charge:recC1', 'method:Cash', 'method:Bank Transfer', 'date:2026-05-01', 'date:manual', 'back:pay',
  `confirm:yes:${OP_ID}`, 'confirm:no',
  'mi:tenant:existing', 'mi:tenant:new', 'mi:notes:skip', 'mi:rent:default', 'mi:s:today', 'mi:s:next1',
  'mi:s:manual', 'mi:f:regular', 'mi:f:part', 'mi:amt:suggested', 'mi:bond:suggested', 'mi:bond:none',
  `mi:confirm:${OP_ID}`, 'mi:cancel',
  'mo:t:recT1', 'mo:d:today', 'mo:d:eom', 'mo:d:manual', `mo:confirm:${OP_ID}`, 'mo:cancel',
];
const TEXTS = ['1650', '2026-05-01', 'Sun Peng'];

describe('a session that is saving', () => {
  const cases = SAVING.flatMap(({ flow, session }) => BUTTONS.map((button) => ({ flow, session, button })));

  it.each(cases)('$flow: button $button leaves it alone', async ({ session, button }) => {
    const telegram = stubTelegram(2);
    await testEnv.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), { expirationTtl: 3600 });

    await telegramUpdate(callbackUpdate(1, button));

    expect(await stored()).toEqual(session);
    expect(airtable.calls).toBe(0);
    expect(buttonData(telegram)).toEqual([]);
  });

  const texts = SAVING.flatMap(({ flow, session }) => TEXTS.map((text) => ({ flow, session, text })));

  it.each(texts)('$flow: typed "$text" leaves it alone', async ({ session, text }) => {
    const telegram = stubTelegram(1);
    await testEnv.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), { expirationTtl: 3600 });

    await telegramUpdate(messageUpdate(1, text));

    expect(await stored()).toEqual(session);
    expect(airtable.calls).toBe(0);
    expect(buttonData(telegram)).toEqual([]);
  });

});
