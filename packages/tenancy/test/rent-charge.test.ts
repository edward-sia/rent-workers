import { describe, expect, it } from 'vitest';
import { buildRentCharge } from '../src/rent-charge';

describe('buildRentCharge', () => {
  it('builds the Airtable charge fields for a rent charge', () => {
    expect(
      buildRentCharge({
        tenancyId: 'recT1',
        tenancyLabel: '6B-R6 Sun Peng',
        period: '2026-12',
        dueDate: '2026-12-10',
        amount: 1500,
      }),
    ).toEqual({
      Label: '6B-R6 Sun Peng 2026-12 Rent',
      Tenancy: ['recT1'],
      Type: 'Rent',
      Period: '2026-12',
      'Due Date': '2026-12-10',
      Amount: 1500,
    });
  });
});
