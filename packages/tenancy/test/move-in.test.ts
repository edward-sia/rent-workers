import { describe, expect, it } from 'vitest';
import {
  checkStartDate,
  dueDayFor,
  generatedThrough,
  partMonthAmount,
  planMoveInCharges,
  tenancyLabel,
} from '../src/move-in';

describe('tenancyLabel', () => {
  it('trims both parts and joins with one space', () => {
    expect(tenancyLabel(' 6B-R6 ', 'Sun Peng ')).toBe('6B-R6 Sun Peng');
  });
});

describe('dueDayFor', () => {
  it('caps the start day at 28 for regular', () => {
    expect(dueDayFor('regular', '2026-11-30')).toBe(28);
  });
  it('uses the start day for regular', () => {
    expect(dueDayFor('regular', '2026-11-20')).toBe(20);
  });
  it('is 1 for part_month', () => {
    expect(dueDayFor('part_month', '2026-11-20')).toBe(1);
  });
});

describe('partMonthAmount', () => {
  it('prorates by days left in the month, rounded to cents', () => {
    expect(partMonthAmount(1500, '2026-11-20')).toBe(542.47);
  });
  it('handles the last day of the month', () => {
    expect(partMonthAmount(1500, '2026-11-30')).toBe(49.32);
  });
  it('handles the 1st (whole month)', () => {
    expect(partMonthAmount(1500, '2026-11-01')).toBe(1479.45);
  });
});

describe('checkStartDate', () => {
  it('accepts exactly 60 days back', () => {
    expect(checkStartDate('2026-09-08', '2026-11-07')).toBeNull();
  });
  it('rejects 61 days back', () => {
    expect(checkStartDate('2026-09-07', '2026-11-07')).toMatch(/60 days/);
  });
  it('accepts a future date', () => {
    expect(checkStartDate('2027-01-05', '2026-11-07')).toBeNull();
  });
});

describe('generatedThrough', () => {
  it('is this month before the 15th', () => {
    expect(generatedThrough('2026-11-14')).toBe('2026-11');
  });
  it('is next month from the 15th', () => {
    expect(generatedThrough('2026-11-15')).toBe('2026-12');
  });
});

describe('planMoveInCharges', () => {
  const base = { startDate: '2026-11-20', monthlyRent: 1500, option: 'regular' as const, firstAmount: 1500 };

  it('creates only the start month before the 15th', () => {
    expect(planMoveInCharges({ ...base, todayUtc: '2026-11-10' })).toEqual([
      { period: '2026-11', dueDate: '2026-11-20', amount: 1500 },
    ]);
  });

  it('adds next month after the 15th', () => {
    expect(planMoveInCharges({ ...base, todayUtc: '2026-11-18' })).toEqual([
      { period: '2026-11', dueDate: '2026-11-20', amount: 1500 },
      { period: '2026-12', dueDate: '2026-12-20', amount: 1500 },
    ]);
  });

  it('uses the 1st and the prorated first amount for part_month', () => {
    expect(
      planMoveInCharges({ ...base, option: 'part_month', firstAmount: 542.47, todayUtc: '2026-11-18' }),
    ).toEqual([
      { period: '2026-11', dueDate: '2026-11-20', amount: 542.47 },
      { period: '2026-12', dueDate: '2026-12-01', amount: 1500 },
    ]);
  });

  it('creates only the first charge for a start date past what the generator covers', () => {
    expect(planMoveInCharges({ ...base, startDate: '2027-01-05', todayUtc: '2026-11-10' })).toEqual([
      { period: '2027-01', dueDate: '2027-01-05', amount: 1500 },
    ]);
  });
});
