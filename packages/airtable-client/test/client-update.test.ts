import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient.update', () => {
  it('PATCHes the fields and returns the updated record parsed', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ id: 'recX', fields: { Name: 'Y' } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    const rec = await client.update('tbl1', T, 'recX', { Name: 'Y' });

    expect(rec).toEqual({ id: 'recX', fields: { Name: 'Y' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.airtable.com/v0/app1/tbl1/recX');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fields: { Name: 'Y' },
    });
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({ id: 'recX', fields: { Name: 'Y' } }));
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await client.update('tbl1', T, 'recX', { Name: 'Y' });
    expect(calls).toBe(2);
  });

  it('does NOT retry on 422', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('bad', { status: 422 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(
      client.update('tbl1', T, 'recX', { Name: 'Y' }),
    ).rejects.toThrow(/Airtable update \[tbl1\].*422/);
    expect(calls).toBe(1);
  });

  it('does NOT retry on 429', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('slow down', { status: 429 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(
      client.update('tbl1', T, 'recX', { Name: 'Y' }),
    ).rejects.toThrow(/429/);
    expect(calls).toBe(1);
  });
});
