import { describe, expect, it } from 'vitest';
import { chargesAfter, checkEndDate, owedThrough } from '../src/move-out';
import { checkStartDate } from '../src/move-in';

describe('checkEndDate', () => {
  it('rejects an end date before the start date', () => {
    expect(checkEndDate('2026-11-01', '2026-11-05')).toMatch(/2026-11-05/);
  });
  it('accepts an end date equal to the start date', () => {
    expect(checkEndDate('2026-11-05', '2026-11-05')).toBeNull();
  });
  it('accepts any date when there is no start date', () => {
    expect(checkEndDate('2026-11-05', undefined)).toBeNull();
  });
});

const charges = [
  { id: 'c', fields: { 'Due Date': '2026-12-20', Balance: 100, Status: 'Unpaid' } },
  { id: 'a', fields: { 'Due Date': '2026-10-20', Balance: 50, Status: 'Unpaid' } },
  { id: 'd', fields: { 'Due Date': '2027-01-20', Balance: 0, Status: 'Paid' } },
  { id: 'b', fields: { 'Due Date': '2026-11-20', Balance: 75.5, Status: 'Partial' } },
  { id: 'e', fields: { 'Due Date': '2026-09-20', Balance: 0, Status: 'Unpaid' } },
  { id: 'f', fields: { 'Due Date': '2026-08-20', Balance: 30, Status: 'Paid' } },
  { id: 'g', fields: { Balance: 10, Status: 'Unpaid' } },
];

describe('chargesAfter', () => {
  it('keeps charges due after the end date, in due-date order', () => {
    expect(chargesAfter(charges, '2026-11-20').map((c) => c.id)).toEqual(['c', 'd']);
  });
});

describe('owedThrough', () => {
  it('sums unpaid balances due on or before the end date', () => {
    expect(owedThrough(charges, '2026-11-20')).toBe(125.5);
  });
});

describe('error messages', () => {
  it('contain no Telegram Markdown characters', () => {
    const messages = [checkStartDate('2026-01-01', '2026-11-07'), checkEndDate('2026-11-01', '2026-11-05')];
    for (const message of messages) {
      expect(message).not.toBeNull();
      expect(message).not.toMatch(/[_*[\]()`]/);
    }
  });
});
