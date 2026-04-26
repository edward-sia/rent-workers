import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient — timeout', () => {
  it('passes an AbortSignal to fetch', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify({ records: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    await client.fetchAll('tbl1', T);

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).signal).toBeDefined();
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts when the timeout fires', async () => {
    vi.useFakeTimers();
    let abortReason: unknown;
    vi.stubGlobal('fetch', vi.fn<(input: string, init?: RequestInit) => Promise<Response>>((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = (init as RequestInit).signal as AbortSignal;
        sig.addEventListener('abort', () => {
          abortReason = sig.reason;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }));

    const client = new AirtableClient(env, { timeoutMs: 1000, retries: 0 });
    const promise = client.fetchAll('tbl1', T);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(promise).rejects.toThrow();
    expect(abortReason).toBeDefined();
    vi.useRealTimers();
  });
});
