import { fetchMock } from 'cloudflare:test';
import { planMoveInCharges } from '@rent/tenancy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AIRTABLE_ORIGIN,
  CHARGES,
  OP_ID,
  PAYMENTS,
  USER_ID,
  buttonData,
  callbackUpdate,
  stubTelegram,
  telegramUpdate,
  testEnv,
} from './helpers';

const SESSION_KEY = `session:${USER_ID}`;

beforeEach(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await testEnv.SESSION_KV.delete(SESSION_KEY);
});

afterEach(() => {
  fetchMock.deactivate();
  vi.restoreAllMocks();
});

const PAY_CONFIRM = {
  flow: 'pay', step: 'confirm', tenancyId: 'recT1', tenancyLabel: '6B Sun Peng',
  chargeId: 'recC1', chargeLabel: '6B Sun Peng 2026-05 Rent', chargeBalance: 1650,
  amount: 1650, method: 'Cash', date: '2026-05-01', opId: OP_ID,
};

const MOVE_IN_START = '2027-01-01';
const MOVE_IN_CONFIRM = {
  flow: 'movein', step: 'mi_confirm', roomId: 'recR1', roomCode: '6B-R6', roomOccupied: false,
  defaultRent: 1500, tenantName: 'Sun Peng', monthlyRent: 1500, startDate: MOVE_IN_START,
  firstOption: 'regular', firstAmount: 1500, opId: OP_ID,
};

const MOVE_OUT_CONFIRM = {
  flow: 'moveout', step: 'mo_confirm', tenancyId: 'recT1', tenancyLabel: '6B-R6 Sun Peng',
  startDate: '2026-01-01', roomId: 'recR1', roomCode: '6B-R6', endDate: '2026-11-30', opId: OP_ID,
};

/** The move-in confirm session, with the charges its screen would show today. */
function moveInConfirm(): object {
  return {
    ...MOVE_IN_CONFIRM,
    plannedCharges: planMoveInCharges({
      startDate: MOVE_IN_START,
      monthlyRent: 1500,
      option: 'regular',
      firstAmount: 1500,
      todayUtc: new Date().toISOString().slice(0, 10),
    }),
  };
}

async function seed(session: object): Promise<void> {
  await testEnv.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), { expirationTtl: 3600 });
}

async function stored(): Promise<unknown> {
  const raw = await testEnv.SESSION_KV.get(SESSION_KEY);
  return raw === null ? null : JSON.parse(raw);
}

async function waitForStep(step: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const session = await stored() as { step?: string } | null;
    if (session?.step === step) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`The session never reached ${step}`);
}

describe('a payment that is saving', () => {
  it('an earlier date button cannot reopen a payment while its write is still running', async () => {
    const telegram = stubTelegram(4);
    await seed(PAY_CONFIRM);
    let posts = 0;
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: `/v0/appTEST/${PAYMENTS}`, method: 'POST' })
      .reply(() => {
        posts += 1;
        return { statusCode: 200, data: { id: `recP${posts}`, fields: { Label: 'Sun Peng 2026-05-01 $1,650.00' } } };
      })
      .delay(300);

    const confirm = telegramUpdate(callbackUpdate(1, `confirm:yes:${OP_ID}`));
    await waitForStep('saving');
    await telegramUpdate(callbackUpdate(2, 'date:2026-05-01'));
    await confirm;

    // Before the fix, the date button showed a new confirm screen with a new operation ID,
    // and that screen's Confirm recorded the same payment again.
    expect(buttonData(telegram)).toEqual([]);

    expect(posts).toBe(1);
    const texts = telegram.map((payload) => String(payload.text ?? ''));
    expect(texts.filter((text) => text.includes('Payment recorded'))).toHaveLength(1);
    expect(texts.filter((text) => text.includes('Session expired'))).toHaveLength(1);
  });
});

describe('/pay steps', () => {
  it('a charge button from another tenant\'s list is rejected', async () => {
    const telegram = stubTelegram(2);
    const session = { flow: 'pay', step: 'select_charge', tenancyId: 'recT1', tenancyLabel: '6B Sun Peng' };
    await seed(session);
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, {
        records: [{ id: 'recC9', fields: { Label: '7A Other 2026-05 Rent', Balance: 900, Tenancy: ['recT2'] } }],
      });

    await telegramUpdate(callbackUpdate(1, 'charge:recC9'));

    expect(await stored()).toEqual(session);
    expect(telegram.some((payload) => String(payload.text).includes('Session expired'))).toBe(true);
  });
});

describe('when the Confirm lock cannot be reached', () => {
  const flows = [
    { flow: 'pay', button: `confirm:yes:${OP_ID}`, session: () => PAY_CONFIRM },
    { flow: 'movein', button: `mi:confirm:${OP_ID}`, session: moveInConfirm },
    { flow: 'moveout', button: `mo:confirm:${OP_ID}`, session: () => MOVE_OUT_CONFIRM },
  ];

  it.each(flows)('$flow keeps the confirm screen and its buttons', async ({ button, session }) => {
    const telegram = stubTelegram(2);
    const seeded = session();
    await seed(seeded);
    vi.spyOn(testEnv.CONFIRM_LOCK, 'get').mockImplementation(() => {
      throw new Error('lock down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await telegramUpdate(callbackUpdate(1, button));

    // The error is a new message. An edit would replace the confirm screen and drop its buttons.
    const notice = telegram.find((payload) => String(payload.text ?? '').includes('Could not start the save'));
    expect(notice).toBeDefined();
    expect(notice.message_id).toBeUndefined();
    expect(telegram.filter((payload) => payload.message_id !== undefined)).toEqual([]);
    expect(await stored()).toEqual(seeded);
  });

  it('the same /pay Confirm button saves once the lock is back', async () => {
    const telegram = stubTelegram(4);
    await seed(PAY_CONFIRM);
    const lock = vi.spyOn(testEnv.CONFIRM_LOCK, 'get').mockImplementationOnce(() => {
      throw new Error('lock down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let posts = 0;
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: `/v0/appTEST/${PAYMENTS}`, method: 'POST' })
      .reply(() => {
        posts += 1;
        return { statusCode: 200, data: { id: 'recPNew', fields: { Label: 'Sun Peng 2026-05-01 $1,650.00' } } };
      });

    await telegramUpdate(callbackUpdate(1, `confirm:yes:${OP_ID}`));
    await telegramUpdate(callbackUpdate(2, `confirm:yes:${OP_ID}`));

    expect(lock).toHaveBeenCalledTimes(2);
    expect(posts).toBe(1);
    expect(telegram.some((payload) => String(payload.text).includes('Payment recorded'))).toBe(true);
  });
});
