import {
  createExecutionContext,
  createScheduledController,
  env,
  fetchMock,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import type { Env } from '../../src/index';

const AT_ORIGIN = 'https://api.airtable.com';
const DISCORD_ORIGIN = 'https://discord.test';
const TENANCIES = 'tblvVmo12VikITRH6';
const CHARGES = 'tblNCw6ZxspNxiKCu';

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
});

function tenancyRec(
  id: string,
  label: string,
  rent: number,
  dueDay?: number,
  dates: { start?: string; end?: string } = {},
) {
  const fields: Record<string, unknown> = { Label: label, 'Monthly Rent': rent };
  if (dueDay !== undefined) fields['Due Day'] = dueDay;
  if (dates.start !== undefined) fields['Start Date'] = dates.start;
  if (dates.end !== undefined) fields['End Date'] = dates.end;
  return { id, fields };
}

function chargeRec(id: string, label: string, tenancyIds: string[]) {
  return { id, fields: { Label: label, Tenancy: tenancyIds } };
}

function parseBody(body: unknown): any {
  if (typeof body === 'string') return JSON.parse(body);
  if (body instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(body));
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body));
  throw new Error(`Unexpected mock request body: ${String(body)}`);
}

async function runScheduled() {
  const ctx = createExecutionContext();
  await worker.scheduled(
    createScheduledController({
      scheduledTime: Date.UTC(2026, 3, 15),
    }),
    env as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

/** The Discord embed field whose name starts with `prefix`. */
function embedField(payload: any, prefix: string): { name: string; value: string } | undefined {
  return payload.embeds[0].fields.find((field: { name: string }) => field.name.startsWith(prefix));
}

function mockDiscord(statusCode = 204): any[] {
  const payloads: any[] = [];
  fetchMock
    .get(DISCORD_ORIGIN)
    .intercept({ path: '/webhook', method: 'POST' })
    .reply((opts) => {
      payloads.push(parseBody(opts.body));
      return statusCode === 204
        ? { statusCode }
        : { statusCode, data: 'bad gateway' };
    });
  return payloads;
}

describe('scheduled handler', () => {
  it('happy path: creates charges for all active tenancies and posts a green summary', async () => {
    let tenancyPath = '';
    fetchMock
      .get(AT_ORIGIN)
      .intercept({
        path: (path) => {
          tenancyPath = path;
          return path.startsWith(`/v0/appTEST/${TENANCIES}?`);
        },
      })
      .reply(200, {
        records: [
          tenancyRec('rec1', 'A', 1000, 5),
          tenancyRec('rec2', 'B', 1500, 10),
          tenancyRec('rec3', 'C', 2000, 28),
        ],
      });

    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });

    const createBodies: any[] = [];
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply((opts) => {
        createBodies.push(parseBody(opts.body));
        return {
          statusCode: 200,
          data: { id: `recCharge${createBodies.length}`, fields: { Label: `Charge ${createBodies.length}` } },
        };
      })
      .times(3);

    const discordPayloads = mockDiscord();

    await runScheduled();

    const tenancyUrl = new URL(`https://airtable.test${tenancyPath}`);
    expect(tenancyUrl.searchParams.get('filterByFormula')).toBe(
      'OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))',
    );
    expect(createBodies).toHaveLength(3);
    expect(createBodies.map(body => body.fields)).toEqual([
      expect.objectContaining({ Label: 'A 2026-05 Rent', Tenancy: ['rec1'], Amount: 1000, 'Due Date': '2026-05-05' }),
      expect.objectContaining({ Label: 'B 2026-05 Rent', Tenancy: ['rec2'], Amount: 1500, 'Due Date': '2026-05-10' }),
      expect.objectContaining({ Label: 'C 2026-05 Rent', Tenancy: ['rec3'], Amount: 2000, 'Due Date': '2026-05-28' }),
    ]);
    expect(discordPayloads[0].embeds[0].color).toBe(0x00c851);
    expect(discordPayloads[0].embeds[0].fields[0].name).toBe('✅ Created (3)');
  });

  describe('tenancy date window', () => {
    function mockReads(tenancy: ReturnType<typeof tenancyRec>) {
      fetchMock
        .get(AT_ORIGIN)
        .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
        .reply(200, { records: [tenancy] });
      fetchMock
        .get(AT_ORIGIN)
        .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
        .reply(200, { records: [] });
    }

    it('skips a tenancy whose due date is before Start Date', async () => {
      mockReads(tenancyRec('rec1', 'Alice', 1000, 5, { start: '2026-06-10' }));
      const discordPayloads = mockDiscord();

      await runScheduled();

      const outside = embedField(discordPayloads[0], '⏭ Skipped: outside tenancy dates');
      expect(outside?.name).toBe('⏭ Skipped: outside tenancy dates (1)');
      expect(outside?.value).toBe('tenancy rec1');
      expect(outside?.value).not.toContain('Alice');
      const existed = embedField(discordPayloads[0], '⏭ Already existed');
      expect(existed?.name).toBe('⏭ Already existed (0)');
      expect(existed?.value).not.toContain('rec1');
    });

    it('skips a tenancy whose due date is after End Date', async () => {
      mockReads(tenancyRec('rec1', 'Alice', 1000, 20, { end: '2026-05-15' }));
      const discordPayloads = mockDiscord();

      await runScheduled();

      expect(embedField(discordPayloads[0], '⏭ Skipped: outside tenancy dates')).toEqual(
        expect.objectContaining({ name: '⏭ Skipped: outside tenancy dates (1)', value: 'tenancy rec1' }),
      );
      expect(embedField(discordPayloads[0], '⏭ Already existed')?.value).not.toContain('rec1');
    });

    it('logs the outside count with the other counts', async () => {
      mockReads(tenancyRec('rec1', 'Alice', 1000, 20, { end: '2026-05-15' }));
      mockDiscord();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      };

      try {
        await runScheduled();
      } finally {
        console.log = originalLog;
      }

      expect(logs).toContain('[2026-05] created=0 skipped=0 outside=1 errors=0 discord=true');
    });

    it('creates the charge when the due date equals End Date', async () => {
      mockReads(tenancyRec('rec1', 'Alice', 1000, 15, { end: '2026-05-15' }));
      const createBodies: any[] = [];
      fetchMock
        .get(AT_ORIGIN)
        .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
        .reply((opts) => {
          createBodies.push(parseBody(opts.body));
          return { statusCode: 200, data: { id: 'recNew', fields: { Label: 'New' } } };
        });
      const discordPayloads = mockDiscord();

      await runScheduled();

      expect(createBodies).toHaveLength(1);
      expect(createBodies[0].fields['Due Date']).toBe('2026-05-15');
      expect(embedField(discordPayloads[0], '⏭ Skipped: outside tenancy dates')).toBeUndefined();
    });

    it('creates the charge when the due date equals Start Date', async () => {
      mockReads(tenancyRec('rec1', 'Alice', 1000, undefined, { start: '2026-05-10' }));
      const createBodies: any[] = [];
      fetchMock
        .get(AT_ORIGIN)
        .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
        .reply((opts) => {
          createBodies.push(parseBody(opts.body));
          return { statusCode: 200, data: { id: 'recNew', fields: { Label: 'New' } } };
        });
      mockDiscord();

      await runScheduled();

      expect(createBodies).toHaveLength(1);
      expect(createBodies[0].fields['Due Date']).toBe('2026-05-10');
    });
  });

  it('idempotency: skips tenancies already covered for the period', async () => {
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, {
        records: [
          tenancyRec('rec1', 'Alice', 1000, 5),
          tenancyRec('rec2', 'Bob', 1500, 10),
          tenancyRec('rec3', 'Carol', 2000, 15),
        ],
      });

    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, {
        records: [
          chargeRec('recExisting1', 'Existing 1', ['rec1']),
          chargeRec('recExisting2', 'Existing 2', ['rec2']),
        ],
      });

    let postCount = 0;
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        postCount++;
        return {
          statusCode: 200,
          data: { id: 'recNew', fields: { Label: 'New' } },
        };
      });

    const discordPayloads = mockDiscord();

    await runScheduled();

    expect(postCount).toBe(1);
    expect(discordPayloads[0].embeds[0].color).toBe(0x00c851);
    expect(discordPayloads[0].embeds[0].fields[1].name).toBe('⏭ Already existed (2)');
    expect(discordPayloads[0].embeds[0].fields[1].value).toContain('tenancy rec1');
    expect(discordPayloads[0].embeds[0].fields[1].value).toContain('tenancy rec2');
    expect(discordPayloads[0].embeds[0].fields[1].value).not.toContain('Alice');
    expect(discordPayloads[0].embeds[0].fields[1].value).not.toContain('Bob');
  });

  it('all-covered idempotency posts yellow and creates nothing', async () => {
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, {
        records: [
          tenancyRec('rec1', 'A', 1000, 5),
          tenancyRec('rec2', 'B', 1500, 10),
        ],
      });

    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, {
        records: [
          chargeRec('recExisting1', 'Existing 1', ['rec1']),
          chargeRec('recExisting2', 'Existing 2', ['rec2']),
        ],
      });

    const discordPayloads = mockDiscord();

    await runScheduled();

    expect(discordPayloads[0].embeds[0].color).toBe(0xffbb33);
    expect(discordPayloads[0].embeds[0].fields[0].name).toBe('✅ Created (0)');
    expect(discordPayloads[0].embeds[0].fields[1].name).toBe('⏭ Already existed (2)');
  });

  it('partial failure: records one create error, creates the rest, and posts red', async () => {
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, {
        records: [
          tenancyRec('rec1', 'Alice', 1000, 5),
          tenancyRec('rec2', 'Bob', 1500, 10),
          tenancyRec('rec3', 'Carol', 2000, 15),
        ],
      });

    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });

    let attempts = 0;
    const errorMessages: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errorMessages.push(args.map(String).join(' '));
    };
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        attempts++;
        return { statusCode: 422, data: { error: 'bad fields for tenant Alice amount 1000' } };
      });
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        attempts++;
        return {
          statusCode: 200,
          data: { id: 'recCharge2', fields: { Label: 'Charge 2' } },
        };
      });

    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        attempts++;
        return {
          statusCode: 200,
          data: { id: 'recCharge3', fields: { Label: 'Charge 3' } },
        };
      });

    const discordPayloads = mockDiscord();

    try {
      await runScheduled();
    } finally {
      console.error = originalError;
    }

    expect(attempts).toBe(3);
    expect(discordPayloads[0].embeds[0].color).toBe(0xff4444);
    expect(discordPayloads[0].embeds[0].fields[0].name).toBe('✅ Created (2)');
    expect(discordPayloads[0].embeds[0].fields[2].name).toBe('❌ Errors (1)');
    expect(discordPayloads[0].embeds[0].fields[2].value).toContain('tenancy rec1');
    expect(discordPayloads[0].embeds[0].fields[2].value).toContain('HTTP 422');
    expect(discordPayloads[0].embeds[0].fields[2].value).not.toContain('Alice');
    expect(discordPayloads[0].embeds[0].fields[2].value).not.toContain('bad fields');
    expect(discordPayloads[0].embeds[0].fields[2].value).not.toContain('1000');
    const logText = errorMessages.join('\n');
    expect(logText).toContain('tenancy=rec1');
    expect(logText).toContain('HTTP 422');
    expect(logText).not.toContain('Alice');
    expect(logText).not.toContain('bad fields');
    expect(logText).not.toContain('1000');
  });

  it('Discord webhook 502 does not throw after charges are created', async () => {
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, { records: [tenancyRec('rec1', 'A', 1000, 5)] });
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });
    let postCount = 0;
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        postCount++;
        return { statusCode: 200, data: { id: 'recCharge1', fields: { Label: 'Charge 1' } } };
      });
    mockDiscord(502);

    await expect(runScheduled()).resolves.not.toThrow();
    expect(postCount).toBe(1);
  });

  it('Airtable 503 on read retries and succeeds', async () => {
    let tenAttempts = 0;
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(() => {
        tenAttempts++;
        if (tenAttempts === 1) return { statusCode: 503, data: 'busy' };
        return { statusCode: 200, data: { records: [] } };
      })
      .times(2);

    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });
    mockDiscord();

    await runScheduled();

    expect(tenAttempts).toBe(2);
  });
});
