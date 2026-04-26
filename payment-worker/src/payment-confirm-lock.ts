import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';

interface ClaimResult {
  claimed: boolean;
}

export class PaymentConfirmLock extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS confirmations (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
    });
  }

  claim(confirmationId: string): ClaimResult {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO confirmations (id, status, created_at)
       VALUES (?, 'processing', ?)`,
      confirmationId,
      Date.now(),
    );

    const row = this.ctx.storage.sql.exec<{ inserted: number }>(
      'SELECT changes() AS inserted',
    ).one();

    return { claimed: row.inserted === 1 };
  }

  complete(confirmationId: string): void {
    this.ctx.storage.sql.exec(
      `UPDATE confirmations
       SET status = 'completed'
       WHERE id = ? AND status = 'processing'`,
      confirmationId,
    );
  }

  release(confirmationId: string): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM confirmations
       WHERE id = ? AND status = 'processing'`,
      confirmationId,
    );
  }
}
