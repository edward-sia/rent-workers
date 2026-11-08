import { DurableObject } from 'cloudflare:workers';

/** How long a claimed operation is remembered. Longer than the one-hour session TTL. */
const KEEP_MS = 2 * 60 * 60 * 1000;

/**
 * One instance per Telegram user. It decides which Confirm tap gets to write to Airtable.
 *
 * KV can't do this: a `get` then a `put` is two calls, and two webhook requests can both
 * read the confirm step before either writes `saving`. A Durable Object runs one request
 * at a time, and its storage calls block other requests until they finish, so the read
 * and the write in `claim` can't interleave with another claim.
 */
export class ConfirmLock extends DurableObject {
  /** True for the first claim of `opId`. False for every later claim of the same `opId`. */
  async claim(opId: string): Promise<boolean> {
    const now = Date.now();
    const claimed = (await this.ctx.storage.get<Record<string, number>>('claimed')) ?? {};
    if (claimed[opId] !== undefined) return false;

    const kept: Record<string, number> = { [opId]: now };
    for (const [id, at] of Object.entries(claimed)) {
      if (now - at < KEEP_MS) kept[id] = at;
    }
    await this.ctx.storage.put('claimed', kept);
    return true;
  }
}
