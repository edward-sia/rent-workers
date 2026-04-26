import { z } from 'zod';
import { buildQS } from './qs';

export interface AirtableEnv {
  AIRTABLE_TOKEN:   string;
  AIRTABLE_BASE_ID: string;
}

export interface AirtableRecord<T> {
  id:     string;
  fields: T;
}

export type QueryParams = Record<string, string | string[]>;

export interface AirtableClientOptions {
  /** Per-request timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** Max retries on 5xx / network error. Default 2. */
  retries?: number;
}

interface AirtableListResponse {
  records: { id: string; fields: unknown }[];
  offset?: string;
}

export class AirtableClient {
  private readonly timeoutMs: number;
  private readonly retries:   number;

  constructor(
    private readonly env: AirtableEnv,
    opts: AirtableClientOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries   = opts.retries   ?? 2;
  }

  async fetchAll<T>(
    tableId: string,
    schema:  z.ZodType<T>,
    params:  QueryParams = {},
  ): Promise<AirtableRecord<T>[]> {
    const out: AirtableRecord<T>[] = [];
    let offset: string | undefined;

    do {
      const url = `${this.baseUrl()}/${tableId}?${buildQS(params, offset)}`;
      let res: Response;
      try {
        res = await this.request(url);
      } catch (e) {
        throw new Error(`Airtable fetch [${tableId}]: ${(e as Error).message}`);
      }
      const data = await res.json() as AirtableListResponse;
      for (const r of data.records) {
        const result = schema.safeParse(r.fields);
        if (!result.success) {
          const issue = result.error.issues[0];
          throw new Error(
            `Airtable schema mismatch [${tableId}/${r.id}] at ${issue?.path.join('.')}: ${issue?.message}`,
          );
        }
        out.push({ id: r.id, fields: result.data });
      }
      offset = data.offset;
    } while (offset);

    return out;
  }

  async create<T>(
    tableId: string,
    schema:  z.ZodType<T>,
    fields:  Partial<T>,
  ): Promise<AirtableRecord<T>> {
    const url = `${this.baseUrl()}/${tableId}`;
    let res: Response;
    try {
      res = await this.request(url, {
        method: 'POST',
        body:   JSON.stringify({ fields }),
      });
    } catch (e) {
      throw new Error(`Airtable create [${tableId}]: ${(e as Error).message}`);
    }
    const data = await res.json() as { id: string; fields: unknown };
    const parsed = schema.safeParse(data.fields);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `Airtable schema mismatch on create [${tableId}/${data.id}] at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }
    return { id: data.id, fields: parsed.data };
  }

  private baseUrl(): string {
    return `https://api.airtable.com/v0/${this.env.AIRTABLE_BASE_ID}`;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.env.AIRTABLE_TOKEN}`,
      'Content-Type':  'application/json',
    };
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const baseInit: RequestInit = {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          ...baseInit,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return res;
        if (res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
          if (attempt < this.retries) { await this.sleep(this.backoffMs(attempt)); continue; }
          throw lastErr;
        }
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      } catch (e) {
        if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) {
          lastErr = e;
          if (attempt < this.retries) { await this.sleep(this.backoffMs(attempt)); continue; }
          throw e;
        }
        throw e;
      }
    }
    throw lastErr ?? new Error('unreachable');
  }

  private backoffMs(attempt: number): number {
    // 200ms, 800ms (4x growth)
    return 200 * Math.pow(4, attempt);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
