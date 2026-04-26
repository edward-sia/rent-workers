import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient — retry', () => {
  it('retries on 503 and succeeds on attempt 2', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({
        records: [{ id: 'r1', fields: { Name: 'X' } }],
      }), { status: 200 });
    }));

    const client = new AirtableClient(env, { retries: 2, timeoutMs: 1000 });
    const out = await client.fetchAll('tbl1', T);
    expect(out).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('does NOT retry on 422', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('bad request', { status: 422 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(client.fetchAll('tbl1', T)).rejects.toThrow(/422/);
    expect(calls).toBe(1);
  });

  it('gives up after retries exhausted', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('busy', { status: 503 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(client.fetchAll('tbl1', T)).rejects.toThrow(/503/);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('retries on network error', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError('network down');
      return new Response(JSON.stringify({ records: [] }));
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await client.fetchAll('tbl1', T);
    expect(calls).toBe(2);
  });
});
