import { fetchMock } from 'cloudflare:test';
import { addDaysISO, endOfMonthISO } from '@rent/tenancy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { melbourneDateISO } from '../../src/format';
import {
  AIRTABLE_ORIGIN,
  CHARGES,
  ROOMS,
  TENANCIES,
  USER_ID,
  buttonData,
  callbackUpdate,
  messageUpdate,
  parseBody,
  stubTelegram,
  telegramUpdate,
  testEnv,
  type MockReplyOptions,
} from './helpers';

const SESSION_KEY = `session:${USER_ID}`;

interface Captured {
  body: any;
  path: string;
  calls: number;
}

beforeEach(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await testEnv.SESSION_KV.delete(SESSION_KEY);
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
  vi.restoreAllMocks();
});

const TENANCY_RECORD = {
  id: 'recT1',
  fields: { Label: '6B-R6 Sun Peng', Balance: 0, 'Start Date': '2026-01-01', Room: ['recR1'] },
};

function mockGet(table: string, records: object[]): Captured {
  const captured: Captured = { body: null, path: '', calls: 0 };
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${table}\\?.*`) })
    .reply((opts: MockReplyOptions) => {
      captured.path = String(opts.path);
      captured.calls += 1;
      return { statusCode: 200, data: { records } };
    });
  return captured;
}

function mockPatch(table: string, recordId: string, fields: object, statusCode = 200, times = 1): Captured {
  const captured: Captured = { body: null, path: '', calls: 0 };
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: `/v0/appTEST/${table}/${recordId}`, method: 'PATCH' })
    .reply((opts: MockReplyOptions) => {
      captured.body = parseBody(opts.body);
      captured.calls += 1;
      const data: object = statusCode === 200
        ? { id: recordId, fields }
        : { error: { type: 'INVALID_VALUE', message: 'secret-airtable-detail' } };
      return { statusCode, data };
    })
    .times(times);
  return captured;
}

function formulaOf(path: string): string | null {
  return new URL(path, AIRTABLE_ORIGIN).searchParams.get('filterByFormula');
}

async function seedSession(session: object): Promise<void> {
  await testEnv.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), { expirationTtl: 3600 });
}

async function readSession(): Promise<any> {
  const raw = await testEnv.SESSION_KV.get(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function texts(payloads: any[]): string[] {
  return payloads.filter((payload) => payload.text !== undefined).map((payload) => String(payload.text));
}

function lastReply(payloads: any[]): any {
  return payloads.filter((payload) => payload.text !== undefined).at(-1);
}

const CONFIRM_SESSION = {
  flow: 'moveout',
  step: 'mo_confirm',
  tenancyId: 'recT1',
  tenancyLabel: '6B-R6 Sun Peng',
  startDate: '2026-01-01',
  roomId: 'recR1',
  roomCode: '6B-R6',
};

describe('/moveout', () => {
  it('full move-out with end date today', async () => {
    const today = melbourneDateISO();
    const telegram = stubTelegram(7);
    mockGet(TENANCIES, [TENANCY_RECORD]);
    mockGet(CHARGES, []);
    const tenancyPatch = mockPatch(TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng', 'End Date': today });
    const roomPatch = mockPatch(ROOMS, 'recR1', { Code: '6B-R6', Status: 'Vacant' });

    await telegramUpdate(messageUpdate(1, '/moveout'));
    await telegramUpdate(callbackUpdate(2, 'mo:t:recT1'));
    await telegramUpdate(callbackUpdate(3, 'mo:d:today'));
    await telegramUpdate(callbackUpdate(4, 'mo:confirm'));

    expect(tenancyPatch.body).toEqual({ fields: { 'End Date': today } });
    expect(roomPatch.body).toEqual({ fields: { Status: 'Vacant' } });
    expect(await readSession()).toBeNull();

    const last = lastReply(telegram);
    expect(buttonData([last])).toContain('mi:r:recR1');
    expect(String(last.text)).toContain('Vacant');
    expect(String(last.text)).toContain(`https://airtable.com/appTEST/${TENANCIES}/recT1`);
    expect(String(last.text)).toContain(`https://airtable.com/appTEST/${ROOMS}/recR1`);
    expect(JSON.stringify(last.reply_markup)).toContain('Start new tenant in 6B-R6');
  });

  it('future end date leaves the room alone', async () => {
    const future = addDaysISO(melbourneDateISO(), 30);
    const telegram = stubTelegram(8);
    mockGet(TENANCIES, [TENANCY_RECORD]);
    mockGet(CHARGES, []);
    const tenancyPatch = mockPatch(TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng', 'End Date': future });

    await telegramUpdate(messageUpdate(10, '/moveout'));
    await telegramUpdate(callbackUpdate(11, 'mo:t:recT1'));
    await telegramUpdate(callbackUpdate(12, 'mo:d:manual'));
    await telegramUpdate(messageUpdate(13, future));
    await telegramUpdate(callbackUpdate(14, 'mo:confirm'));

    expect(tenancyPatch.body).toEqual({ fields: { 'End Date': future } });
    const last = String(lastReply(telegram).text);
    expect(last).toContain('Move-out saved');
    expect(last).toContain('Occupied');
    expect(last).not.toContain('not updated');
    expect(await readSession()).toBeNull();
  });

  it('confirm screen lists charges due after the end date', async () => {
    const today = melbourneDateISO();
    const later = addDaysISO(today, 10);
    const telegram = stubTelegram(5);
    mockGet(TENANCIES, [TENANCY_RECORD]);
    const chargesGet = mockGet(CHARGES, [
      {
        id: 'recC1',
        fields: { Label: '6B-R6 Sun Peng Old Rent', Balance: 200, Status: 'Overdue', 'Due Date': addDaysISO(today, -20), Tenancy: ['recT1'] },
      },
      {
        id: 'recC2',
        fields: { Label: '6B-R6 Sun Peng Next Rent', Balance: 1650, Status: 'Due', 'Due Date': later, Tenancy: ['recT1'] },
      },
      {
        id: 'recC9',
        fields: { Label: '7A Someone Else Rent', Balance: 900, Status: 'Due', 'Due Date': later, Tenancy: ['recT9'] },
      },
    ]);

    await telegramUpdate(messageUpdate(20, '/moveout'));
    await telegramUpdate(callbackUpdate(21, 'mo:t:recT1'));
    await telegramUpdate(callbackUpdate(22, 'mo:d:today'));

    expect(formulaOf(chargesGet.path)).toBe(`OR(NOT({Status} = "Paid"), IS_AFTER({Due Date}, "${today}"))`);
    const confirm = lastReply(telegram);
    const text = String(confirm.text);
    expect(text).toContain('6B-R6 Sun Peng Next Rent');
    expect(text).toContain(`https://airtable.com/appTEST/${CHARGES}/recC2`);
    expect(text).not.toContain('Someone Else');
    expect(text).not.toContain('Old Rent');
    expect(text).toContain('$200.00');
    expect(buttonData([confirm])).toEqual(['mo:confirm', 'mo:cancel']);
    expect((await readSession()).step).toBe('mo_confirm');
  });

  it('end date before start date is rejected', async () => {
    const telegram = stubTelegram(6);
    mockGet(TENANCIES, [{ ...TENANCY_RECORD, fields: { ...TENANCY_RECORD.fields, 'Start Date': '2026-11-05' } }]);

    await telegramUpdate(messageUpdate(30, '/moveout'));
    await telegramUpdate(callbackUpdate(31, 'mo:t:recT1'));
    await telegramUpdate(callbackUpdate(32, 'mo:d:manual'));
    await telegramUpdate(messageUpdate(33, '2026-11-01'));

    expect(String(lastReply(telegram).text)).toContain("can't be before the start date, 2026-11-05");
    expect((await readSession()).step).toBe('mo_enter_date');
  });

  it('stale confirm writes nothing', async () => {
    const telegram = stubTelegram(4);
    const paySession = { flow: 'pay', step: 'enter_amount', tenancyId: 'recT1' };
    await seedSession(paySession);

    await telegramUpdate(callbackUpdate(40, 'mo:confirm'));

    expect(String(lastReply(telegram).text)).toContain('expired');
    expect(await readSession()).toEqual(paySession);

    await testEnv.SESSION_KV.delete(SESSION_KEY);
    await telegramUpdate(callbackUpdate(41, 'mo:confirm'));

    expect(texts(telegram)).toHaveLength(2);
    expect(String(lastReply(telegram).text)).toContain('expired');
    expect(await readSession()).toBeNull();
  });

  it('second confirm writes nothing and says to check Airtable', async () => {
    const telegram = stubTelegram(2);
    const saving = { ...CONFIRM_SESSION, step: 'saving', endDate: melbourneDateISO() };
    await seedSession(saving);

    await telegramUpdate(callbackUpdate(50, 'mo:confirm'));

    const reply = lastReply(telegram);
    expect(String(reply.text)).toBe(
      '⏳ This move-out is already being saved, or the save has finished. Check Airtable before you try again.',
    );
    expect(reply.parse_mode).toBeUndefined();
    expect(await readSession()).toEqual(saving);
  });

  it('cancel during a save says the save may have finished', async () => {
    const telegram = stubTelegram(2);
    const saving = { ...CONFIRM_SESSION, step: 'saving', endDate: melbourneDateISO() };
    await seedSession(saving);

    await telegramUpdate(callbackUpdate(51, 'mo:cancel'));

    expect(String(lastReply(telegram).text)).toContain('already being saved');
    expect(await readSession()).toEqual(saving);
  });

  it('lists tenancies by label with balance and end-date tags', async () => {
    const telegram = stubTelegram(1);
    const tenanciesGet = mockGet(TENANCIES, [
      { id: 'recT2', fields: { Label: '7A Li Wei', Balance: 1650, 'End Date': '2026-12-31', Room: ['recR2'] } },
      { id: 'recT1', fields: { Label: '6B-R6 Sun Peng', Balance: 0, Room: ['recR1'] } },
    ]);

    await telegramUpdate(messageUpdate(60, '/moveout'));

    expect(formulaOf(tenanciesGet.path)).toBe('OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))');
    const rows = lastReply(telegram).reply_markup.inline_keyboard.flat();
    expect(rows.map((b: any) => b.callback_data)).toEqual(['mo:t:recT1', 'mo:t:recT2']);
    expect(rows[0].text).toBe('6B-R6 Sun Peng ✅');
    expect(rows[1].text).toBe('7A Li Wei 🔴 $1,650.00 · ends 2026-12-31');
    expect((await readSession()).flow).toBe('moveout');
  });

  it('reports a tenancy read failure without the Airtable body', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(1);
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(403, { error: 'secret-airtable-detail' });

    await telegramUpdate(messageUpdate(70, '/moveout'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('Failed to load tenancies');
    expect(text).not.toContain('secret-airtable-detail');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[payment-bot] moveout failed:'));
  });

  it('shows only the HTTP status when the tenancy PATCH fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, endDate: melbourneDateISO() });
    mockPatch(TENANCIES, 'recT1', {}, 422);

    await telegramUpdate(callbackUpdate(80, 'mo:confirm'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('Move-out not saved: HTTP 422. Nothing was changed.');
    expect(text).not.toContain('secret-airtable-detail');
    expect(error).toHaveBeenCalled();
    expect(await readSession()).toBeNull();
  });

  it('says the move-out may have saved when the tenancy PATCH gets a 5xx', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, endDate: melbourneDateISO() });
    mockPatch(TENANCIES, 'recT1', {}, 503, 3);

    await telegramUpdate(callbackUpdate(82, 'mo:confirm'));

    const reply = lastReply(telegram);
    const text = String(reply.text);
    expect(text).toContain('may have saved: HTTP 503');
    expect(text).not.toContain('Nothing was changed');
    expect(text).toContain(`https://airtable.com/appTEST/${TENANCIES}/recT1`);
    expect(text).toContain(`https://airtable.com/appTEST/${ROOMS}/recR1`);
    expect(text).not.toContain('secret-airtable-detail');
    expect(reply.parse_mode).toBe('Markdown');
    expect(await readSession()).toBeNull();
  });

  it('says the move-out may have saved when the PATCH response is unreadable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, endDate: melbourneDateISO() });
    mockPatch(TENANCIES, 'recT1', { 'End Date': melbourneDateISO() });

    await telegramUpdate(callbackUpdate(83, 'mo:confirm'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('may have saved: request failed');
    expect(text).not.toContain('Nothing was changed');
    expect(text).toContain(`https://airtable.com/appTEST/${TENANCIES}/recT1`);
    expect(await readSession()).toBeNull();
  });

  it('names the room step when only the room PATCH fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const today = melbourneDateISO();
    const telegram = stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, endDate: today });
    mockPatch(TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng', 'End Date': today });
    mockPatch(ROOMS, 'recR1', {}, 422);

    await telegramUpdate(callbackUpdate(81, 'mo:confirm'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('End date saved');
    expect(text).toContain('HTTP 422');
    expect(text).toContain('Vacant');
    expect(text).not.toContain('secret-airtable-detail');
    expect(await readSession()).toBeNull();
  });

  it('end of month picks the last day of the Melbourne month', async () => {
    const eom = endOfMonthISO(melbourneDateISO());
    stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, step: 'mo_select_date' });
    const chargesGet = mockGet(CHARGES, []);

    await telegramUpdate(callbackUpdate(90, 'mo:d:eom'));

    expect(formulaOf(chargesGet.path)).toContain(`"${eom}"`);
    expect(await readSession()).toEqual(expect.objectContaining({ step: 'mo_confirm', endDate: eom }));
  });

  it('escapes Airtable values on the confirm screen', async () => {
    const today = melbourneDateISO();
    const telegram = stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, step: 'mo_select_date', tenancyLabel: '6B A_B *VIP*', roomCode: '6B' });
    mockGet(CHARGES, [{
      id: 'recC2',
      fields: { Label: 'Rent_[Dec] `x`', Balance: 1, Status: 'Due', 'Due Date': addDaysISO(today, 5), Tenancy: ['recT1'] },
    }]);

    await telegramUpdate(callbackUpdate(91, 'mo:d:today'));

    const confirm = lastReply(telegram);
    expect(confirm.parse_mode).toBe('Markdown');
    expect(String(confirm.text)).toContain('6B A\\_B \\*VIP\\*');
    expect(String(confirm.text)).toContain('Rent\\_\\[Dec\\] \\`x\\`');
  });

  it('cancel clears a move-out session', async () => {
    const telegram = stubTelegram(2);
    await seedSession({ ...CONFIRM_SESSION, endDate: melbourneDateISO() });

    await telegramUpdate(callbackUpdate(95, 'mo:cancel'));

    expect(String(lastReply(telegram).text)).toContain('cancelled');
    expect(await readSession()).toBeNull();
  });
});
