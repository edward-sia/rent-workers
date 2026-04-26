import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient.create', () => {
  it('POSTs the fields and returns the created record parsed', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ id: 'recNEW', fields: { Name: 'X' } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    const rec = await client.create('tbl1', T, { Name: 'X' });

    expect(rec).toEqual({ id: 'recNEW', fields: { Name: 'X' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.airtable.com/v0/app1/tbl1');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fields: { Name: 'X' },
    });
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({
        id: 'recNEW', fields: { Name: 'X' },
      }));
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await client.create('tbl1', T, { Name: 'X' });
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
      client.create('tbl1', T, { Name: 'X' }),
    ).rejects.toThrow(/422/);
    expect(calls).toBe(1);
  });
});
