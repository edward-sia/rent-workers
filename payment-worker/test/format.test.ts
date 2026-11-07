import { describe, expect, it } from 'vitest';
import {
  escapeTelegramMarkdown,
  failureSummary,
  formatAUD,
  httpStatusOf,
  parseAmount,
  parseDate,
  melbourneDateISO,
  melbourneYesterdayISO,
} from '../src/format';

describe('formatAUD', () => {
  it('formats with $ and 2 dp', () => {
    expect(formatAUD(1650)).toBe('$1,650.00');
  });

  it('groups thousands', () => {
    expect(formatAUD(1234567.5)).toBe('$1,234,567.50');
  });
});

describe('escapeTelegramMarkdown', () => {
  it('escapes Markdown control characters in dynamic values', () => {
    expect(escapeTelegramMarkdown('A_B [C](D) *E* `F` \\G')).toBe('A\\_B \\[C\\]\\(D\\) \\*E\\* \\`F\\` \\\\G');
  });
});

describe('parseAmount', () => {
  it.each([
    ['1650', 1650],
    ['1650.00', 1650],
    ['$1,650', 1650],
    ['$1,650.50', 1650.5],
  ])('parses %s as %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['abc', '', '-5', '0', 'NaN'])('rejects %s', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('parseDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(parseDate('2026-04-25')).toBe('2026-04-25');
  });

  it('converts DD/MM/YYYY', () => {
    expect(parseDate('25/04/2026')).toBe('2026-04-25');
  });

  it('rejects garbage', () => {
    expect(parseDate('abc')).toBeNull();
  });

  it('rejects invalid calendar dates', () => {
    expect(parseDate('2026-13-40')).toBeNull();
    expect(parseDate('2026-02-31')).toBeNull();
  });
});

describe('melbourneDateISO / melbourneYesterdayISO', () => {
  it('uses the Melbourne calendar day, not the UTC day', () => {
    const now = new Date('2026-11-07T23:30:00Z');

    expect(melbourneDateISO(now)).toBe('2026-11-08');
    expect(melbourneYesterdayISO(now)).toBe('2026-11-07');
  });

  it('defaults to the current time', () => {
    expect(melbourneDateISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('httpStatusOf', () => {
  it('keeps only the HTTP status from an Airtable error', () => {
    const error = new Error('Airtable update [tblX]: HTTP 422: {"error":{"message":"secret"}}');
    expect(httpStatusOf(error)).toBe('HTTP 422');
  });

  it('falls back when the error has no HTTP status', () => {
    expect(httpStatusOf(new Error('network down'))).toBe('request failed');
  });
});

describe('failureSummary', () => {
  it('keeps only the HTTP status', () => {
    const error = new Error('Airtable create [tblX]: HTTP 422: {"error":{"message":"secret"}}');
    expect(failureSummary(error)).toBe('HTTP 422');
  });

  it('names a schema mismatch without the field details', () => {
    const error = new Error('Airtable schema mismatch on create [tblX/rec1] at Label: Required');
    expect(failureSummary(error)).toBe('schema mismatch');
  });

  it('names a timeout', () => {
    const error = new Error('Airtable create [tblX]: The operation was aborted due to timeout');
    expect(failureSummary(error)).toBe('timeout');
  });

  it('falls back for anything else', () => {
    expect(failureSummary(new Error('network down'))).toBe('request failed');
  });
});
