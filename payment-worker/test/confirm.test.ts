import { describe, expect, it, vi } from 'vitest';
import { claimConfirm, confirmData, confirmPattern, newOpId } from '../src/confirm';
import type { Env } from '../src/types';

function envWith(claim: () => Promise<boolean>): Env {
  return {
    CONFIRM_LOCK: { idFromName: (name: string) => name, get: () => ({ claim }) },
  } as unknown as Env;
}

describe('confirm', () => {
  it('makes 12-character hex operation IDs that the pattern accepts', () => {
    const opId = newOpId();
    expect(opId).toMatch(/^[0-9a-f]{12}$/);
    expect(confirmPattern('mi:confirm').exec(confirmData('mi:confirm', opId))?.[1]).toBe(opId);
  });

  it('accepts a button with no operation ID so the handler can say it is out of date', () => {
    const match = confirmPattern('mo:confirm').exec('mo:confirm');
    expect(match).not.toBeNull();
    expect(match?.[1]).toBeUndefined();
  });

  it('rejects other callback data', () => {
    expect(confirmPattern('confirm:yes').test('confirm:yes:not-an-id')).toBe(false);
    expect(confirmPattern('confirm:yes').test('xconfirm:yes')).toBe(false);
  });

  it('reports claimed, taken, or failed', async () => {
    expect(await claimConfirm(envWith(async () => true), 1, 'a', 'pay')).toBe('claimed');
    expect(await claimConfirm(envWith(async () => false), 1, 'a', 'pay')).toBe('taken');

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await claimConfirm(envWith(async () => { throw new Error('boom'); }), 1, 'a', 'pay');
    expect(failed).toBe('failed');
    expect(error).toHaveBeenCalledWith('[payment-bot] pay failed: claim Confirm: request failed');
    error.mockRestore();
  });
});
