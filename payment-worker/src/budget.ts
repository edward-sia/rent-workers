import { worstCaseCallMs } from '@rent/airtable-client';
import { MAX_MOVE_IN_RENT_CHARGES } from '@rent/tenancy';
import { AIRTABLE_TIMEOUT_MS } from './airtable';

/**
 * How long grammY waits for a handler before it gives up. Its default is 10 s, which a
 * move-in Confirm against a slow Airtable can pass. Giving up mid-save leaves the session
 * at `saving` with some writes done.
 */
export const WEBHOOK_TIMEOUT_MS = 50_000;

const options = { timeoutMs: AIRTABLE_TIMEOUT_MS };

/**
 * The longest a move-in Confirm's Airtable writes can take, when every call runs to its
 * timeout. It matches `saveMoveIn` in `movein.ts`: POSTs for the tenant, the tenancy, each
 * rent charge and the bond, and one PATCH for the room. Change both together.
 */
export const MOVE_IN_CONFIRM_WORST_CASE_MS =
  (3 + MAX_MOVE_IN_RENT_CHARGES) * worstCaseCallMs('POST', options) + worstCaseCallMs('PATCH', options);

/** Time left for the rest of a Confirm: the ConfirmLock claim, KV writes and Telegram calls. */
export const OTHER_CALLS_ALLOWANCE_MS = 8000;
