import type { Context } from 'grammy';
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

/** Plain text. Sent as a new message, so the confirm screen above it keeps its buttons. */
export const CLAIM_FAILED = '⚠️ Could not start the save. Nothing was written. Tap Confirm above to try again.';

/**
 * Claims the save for the tapped Confirm. Returns true when this tap may write.
 *
 * - `taken`: another tap is saving this operation. The screen becomes `savingText`, and its
 *   buttons go, because tapping again can't help.
 * - `failed`: the confirm screen stays as it is, buttons included, and the error goes in a
 *   new message. The session is still at its confirm step, so the same Confirm works again.
 */
export async function claimSave(
  ctx: Context,
  env: Env,
  opId: string,
  flow: string,
  savingText: string,
): Promise<boolean> {
  const claim = await claimConfirm(env, ctx.from!.id, opId, flow);
  if (claim === 'claimed') return true;
  if (claim === 'taken') await ctx.editMessageText(savingText);
  else await ctx.reply(CLAIM_FAILED);
  return false;
}
