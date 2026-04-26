import { DurableObject } from 'cloudflare:workers';

export interface ChargeGenerationClaim {
  acquired: boolean;
  period: string;
  activeRunId?: string;
}

interface LockRecord {
  period: string;
  runId: string;
  claimedAt: number;
  expiresAt: number;
}

const ACTIVE_LOCK_KEY = 'active';
const LOCK_TTL_MS = 15 * 60 * 1000;

export class ChargeGenerationLock extends DurableObject {
  async claim(period: string, runId: string, nowMs = Date.now()): Promise<ChargeGenerationClaim> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const active = await this.ctx.storage.get<LockRecord>(ACTIVE_LOCK_KEY);
      if (active && active.expiresAt > nowMs) {
        return {
          acquired: false,
          period,
          activeRunId: active.runId,
        };
      }

      await this.ctx.storage.put<LockRecord>(ACTIVE_LOCK_KEY, {
        period,
        runId,
        claimedAt: nowMs,
        expiresAt: nowMs + LOCK_TTL_MS,
      });

      return { acquired: true, period };
    });
  }

  async release(runId: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const active = await this.ctx.storage.get<LockRecord>(ACTIVE_LOCK_KEY);
      if (active?.runId === runId) {
        await this.ctx.storage.delete(ACTIVE_LOCK_KEY);
      }
    });
  }
}
