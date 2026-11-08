import { describe, expect, it } from 'vitest';
import { worstCaseCallMs } from '../src/client';

describe('worstCaseCallMs', () => {
  it('a POST is sent once, so it costs one timeout', () => {
    expect(worstCaseCallMs('POST', { timeoutMs: 4000 })).toBe(4000);
  });

  it('a PATCH or GET costs every attempt plus the waits between them', () => {
    // Three attempts with the default two retries, and 200 ms then 800 ms between them.
    expect(worstCaseCallMs('PATCH', { timeoutMs: 4000 })).toBe(3 * 4000 + 200 + 800);
    expect(worstCaseCallMs('GET', { timeoutMs: 4000, retries: 0 })).toBe(4000);
  });

  it('uses the client defaults', () => {
    expect(worstCaseCallMs('POST')).toBe(10_000);
  });
});
