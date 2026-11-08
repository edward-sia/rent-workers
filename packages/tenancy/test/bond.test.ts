import { describe, expect, it } from 'vitest';
import { buildBondCharge, suggestedBond } from '../src/bond';

describe('suggestedBond', () => {
  it('is one month of rent', () => {
    expect(suggestedBond(1500)).toBe(1500);
  });
});

describe('buildBondCharge', () => {
  it('builds a Bond charge due on the start date', () => {
    expect(
      buildBondCharge({ tenancyId: 'recT1', tenancyLabel: '6B-R6 Sun Peng', dueDate: '2026-12-01', amount: 1500 }),
    ).toEqual({
      Label: '6B-R6 Sun Peng Bond',
      Tenancy: ['recT1'],
      Type: 'Bond',
      'Due Date': '2026-12-01',
      Amount: 1500,
    });
  });

  it('has no Period, so the charge generator does not count it as rent', () => {
    const fields = buildBondCharge({ tenancyId: 'recT1', tenancyLabel: 'x', dueDate: '2026-12-01', amount: 1 });
    expect('Period' in fields).toBe(false);
  });
});
