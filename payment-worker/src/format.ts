import { addDaysISO } from '@rent/tenancy';

export const formatAUD = (n: number): string =>
  `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export const escapeTelegramMarkdown = (value: string): string =>
  value.replace(/([\\_*[\]()`])/g, '\\$1');

export const escapeTelegramMarkdownUrl = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');

export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return amount;
}

export function parseDate(input: string): string | null {
  let candidate: string | null = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    candidate = input;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [day, month, year] = input.split('/');
    candidate = `${year}-${month}-${day}`;
  }

  if (!candidate) return null;

  const timestamp = Date.parse(`${candidate}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return null;

  return new Date(timestamp).toISOString().slice(0, 10) === candidate ? candidate : null;
}

const RENT_TIME_ZONE = 'Australia/Melbourne';

export function melbourneDateISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: RENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to resolve current rent date');
  return `${year}-${month}-${day}`;
}

export const melbourneYesterdayISO = (now: Date = new Date()): string =>
  addDaysISO(melbourneDateISO(now), -1);

/**
 * The `HTTP 422`-style status from an Airtable client error, for Telegram replies.
 * The full error message embeds the Airtable response body, so it is never shown or logged.
 */
export function httpStatusOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /\bHTTP\s+\d{3}\b/.exec(message)?.[0] ?? 'request failed';
}

/**
 * A short, body-free reason for a failed Airtable call, for logs: the HTTP status,
 * `schema mismatch`, `timeout`, or `request failed`.
 */
export function failureSummary(error: unknown): string {
  const status = httpStatusOf(error);
  if (status !== 'request failed') return status;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Airtable schema mismatch')) return 'schema mismatch';
  if (/timeout|aborted/i.test(message)) return 'timeout';
  return 'request failed';
}

/**
 * Log a failed Airtable call as `[payment-bot] <flow> failed: <action>: <reason>`.
 * The error message embeds the Airtable response body, so it is never logged.
 */
export function logAirtableFailure(flow: string, action: string, error: unknown): void {
  console.error(`[payment-bot] ${flow} failed: ${action}: ${failureSummary(error)}`);
}
