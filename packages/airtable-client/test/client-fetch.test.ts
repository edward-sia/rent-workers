import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const TableSchema = z.object({ Name: z.string() });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AirtableClient.fetchAll — happy path', () => {
  it('returns parsed records on a single page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ records: [{ id: 'rec1', fields: { Name: 'A' } }] }),
      { status: 200 },
    )));

    const client = new AirtableClient(env);
    const records = await client.fetchAll('tbl1', TableSchema);

    expect(records).toEqual([{ id: 'rec1', fields: { Name: 'A' } }]);
  });

  it('sends Authorization and Content-Type headers', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ records: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    await client.fetchAll('tbl1', TableSchema);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer t');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('encodes params as fields[]= bracket notation', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ records: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    await client.fetchAll('tbl1', TableSchema, {
      fields:          ['Name'],
      filterByFormula: 'TRUE()',
    });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('fields%5B%5D=Name');
    expect(url).toContain('filterByFormula=TRUE');
  });

  it('paginates using offset until exhausted', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({
          records: [{ id: 'rec1', fields: { Name: 'A' } }],
          offset:  'next-token',
        }));
      }
      return new Response(JSON.stringify({
        records: [{ id: 'rec2', fields: { Name: 'B' } }],
      }));
    }));

    const client = new AirtableClient(env);
    const records = await client.fetchAll('tbl1', TableSchema);

    expect(records.map(r => r.id)).toEqual(['rec1', 'rec2']);
    expect(calls).toBe(2);
  });
});

describe('AirtableClient.fetchAll — schema validation', () => {
  it('throws an error mentioning the field path on parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ records: [{ id: 'rec1', fields: { Name: 42 } }] }),
      { status: 200 },
    )));

    const client = new AirtableClient(env);
    await expect(
      client.fetchAll('tbl1', TableSchema),
    ).rejects.toThrow(/Name/);
  });
});
