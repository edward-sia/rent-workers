import { describe, expect, it } from 'vitest';
import { resolveDueDate } from '../src/due-date';

describe('resolveDueDate', () => {
  it('uses Due Day override when set and within 1..28', () => {
    expect(resolveDueDate({ 'Due Day': 15 }, 2026, '05')).toBe('2026-05-15');
  });

  it('falls back to Start Date day when Due Day not set', () => {
    expect(resolveDueDate({ 'Start Date': '2024-03-10' }, 2026, '05')).toBe('2026-05-10');
  });

  it('caps day at 28 to avoid invalid February dates', () => {
    expect(resolveDueDate({ 'Start Date': '2024-01-31' }, 2026, '02')).toBe('2026-02-28');
  });

  it('falls back to 1st when neither field present', () => {
    expect(resolveDueDate({}, 2026, '05')).toBe('2026-05-01');
  });

  it('ignores Due Day above 28 and uses Start Date', () => {
    expect(
      resolveDueDate({ 'Due Day': 30, 'Start Date': '2024-03-10' }, 2026, '05'),
    ).toBe('2026-05-10');
  });

  it('ignores Due Day below 1 and uses Start Date', () => {
    expect(
      resolveDueDate({ 'Due Day': 0, 'Start Date': '2024-03-10' }, 2026, '05'),
    ).toBe('2026-05-10');
  });
});
