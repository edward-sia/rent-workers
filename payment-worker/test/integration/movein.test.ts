import { fetchMock } from 'cloudflare:test';
import { addDaysISO, addMonths, partMonthAmount, periodOf } from '@rent/tenancy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { melbourneDateISO } from '../../src/format';
import {
  AIRTABLE_ORIGIN,
  CHARGES,
  ROOMS,
  TENANCIES,
  TENANTS,
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
  bodies: any[];
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
  vi.useRealTimers();
});

const ROOM_6B = { id: 'recR1', fields: { Code: '6B-R6', 'Default Rent': 1500, Status: 'Vacant' } };

/** The 1st of the month three months ahead: the plan then holds exactly one charge. */
function futureFirst(): string {
  return `${addMonths(periodOf(melbourneDateISO()), 3)}-01`;
}

function mockGet(table: string, records: object[]): Captured {
  const captured: Captured = { bodies: [], path: '', calls: 0 };
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

function mockWrite(
  method: 'POST' | 'PATCH',
  table: string,
  recordId: string,
  fields: object,
  statusCode = 200,
  times = 1,
): Captured {
  const captured: Captured = { bodies: [], path: '', calls: 0 };
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: method === 'POST' ? `/v0/appTEST/${table}` : `/v0/appTEST/${table}/${recordId}`, method })
    .reply((opts: MockReplyOptions) => {
      captured.bodies.push(parseBody(opts.body));
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

const BASE_SESSION = {
  flow: 'movein',
  roomId: 'recR1',
  roomCode: '6B-R6',
  roomOccupied: false,
  defaultRent: 1500,
};

function confirmSession(startDate: string): object {
  return {
    ...BASE_SESSION,
    step: 'mi_confirm',
    tenantName: 'Sun Peng',
    monthlyRent: 1500,
    startDate,
    firstOption: 'regular',
    firstAmount: 1500,
  };
}

describe('/movein', () => {
  it('full move-in with a new tenant', async () => {
    const start = futureFirst();
    const telegram = stubTelegram(15);
    const roomsGet = mockGet(ROOMS, [
      { id: 'recR2', fields: { Code: '1A', 'Default Rent': 1200, Status: 'Occupied' } },
      ROOM_6B,
      { id: 'recR3', fields: { Code: '2C', Status: 'Vacant' } },
    ]);
    const nameGet = mockGet(TENANTS, []);
    const tenantPost = mockWrite('POST', TENANTS, 'recN1', { Name: 'Sun_Peng*' });
    const tenancyPost = mockWrite('POST', TENANCIES, 'recT1', { Label: '6B-R6 Sun_Peng*' });
    const chargePost = mockWrite('POST', CHARGES, 'recC1', { Label: `6B-R6 Sun_Peng* ${periodOf(start)} Rent` });
    const roomPatch = mockWrite('PATCH', ROOMS, 'recR1', { Code: '6B-R6', Status: 'Occupied' });

    await telegramUpdate(messageUpdate(1, '/movein'));
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:r:recR3', 'mi:r:recR1', 'mi:r:recR2']);
    expect(new URL(roomsGet.path, AIRTABLE_ORIGIN).searchParams.getAll('fields[]'))
      .toEqual(['Code', 'Default Rent', 'Status']);

    await telegramUpdate(callbackUpdate(2, 'mi:r:recR1'));
    await telegramUpdate(messageUpdate(3, 'Sun_Peng*'));
    expect(formulaOf(nameGet.path)).toBe('{Name} = "Sun_Peng*"');
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:notes:skip']);

    await telegramUpdate(callbackUpdate(4, 'mi:notes:skip'));
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:rent:default']);

    await telegramUpdate(callbackUpdate(5, 'mi:rent:default'));
    await telegramUpdate(callbackUpdate(6, 'mi:s:manual'));
    await telegramUpdate(messageUpdate(7, start));
    // The part-month option is hidden for a start on the 1st.
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:f:regular']);

    await telegramUpdate(callbackUpdate(8, 'mi:f:regular'));
    const confirm = String(lastReply(telegram).text);
    expect(confirm).toContain(`${periodOf(start)} · ${start} · $1,500.00`);
    expect(confirm).not.toContain('currently Occupied');
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:confirm', 'mi:cancel']);

    await telegramUpdate(callbackUpdate(9, 'mi:confirm'));

    expect(tenantPost.bodies).toEqual([{ fields: { Name: 'Sun_Peng*' } }]);
    expect(tenancyPost.bodies).toEqual([{
      fields: {
        Label: '6B-R6 Sun_Peng*',
        Room: ['recR1'],
        Tenant: ['recN1'],
        'Start Date': start,
        'Due Day': 1,
        'Monthly Rent': 1500,
        Frequency: 'Monthly',
      },
    }]);
    expect(chargePost.bodies).toEqual([{
      fields: {
        Label: `6B-R6 Sun_Peng* ${periodOf(start)} Rent`,
        Tenancy: ['recT1'],
        Type: 'Rent',
        Period: periodOf(start),
        'Due Date': start,
        Amount: 1500,
      },
    }]);
    expect(roomPatch.bodies).toEqual([{ fields: { Status: 'Occupied' } }]);
    expect(await readSession()).toBeNull();

    const done = String(lastReply(telegram).text);
    expect(done).toContain('Move-in saved');
    expect(done).toContain(`https://airtable.com/appTEST/${TENANTS}/recN1`);
    expect(done).toContain(`https://airtable.com/appTEST/${TENANCIES}/recT1`);
    expect(done).toContain(`https://airtable.com/appTEST/${CHARGES}/recC1`);
    expect(done).toContain(`https://airtable.com/appTEST/${ROOMS}/recR1`);

    const markdown = telegram.filter((payload) => payload.parse_mode === 'Markdown').map((p) => String(p.text));
    const withName = markdown.filter((text) => text.includes('Sun\\_Peng\\*'));
    // Notes prompt, confirm screen and the saved reply.
    expect(withName).toHaveLength(3);
    for (const text of markdown) expect(text).not.toContain('Sun_Peng*');
    for (const text of texts(telegram)) expect(text.includes('Sun_Peng*')).toBe(false);
  });

  it('reuses an existing tenant', async () => {
    const start = futureFirst();
    const telegram = stubTelegram(12);
    await seedSession({ ...BASE_SESSION, step: 'mi_enter_name' });
    mockGet(TENANTS, [{ id: 'recN9', fields: { Name: 'Sun Peng' } }]);
    const tenancyPost = mockWrite('POST', TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng' });
    mockWrite('POST', CHARGES, 'recC1', { Label: `6B-R6 Sun Peng ${periodOf(start)} Rent` });
    mockWrite('PATCH', ROOMS, 'recR1', { Code: '6B-R6', Status: 'Occupied' });

    await telegramUpdate(messageUpdate(10, 'Sun Peng'));
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:tenant:existing', 'mi:tenant:new']);
    expect(String(lastReply(telegram).text)).toContain(`https://airtable.com/appTEST/${TENANTS}/recN9`);

    await telegramUpdate(callbackUpdate(11, 'mi:tenant:existing'));
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:rent:default']);

    await telegramUpdate(callbackUpdate(12, 'mi:rent:default'));
    await telegramUpdate(callbackUpdate(13, 'mi:s:manual'));
    await telegramUpdate(messageUpdate(14, start));
    await telegramUpdate(callbackUpdate(15, 'mi:f:regular'));
    expect(String(lastReply(telegram).text)).toContain('existing');
    await telegramUpdate(callbackUpdate(16, 'mi:confirm'));

    expect(tenancyPost.bodies[0].fields.Tenant).toEqual(['recN9']);
    expect(String(lastReply(telegram).text)).toContain('Move-in saved');
    expect(buttonData(telegram)).not.toContain('mi:notes:skip');
    expect(texts(telegram).some((text) => /notes/i.test(text))).toBe(false);
    expect(await readSession()).toBeNull();
  });

  it('create new after a name match asks for notes', async () => {
    const telegram = stubTelegram(2);
    await seedSession({ ...BASE_SESSION, step: 'mi_choose_tenant', tenantName: 'Sun Peng', tenantId: 'recN9' });

    await telegramUpdate(callbackUpdate(17, 'mi:tenant:new'));

    expect(buttonData([lastReply(telegram)])).toEqual(['mi:notes:skip']);
    const session = await readSession();
    expect(session.step).toBe('mi_enter_notes');
    expect(session.tenantId).toBeUndefined();
  });

  it('typed notes are saved on the new tenant', async () => {
    const telegram = stubTelegram(3);
    await seedSession({ ...BASE_SESSION, step: 'mi_enter_notes', tenantName: 'Sun Peng' });

    await telegramUpdate(messageUpdate(18, 'Pays by WeChat_Pay'));

    expect((await readSession()).tenantNotes).toBe('Pays by WeChat_Pay');
    expect((await readSession()).step).toBe('mi_enter_rent');
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:rent:default']);

    const start = futureFirst();
    await seedSession({ ...confirmSession(start), tenantNotes: 'Pays by WeChat_Pay' });
    const tenantPost = mockWrite('POST', TENANTS, 'recN1', { Name: 'Sun Peng' });
    mockWrite('POST', TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng' });
    mockWrite('POST', CHARGES, 'recC1', { Label: 'x' });
    mockWrite('PATCH', ROOMS, 'recR1', { Code: '6B-R6', Status: 'Occupied' });

    await telegramUpdate(callbackUpdate(19, 'mi:confirm'));

    expect(tenantPost.bodies).toEqual([{ fields: { Name: 'Sun Peng', Notes: 'Pays by WeChat_Pay' } }]);
  });

  it('handover button starts with the room set', async () => {
    const telegram = stubTelegram(2);
    const roomGet = mockGet(ROOMS, [ROOM_6B]);

    await telegramUpdate(callbackUpdate(20, 'mi:r:recR1'));

    expect(roomGet.calls).toBe(1);
    expect(formulaOf(roomGet.path)).toBe('RECORD_ID() = "recR1"');
    expect(String(lastReply(telegram).text)).toContain("tenant's name");
    expect(await readSession()).toEqual({
      ...BASE_SESSION,
      step: 'mi_enter_name',
    });
  });

  it('handover button for a missing room says so', async () => {
    const telegram = stubTelegram(2);
    mockGet(ROOMS, []);

    await telegramUpdate(callbackUpdate(21, 'mi:r:recGONE'));

    expect(String(lastReply(telegram).text)).toContain('Room not found');
    expect(await readSession()).toBeNull();
  });

  it('rent text goes to move-in, not /pay', async () => {
    const telegram = stubTelegram(1);
    await seedSession({ ...BASE_SESSION, step: 'mi_enter_rent', tenantName: 'Sun Peng' });

    await telegramUpdate(messageUpdate(30, '1650'));

    const session = await readSession();
    expect(session.monthlyRent).toBe(1650);
    expect(session.step).toBe('mi_select_start');
    expect(buttonData(telegram).some((data) => data.startsWith('method:'))).toBe(false);
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:s:today', 'mi:s:next1', 'mi:s:manual']);
  });

  it('bad rent is rejected and nothing is written', async () => {
    const telegram = stubTelegram(1);
    await seedSession({ ...BASE_SESSION, step: 'mi_enter_rent', tenantName: 'Sun Peng' });

    await telegramUpdate(messageUpdate(31, 'lots'));

    expect(String(lastReply(telegram).text)).toContain('Invalid amount');
    expect((await readSession()).step).toBe('mi_enter_rent');
  });

  it('1st of next month and today buttons set the start date', async () => {
    const today = melbourneDateISO();
    const next1 = `${addMonths(periodOf(today), 1)}-01`;
    const telegram = stubTelegram(4);
    const selectStart = { ...BASE_SESSION, step: 'mi_select_start', tenantName: 'Sun Peng', monthlyRent: 1500 };
    await seedSession(selectStart);

    await telegramUpdate(callbackUpdate(32, 'mi:s:next1'));
    expect((await readSession()).startDate).toBe(next1);
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:f:regular']);

    await seedSession(selectStart);
    await telegramUpdate(callbackUpdate(33, 'mi:s:today'));
    expect((await readSession()).startDate).toBe(today);
    expect((await readSession()).step).toBe('mi_select_first');
  });

  it('part month with the suggested amount', async () => {
    const start = `${addMonths(periodOf(melbourneDateISO()), 3)}-20`;
    const suggested = partMonthAmount(1500, start);
    const telegram = stubTelegram(6);
    await seedSession({ ...BASE_SESSION, step: 'mi_select_first', tenantName: 'Sun Peng', monthlyRent: 1500, startDate: start });
    mockWrite('POST', TENANTS, 'recN1', { Name: 'Sun Peng' });
    const tenancyPost = mockWrite('POST', TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng' });
    const chargePost = mockWrite('POST', CHARGES, 'recC1', { Label: 'x' });
    mockWrite('PATCH', ROOMS, 'recR1', { Code: '6B-R6', Status: 'Occupied' });

    await telegramUpdate(callbackUpdate(40, 'mi:f:part'));
    expect(buttonData([lastReply(telegram)])).toEqual(['mi:amt:suggested']);

    await telegramUpdate(callbackUpdate(41, 'mi:amt:suggested'));
    await telegramUpdate(callbackUpdate(42, 'mi:confirm'));

    expect(tenancyPost.bodies[0].fields['Due Day']).toBe(1);
    expect(chargePost.bodies).toEqual([{
      fields: {
        Label: `6B-R6 Sun Peng ${periodOf(start)} Rent`,
        Tenancy: ['recT1'],
        Type: 'Rent',
        Period: periodOf(start),
        'Due Date': start,
        Amount: suggested,
      },
    }]);
  });

  it('part month with a typed amount', async () => {
    const start = `${addMonths(periodOf(melbourneDateISO()), 3)}-20`;
    const telegram = stubTelegram(1);
    await seedSession({
      ...BASE_SESSION, step: 'mi_enter_first_amount', tenantName: 'Sun Peng', monthlyRent: 1500,
      startDate: start, firstOption: 'part_month',
    });

    await telegramUpdate(messageUpdate(43, '600'));

    const session = await readSession();
    expect(session.step).toBe('mi_confirm');
    expect(session.firstAmount).toBe(600);
    expect(String(lastReply(telegram).text)).toContain(`${periodOf(start)} · ${start} · $600.00`);
  });

  it('a start this month confirmed on or after the 15th UTC saves this month and next month', async () => {
    // The 20th in both UTC and Melbourne: the generator has already made next month's charges.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T01:00:00Z'));
    const telegram = stubTelegram(4);
    await seedSession({
      ...BASE_SESSION, step: 'mi_select_first', tenantName: 'Sun Peng', monthlyRent: 1500, startDate: '2026-11-18',
    });
    mockWrite('POST', TENANTS, 'recN1', { Name: 'Sun Peng' });
    mockWrite('POST', TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng' });
    const chargeBodies: any[] = [];
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply((opts: MockReplyOptions) => {
        chargeBodies.push(parseBody(opts.body));
        return { statusCode: 200, data: { id: `recC${chargeBodies.length}`, fields: { Label: 'x' } } };
      })
      .times(2);
    mockWrite('PATCH', ROOMS, 'recR1', { Code: '6B-R6', Status: 'Occupied' });

    await telegramUpdate(callbackUpdate(45, 'mi:f:regular'));
    const confirm = String(lastReply(telegram).text);
    expect(confirm).toContain('2026-11 · 2026-11-18 · $1,500.00');
    expect(confirm).toContain('2026-12 · 2026-12-18 · $1,500.00');

    await telegramUpdate(callbackUpdate(46, 'mi:confirm'));

    expect(chargeBodies.map((body) => body.fields)).toEqual([
      {
        Label: '6B-R6 Sun Peng 2026-11 Rent', Tenancy: ['recT1'], Type: 'Rent',
        Period: '2026-11', 'Due Date': '2026-11-18', Amount: 1500,
      },
      {
        Label: '6B-R6 Sun Peng 2026-12 Rent', Tenancy: ['recT1'], Type: 'Rent',
        Period: '2026-12', 'Due Date': '2026-12-18', Amount: 1500,
      },
    ]);
    const done = String(lastReply(telegram).text);
    expect(done).toContain('Move-in saved');
    expect(done).toContain('2026-11 rent charge, $1,500.00 due 2026-11-18');
    expect(done).toContain('2026-12 rent charge, $1,500.00 due 2026-12-18');
    expect(done).toContain(`https://airtable.com/appTEST/${CHARGES}/recC1`);
    expect(done).toContain(`https://airtable.com/appTEST/${CHARGES}/recC2`);
    expect(await readSession()).toBeNull();
  });

  it('429 after the tenant is created', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(2);
    await seedSession(confirmSession(futureFirst()));
    const tenantPost = mockWrite('POST', TENANTS, 'recN1', { Name: 'Sun Peng' });
    const tenancyPost = mockWrite('POST', TENANCIES, 'recT1', {}, 429);

    await telegramUpdate(callbackUpdate(50, 'mi:confirm'));

    expect(tenantPost.calls).toBe(1);
    expect(tenancyPost.calls).toBe(1);
    const reply = lastReply(telegram);
    const text = String(reply.text);
    expect(reply.parse_mode).toBe('Markdown');
    expect(text).toContain('HTTP 429');
    expect(text).toContain(`https://airtable.com/appTEST/${TENANTS}/recN1`);
    expect(text).not.toContain('secret-airtable-detail');
    expect(text).not.toContain('Move-in saved');
    // The remaining steps are named so they can be finished by hand.
    expect(text).toContain('Still to do in Airtable');
    expect(text).toContain('rent charge');
    expect(text).toContain('Occupied');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[payment-bot] movein failed:'));
    expect(await readSession()).toBeNull();
  });

  it('says a step may have saved when the room PATCH gets a 5xx', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(2);
    await seedSession(confirmSession(futureFirst()));
    mockWrite('POST', TENANTS, 'recN1', { Name: 'Sun Peng' });
    mockWrite('POST', TENANCIES, 'recT1', { Label: '6B-R6 Sun Peng' });
    mockWrite('POST', CHARGES, 'recC1', { Label: 'x' });
    mockWrite('PATCH', ROOMS, 'recR1', {}, 503, 3);

    await telegramUpdate(callbackUpdate(51, 'mi:confirm'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('may have saved');
    expect(text).toContain('HTTP 503');
    expect(text).toContain(`https://airtable.com/appTEST/${TENANCIES}/recT1`);
    expect(text).toContain(`https://airtable.com/appTEST/${CHARGES}/recC1`);
    expect(text).toContain(`https://airtable.com/appTEST/${ROOMS}/recR1`);
    expect(text).not.toContain('secret-airtable-detail');
    expect(await readSession()).toBeNull();
  });

  it('a 4xx on the first write says nothing was changed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(2);
    await seedSession(confirmSession(futureFirst()));
    mockWrite('POST', TENANTS, 'recN1', {}, 422);

    await telegramUpdate(callbackUpdate(52, 'mi:confirm'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('HTTP 422');
    expect(text).toContain('Nothing was changed');
    expect(await readSession()).toBeNull();
  });

  it('occupied room warning', async () => {
    const telegram = stubTelegram(2);
    await seedSession({
      ...BASE_SESSION, roomOccupied: true, step: 'mi_select_first', tenantName: 'Sun Peng',
      monthlyRent: 1500, startDate: futureFirst(),
    });

    await telegramUpdate(callbackUpdate(60, 'mi:f:regular'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('⚠️ 6B-R6 is currently Occupied');
    expect((await readSession()).step).toBe('mi_confirm');
  });

  it('start date too far in the past is rejected', async () => {
    const telegram = stubTelegram(1);
    await seedSession({ ...BASE_SESSION, step: 'mi_enter_start', tenantName: 'Sun Peng', monthlyRent: 1500 });

    await telegramUpdate(messageUpdate(70, addDaysISO(melbourneDateISO(), -61)));

    expect(String(lastReply(telegram).text)).toContain('❌');
    expect(String(lastReply(telegram).text)).toContain('60 days');
    expect((await readSession()).step).toBe('mi_enter_start');
  });

  it('/cancel mid-flow writes nothing', async () => {
    const telegram = stubTelegram(1);
    await seedSession(confirmSession(futureFirst()));

    await telegramUpdate(messageUpdate(80, '/cancel'));

    expect(String(lastReply(telegram).text)).toContain('Cancelled');
    expect(await readSession()).toBeNull();
  });

  it('cancel button clears a move-in session', async () => {
    const telegram = stubTelegram(2);
    await seedSession(confirmSession(futureFirst()));

    await telegramUpdate(callbackUpdate(81, 'mi:cancel'));

    expect(String(lastReply(telegram).text)).toContain('Move-in cancelled');
    expect(await readSession()).toBeNull();
  });

  it('second confirm writes nothing and says to check Airtable', async () => {
    const telegram = stubTelegram(2);
    const saving = { ...confirmSession(futureFirst()), step: 'saving' };
    await seedSession(saving);

    await telegramUpdate(callbackUpdate(90, 'mi:confirm'));

    const reply = lastReply(telegram);
    expect(String(reply.text)).toBe(
      '⏳ This move-in is already being saved, or the save has finished. Check Airtable before you try again.',
    );
    expect(reply.parse_mode).toBeUndefined();
    expect(await readSession()).toEqual(saving);
  });

  it('cancel during a save says the save may have finished', async () => {
    const telegram = stubTelegram(2);
    const saving = { ...confirmSession(futureFirst()), step: 'saving' };
    await seedSession(saving);

    await telegramUpdate(callbackUpdate(92, 'mi:cancel'));

    expect(String(lastReply(telegram).text)).toContain('already being saved');
    expect(await readSession()).toEqual(saving);
  });

  it('stale confirm during /pay writes nothing', async () => {
    const telegram = stubTelegram(2);
    const paySession = { flow: 'pay', step: 'enter_amount', tenancyId: 'recT1' };
    await seedSession(paySession);

    await telegramUpdate(callbackUpdate(91, 'mi:confirm'));

    expect(String(lastReply(telegram).text)).toContain('expired');
    expect(await readSession()).toEqual(paySession);
  });

  it('reports a rooms read failure without the Airtable body', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(1);
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${ROOMS}\\?.*`) })
      .reply(403, { error: 'secret-airtable-detail' });

    await telegramUpdate(messageUpdate(95, '/movein'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('Failed to load rooms');
    expect(text).not.toContain('secret-airtable-detail');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[payment-bot] movein failed:'));
  });

  it('reports a name lookup failure and ends the flow', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const telegram = stubTelegram(1);
    await seedSession({ ...BASE_SESSION, step: 'mi_enter_name' });
    fetchMock
      .get(AIRTABLE_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANTS}\\?.*`) })
      .reply(403, { error: 'secret-airtable-detail' });

    await telegramUpdate(messageUpdate(96, 'Sun Peng'));

    const text = String(lastReply(telegram).text);
    expect(text).toContain('Failed to look up tenants');
    expect(text).not.toContain('secret-airtable-detail');
    expect(await readSession()).toBeNull();
  });
});
