import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers';

function lockFor(userId: number) {
  return testEnv.CONFIRM_LOCK.get(testEnv.CONFIRM_LOCK.idFromName(String(userId)));
}

describe('ConfirmLock', () => {
  it('lets the first claim of an operation through and refuses the rest', async () => {
    const lock = lockFor(1234);
    expect(await lock.claim('aaaaaaaaaaaa')).toBe(true);
    expect(await lock.claim('aaaaaaaaaaaa')).toBe(false);
    expect(await lock.claim('bbbbbbbbbbbb')).toBe(true);
  });

  it('gives one claim to one of many claims made at once', async () => {
    const lock = lockFor(1234);
    const results = await Promise.all(Array.from({ length: 10 }, () => lock.claim('cccccccccccc')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('keeps each user separate', async () => {
    expect(await lockFor(1).claim('dddddddddddd')).toBe(true);
    expect(await lockFor(2).claim('dddddddddddd')).toBe(true);
  });
});
