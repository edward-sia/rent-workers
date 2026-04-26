import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAUD, parseAmount, parseDate, todayISO, yesterdayISO } from '../src/format';

describe('formatAUD', () => {
  it('formats with $ and 2 dp', () => {
    expect(formatAUD(1650)).toBe('$1,650.00');
  });

  it('groups thousands', () => {
    expect(formatAUD(1234567.5)).toBe('$1,234,567.50');
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

describe('todayISO / yesterdayISO', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('todayISO matches YYYY-MM-DD shape', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('yesterdayISO is one day before today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T12:00:00Z'));

    const today = new Date(`${todayISO()}T00:00:00Z`);
    const yesterday = new Date(`${yesterdayISO()}T00:00:00Z`);

    expect((today.getTime() - yesterday.getTime()) / 86400000).toBe(1);
  });
});
