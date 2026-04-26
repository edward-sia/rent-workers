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

interface AirtableListResponse {
  records: { id: string; fields: unknown }[];
  offset?: string;
}

export class AirtableClient {
  constructor(private readonly env: AirtableEnv) {}

  async fetchAll<T>(
    tableId: string,
    schema:  z.ZodType<T>,
    params:  QueryParams = {},
  ): Promise<AirtableRecord<T>[]> {
    const out: AirtableRecord<T>[] = [];
    let offset: string | undefined;

    do {
      const url = `${this.baseUrl()}/${tableId}?${buildQS(params, offset)}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        throw new Error(`Airtable fetch [${tableId}]: ${res.status} ${await res.text()}`);
      }
      const data = await res.json() as AirtableListResponse;
      for (const r of data.records) {
        const fields = schema.parse(r.fields);
        out.push({ id: r.id, fields });
      }
      offset = data.offset;
    } while (offset);

    return out;
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
}
