// ─────────────────────────────────────────────────────────
// src/airtable.ts
// Airtable REST helpers — same buildQS pattern as charge-generator
// ─────────────────────────────────────────────────────────

import type { Env, AirtableRecord } from './types';

const AT_BASE    = (env: Env) => `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}`;
const AT_HEADERS = (env: Env): Record<string, string> => ({
  'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
  'Content-Type':  'application/json',
});

/** Serialize params — handles fields[] bracket notation Airtable requires */
export function buildQS(
  params: Record<string, string | string[]>,
  offset?: string,
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach(v => qs.append(`${key}[]`, v));
    } else {
      qs.set(key, value);
    }
  }
  if (offset) qs.set('offset', offset);
  return qs;
}

/** Fetch ALL records with pagination */
export async function fetchAllRecords(
  tableId: string,
  params:  Record<string, string | string[]>,
  env:     Env,
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const res = await fetch(
      `${AT_BASE(env)}/${tableId}?${buildQS(params, offset)}`,
      { headers: AT_HEADERS(env) },
    );
    if (!res.ok) throw new Error(`Airtable fetch [${tableId}]: ${await res.text()}`);
    const data = await res.json() as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

/** Create a single record, return the new record with its ID */
export async function createRecord(
  tableId: string,
  fields:  Record<string, unknown>,
  env:     Env,
): Promise<AirtableRecord> {
  const res = await fetch(`${AT_BASE(env)}/${tableId}`, {
    method:  'POST',
    headers: AT_HEADERS(env),
    body:    JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create [${tableId}]: ${await res.text()}`);
  return await res.json() as AirtableRecord;
}
