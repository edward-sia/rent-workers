import { logAirtableFailure } from './format';
import type { Env } from './types';

/**
 * Every confirm screen gets a new operation ID. It goes in the session and in the
 * Confirm button's callback data, so a tap only saves the operation that screen showed.
 */
export function newOpId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Callback data for a Confirm button, like `mi:confirm:3f9c0a1b2d4e`. */
export function confirmData(prefix: string, opId: string): string {
  return `${prefix}:${opId}`;
}

/**
 * Matches `prefix` with or without an operation ID. A button sent before operation IDs
 * existed has none, and the handler treats it as out of date.
 */
export function confirmPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}(?::([0-9a-f]{12}))?$`);
}

export type Claim = 'claimed' | 'taken' | 'failed';

/**
 * Asks the user's ConfirmLock whether this tap may write. Only one tap per operation
 * gets `claimed`. `failed` means the lock couldn't be reached, so nothing may be written.
 */
export async function claimConfirm(env: Env, userId: number, opId: string, flow: string): Promise<Claim> {
  try {
    const lock = env.CONFIRM_LOCK.get(env.CONFIRM_LOCK.idFromName(String(userId)));
    return (await lock.claim(opId)) ? 'claimed' : 'taken';
  } catch (e) {
    logAirtableFailure(flow, 'claim Confirm', e);
    return 'failed';
  }
}

/** Plain text. Shown when the lock can't be reached. The session stays at the confirm step. */
export const CLAIM_FAILED = '⚠️ Could not start the save. Nothing was written. Tap Confirm again.';
