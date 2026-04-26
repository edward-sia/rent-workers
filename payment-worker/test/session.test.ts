import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getSession, setSession } from '../src/session';

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as KVNamespace;
}

describe('session', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = fakeKV();
  });

  it('returns idle for unknown user', async () => {
    await expect(getSession(1, kv)).resolves.toEqual({ step: 'idle' });
  });

  it('round-trips a session through put/get', async () => {
    await setSession(1, { step: 'enter_amount', tenancyId: 'rec1' }, kv);

    await expect(getSession(1, kv)).resolves.toEqual({
      step: 'enter_amount',
      tenancyId: 'rec1',
    });
  });

  it('clearSession deletes the entry', async () => {
    await setSession(1, { step: 'confirm' }, kv);
    await clearSession(1, kv);

    await expect(getSession(1, kv)).resolves.toEqual({ step: 'idle' });
  });

  it('setSession applies 1hr TTL', async () => {
    await setSession(1, { step: 'idle' }, kv);

    expect(kv.put).toHaveBeenCalledWith(
      'session:1',
      JSON.stringify({ step: 'idle' }),
      { expirationTtl: 3600 },
    );
  });
});
