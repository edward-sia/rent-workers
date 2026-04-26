import { describe, expect, it } from 'vitest';
import { requireBearer } from '../src/auth';

describe('requireBearer', () => {
  const secret = 'a'.repeat(32);

  it('returns null when header matches', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: `Bearer ${secret}` },
    });

    expect(requireBearer(req, secret)).toBeNull();
  });

  it('returns 401 when header missing', () => {
    const req = new Request('https://x/run');
    const res = requireBearer(req, secret);

    expect(res?.status).toBe(401);
  });

  it('returns 401 when scheme is wrong', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: `Basic ${secret}` },
    });

    expect(requireBearer(req, secret)?.status).toBe(401);
  });

  it('returns 401 when token does not match', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: `Bearer ${'b'.repeat(32)}` },
    });

    expect(requireBearer(req, secret)?.status).toBe(401);
  });

  it('returns 401 when expected secret is empty', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(requireBearer(req, '')?.status).toBe(401);
  });
});
