import { SELF, fetchMock } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const AT_ORIGIN = 'https://api.airtable.com';
const DISCORD_ORIGIN = 'https://discord.test';
const TOKEN = 'a'.repeat(32);
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

describe('fetch handler', () => {
  it('GET / returns banner', async () => {
    const res = await SELF.fetch('https://worker.test/');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('charge-generator is running');
  });

  it('GET /run without bearer returns 401', async () => {
    const res = await SELF.fetch('https://worker.test/run');

    expect(res.status).toBe(401);
  });

  it('GET /run with wrong bearer returns 401', async () => {
    const res = await SELF.fetch('https://worker.test/run', {
      headers: { Authorization: 'Bearer wrong' },
    });

    expect(res.status).toBe(401);
  });

  it('GET /run with correct bearer triggers generateCharges', async () => {
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: /\/v0\/appTEST\/.*/ })
      .reply(200, { records: [] })
      .times(2);
    fetchMock
      .get(DISCORD_ORIGIN)
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(204);

    const res = await SELF.fetch('https://worker.test/run', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Done — check Discord');
  });

  it('concurrent GET /run requests create charges only once', async () => {
    fetchMock
      .get(AT_ORIGIN)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, { records: [{ id: 'rec1', fields: { Label: 'A', 'Monthly Rent': 1000 } }] });

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
        return {
          statusCode: 200,
          data: { id: `recCharge${postCount}`, fields: { Label: `Charge ${postCount}` } },
        };
      });

    fetchMock
      .get(DISCORD_ORIGIN)
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(204);

    const responses = await Promise.all([
      SELF.fetch('https://worker.test/run', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      SELF.fetch('https://worker.test/run', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 202]);
    expect(postCount).toBe(1);
  });
});
