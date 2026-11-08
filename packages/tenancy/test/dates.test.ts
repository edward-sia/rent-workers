import { describe, expect, it } from 'vitest';
import { addDaysISO, addMonths, daysInMonth, endOfMonthISO, periodOf } from '../src/dates';

describe('dates', () => {
  it('periodOf returns YYYY-MM', () => {
    expect(periodOf('2026-11-20')).toBe('2026-11');
  });

  it('addMonths rolls over the year forwards', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });

  it('addMonths rolls over the year backwards', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('daysInMonth handles leap years', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
  });

  it('addDaysISO crosses year boundaries', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('endOfMonthISO returns the last day of the month', () => {
    expect(endOfMonthISO('2026-11-07')).toBe('2026-11-30');
  });
});
