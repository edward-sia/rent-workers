import type { AirtableRecord, Charge, Tenancy } from '@rent/airtable-client';
import { describe, expect, it } from 'vitest';
import {
  bucketOutstandingCharges,
  groupReminderChargesByTenant,
  listOutstandingChargesForTenancy,
} from '../src/outstanding';

function charge(
  id: string,
  fields: Partial<Charge> & Pick<Charge, 'Label'>,
): AirtableRecord<Charge> {
  return { id, fields: fields as Charge };
}

function tenancy(id: string, label: string): AirtableRecord<Tenancy> {
  return { id, fields: { Label: label } };
}

describe('outstanding charge filtering', () => {
  const today = '2026-05-18';
  const tenancies = [
    tenancy('recT1', '6B Sun Peng'),
    tenancy('recT2', '7A Jane Doe'),
  ];

  it('keeps every overdue and due-soon charge for the same tenant', () => {
    const result = bucketOutstandingCharges({
      today,
      horizonDays: 14,
      tenancies,
      charges: [
        charge('recC1', {
          Label: 'March Rent',
          Balance: 1650,
          Status: 'Overdue',
          'Due Date': '2026-03-05',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('recC2', {
          Label: 'April Rent',
          Balance: 1650,
          Status: 'Unpaid',
          'Due Date': '2026-04-05',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('recC3', {
          Label: 'May Rent',
          Balance: 800,
          Status: 'Partial',
          'Due Date': '2026-05-05',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('recC4', {
          Label: 'June Rent',
          Balance: 1650,
          Status: 'Due',
          'Due Date': '2026-06-01',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
      ],
    });

    expect(result.payNow.map((row) => row.chargeId)).toEqual(['recC1', 'recC2', 'recC3']);
    expect(result.dueSoon.map((row) => row.chargeId)).toEqual(['recC4']);
    expect(result.payNowTotal).toBe(4100);
    expect(result.dueSoonTotal).toBe(1650);
  });

  it('excludes paid, zero-balance, missing-date, invalid-date, and outside-window charges', () => {
    const result = bucketOutstandingCharges({
      today,
      horizonDays: 14,
      tenancies,
      charges: [
        charge('paid', {
          Label: 'Paid Rent',
          Balance: 100,
          Status: 'Paid',
          'Due Date': '2026-05-01',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('zero', {
          Label: 'Zero Rent',
          Balance: 0,
          Status: 'Unpaid',
          'Due Date': '2026-05-01',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('missing-date', {
          Label: 'Missing Date',
          Balance: 100,
          Status: 'Unpaid',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('invalid-date', {
          Label: 'Invalid Date',
          Balance: 100,
          Status: 'Unpaid',
          'Due Date': '2026-02-31',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('future', {
          Label: 'Future Rent',
          Balance: 100,
          Status: 'Unpaid',
          'Due Date': '2026-06-10',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
      ],
    });

    expect(result.payNow).toEqual([]);
    expect(result.dueSoon).toEqual([]);
  });

  it('groups each bucket by tenant with bucket-specific subtotals', () => {
    const buckets = bucketOutstandingCharges({
      today,
      horizonDays: 14,
      tenancies,
      charges: [
        charge('recC1', {
          Label: 'May Rent',
          Balance: 1650,
          Status: 'Unpaid',
          'Due Date': '2026-05-05',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('recC2', {
          Label: 'June Rent',
          Balance: 1650,
          Status: 'Unpaid',
          'Due Date': '2026-06-01',
          Tenancy: ['recT1'],
          Type: 'Rent',
        }),
        charge('recC3', {
          Label: 'Jane Rent',
          Balance: 1800,
          Status: 'Unpaid',
          'Due Date': '2026-06-01',
          Tenancy: ['recT2'],
          Type: 'Rent',
        }),
      ],
    });

    expect(groupReminderChargesByTenant(buckets.payNow)).toEqual([
      {
        tenancyId: 'recT1',
        tenantLabel: '6B Sun Peng',
        subtotal: 1650,
        charges: [expect.objectContaining({ chargeId: 'recC1' })],
      },
    ]);
    expect(groupReminderChargesByTenant(buckets.dueSoon)).toEqual([
      {
        tenancyId: 'recT1',
        tenantLabel: '6B Sun Peng',
        subtotal: 1650,
        charges: [expect.objectContaining({ chargeId: 'recC2' })],
      },
      {
        tenancyId: 'recT2',
        tenantLabel: '7A Jane Doe',
        subtotal: 1800,
        charges: [expect.objectContaining({ chargeId: 'recC3' })],
      },
    ]);
  });

  it('orders reminder tenant groups by earliest due date', () => {
    const buckets = bucketOutstandingCharges({
      today,
      horizonDays: 14,
      tenancies: [
        tenancy('recA', 'Alpha Later'),
        tenancy('recZ', 'Zulu Earlier'),
      ],
      charges: [
        charge('recLater', {
          Label: 'Later Rent',
          Balance: 100,
          Status: 'Unpaid',
          'Due Date': '2026-05-30',
          Tenancy: ['recA'],
          Type: 'Rent',
        }),
        charge('recMiddle', {
          Label: 'Middle Rent',
          Balance: 100,
          Status: 'Unpaid',
          'Due Date': '2026-05-25',
          Tenancy: ['recZ'],
          Type: 'Rent',
        }),
        charge('recEarliest', {
          Label: 'Earliest Rent',
          Balance: 100,
          Status: 'Unpaid',
          'Due Date': '2026-05-20',
          Tenancy: ['recZ'],
          Type: 'Rent',
        }),
      ],
    });

    const groups = groupReminderChargesByTenant(buckets.dueSoon);

    expect(groups.map((group) => group.tenancyId)).toEqual(['recZ', 'recA']);
    expect(groups[0]?.charges.map((charge) => charge.chargeId)).toEqual(['recEarliest', 'recMiddle']);
  });

  it('keeps pay charge selection charge-level and sorted by due date', () => {
    const rows = listOutstandingChargesForTenancy([
      charge('recC2', {
        Label: 'June Rent',
        Balance: 1650,
        Status: 'Unpaid',
        'Due Date': '2026-06-01',
        Tenancy: ['recT1'],
        Type: 'Rent',
      }),
      charge('recC1', {
        Label: 'May Rent',
        Balance: 1650,
        Status: 'Due',
        'Due Date': '2026-05-05',
        Tenancy: ['recT1'],
        Type: 'Rent',
      }),
      charge('recC3', {
        Label: 'Other Tenant Rent',
        Balance: 1800,
        Status: 'Unpaid',
        'Due Date': '2026-05-05',
        Tenancy: ['recT2'],
        Type: 'Rent',
      }),
      charge('recPaid', {
        Label: 'Paid Rent',
        Balance: 1800,
        Status: 'Paid',
        'Due Date': '2026-05-04',
        Tenancy: ['recT1'],
        Type: 'Rent',
      }),
    ], 'recT1');

    expect(rows.map((row) => row.id)).toEqual(['recC1', 'recC2']);
  });
});
