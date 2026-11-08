import { describe, expect, it } from 'vitest';
import { isWithinTenancy } from '../src/charge-window';

describe('isWithinTenancy', () => {
  const tenancy = { 'Start Date': '2026-05-10', 'End Date': '2026-06-20' };

  it('includes the Start Date', () => {
    expect(isWithinTenancy('2026-05-10', tenancy)).toBe(true);
  });

  it('includes the End Date', () => {
    expect(isWithinTenancy('2026-06-20', tenancy)).toBe(true);
  });

  it('excludes the day before Start Date', () => {
    expect(isWithinTenancy('2026-05-09', tenancy)).toBe(false);
  });

  it('excludes the day after End Date', () => {
    expect(isWithinTenancy('2026-06-21', tenancy)).toBe(false);
  });

  it('has no bounds when both dates are missing', () => {
    expect(isWithinTenancy('2026-05-09', {})).toBe(true);
  });

  it('has no upper bound when End Date is missing', () => {
    expect(isWithinTenancy('2099-01-01', { 'Start Date': '2026-05-10' })).toBe(true);
  });

  it('has no lower bound when Start Date is missing', () => {
    expect(isWithinTenancy('2000-01-01', { 'End Date': '2026-06-20' })).toBe(true);
  });
});
