import { AirtableClient } from '@rent/airtable-client';
import type { Env } from './types';

/**
 * Per-request Airtable timeout for the bot. A move-in Confirm makes up to seven calls
 * one after another, and they must all finish inside the webhook timeout in `index.ts`.
 */
export const AIRTABLE_TIMEOUT_MS = 5000;

/** The Airtable client every bot handler uses. */
export function airtableFor(env: Env): AirtableClient {
  return new AirtableClient(env, { timeoutMs: AIRTABLE_TIMEOUT_MS });
}
