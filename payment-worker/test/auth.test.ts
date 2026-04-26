import { describe, expect, it } from 'vitest';
import { requireWebhookSecret } from '../src/auth';

describe('requireWebhookSecret', () => {
  const secret = 'a'.repeat(32);

  it('returns null when header matches', () => {
    const request = new Request('https://x.test/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
    });

    expect(requireWebhookSecret(request, secret)).toBeNull();
  });

  it('returns 401 when header is missing', () => {
    const request = new Request('https://x.test/webhook', { method: 'POST' });

    expect(requireWebhookSecret(request, secret)?.status).toBe(401);
  });

  it('returns 401 when header does not match', () => {
    const request = new Request('https://x.test/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
    });

    expect(requireWebhookSecret(request, secret)?.status).toBe(401);
  });

  it('returns 401 when expected secret is empty', () => {
    const request = new Request('https://x.test/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': '' },
    });

    expect(requireWebhookSecret(request, '')?.status).toBe(401);
  });

  it('returns 401 when expected secret is too short', () => {
    const request = new Request('https://x.test/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'short' },
    });

    expect(requireWebhookSecret(request, 'short')?.status).toBe(401);
  });
});
