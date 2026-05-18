import { describe, expect, it } from 'vitest';
import { formatReminderMessages } from '../src/reminder';
import type { ReminderBuckets } from '../src/outstanding';

function buckets(overrides: Partial<ReminderBuckets> = {}): ReminderBuckets {
  return {
    payNow: [],
    dueSoon: [],
    payNowTotal: 0,
    dueSoonTotal: 0,
    ...overrides,
  };
}

describe('formatReminderMessages', () => {
  it('formats overdue and due-soon sections with tenant subtotals and one row per charge', () => {
    const messages = formatReminderMessages(buckets({
      payNowTotal: 4950,
      dueSoonTotal: 1650,
      payNow: [
        {
          chargeId: 'recC1',
          tenancyId: 'recT1',
          tenantLabel: '6B Sun Peng',
          chargeLabel: 'March',
          rowLabel: '2026-03-05 Rent',
          dueDate: '2026-03-05',
          status: 'Overdue',
          balance: 1650,
          bucket: 'pay_now',
        },
        {
          chargeId: 'recC2',
          tenancyId: 'recT1',
          tenantLabel: '6B Sun Peng',
          chargeLabel: 'April',
          rowLabel: '2026-04-05 Rent',
          dueDate: '2026-04-05',
          status: 'Unpaid',
          balance: 1650,
          bucket: 'pay_now',
        },
        {
          chargeId: 'recC3',
          tenancyId: 'recT1',
          tenantLabel: '6B Sun Peng',
          chargeLabel: 'May',
          rowLabel: '2026-05-05 Rent',
          dueDate: '2026-05-05',
          status: 'Partial',
          balance: 1650,
          bucket: 'pay_now',
        },
      ],
      dueSoon: [
        {
          chargeId: 'recC4',
          tenancyId: 'recT1',
          tenantLabel: '6B Sun Peng',
          chargeLabel: 'June',
          rowLabel: '2026-06-01 Rent',
          dueDate: '2026-06-01',
          status: 'Due',
          balance: 1650,
          bucket: 'due_soon',
        },
      ],
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Pay now - subtotal $4,950.00');
    expect(messages[0]).toContain('6B Sun Peng - subtotal $4,950.00');
    expect(messages[0]).toContain('• 2026-03-05 Rent · $1,650.00');
    expect(messages[0]).toContain('Due in next 14 days - subtotal $1,650.00');
    expect(messages[0]).toContain('6B Sun Peng - subtotal $1,650.00');
    expect(messages[0]).toContain('• 2026-06-01 Rent · $1,650.00');
  });

  it('returns a concise empty state', () => {
    expect(formatReminderMessages(buckets())).toEqual([
      'No overdue payments or payments due in the next 14 days.',
    ]);
  });

  it('escapes Markdown values from Airtable', () => {
    const messages = formatReminderMessages(buckets({
      payNowTotal: 100,
      payNow: [
        {
          chargeId: 'recC1',
          tenancyId: 'recT1',
          tenantLabel: '6B A_B [VIP]',
          chargeLabel: 'X',
          rowLabel: '2026-03-05 Rent_[x]',
          dueDate: '2026-03-05',
          status: 'Unpaid',
          balance: 100,
          bucket: 'pay_now',
        },
      ],
    }));

    expect(messages[0]).toContain('6B A\\_B \\[VIP\\]');
    expect(messages[0]).toContain('2026-03-05 Rent\\_\\[x\\]');
  });

  it('splits long output into multiple messages', () => {
    const dueSoon = Array.from({ length: 120 }, (_, index) => ({
      chargeId: `rec${index}`,
      tenancyId: `recT${index}`,
      tenantLabel: `Tenant ${index}`,
      chargeLabel: `Charge ${index}`,
      rowLabel: `2026-05-${String((index % 14) + 18).padStart(2, '0')} Rent`,
      dueDate: `2026-05-${String((index % 14) + 18).padStart(2, '0')}`,
      status: 'Unpaid' as const,
      balance: 100,
      bucket: 'due_soon' as const,
    }));

    const messages = formatReminderMessages(buckets({
      dueSoon,
      dueSoonTotal: 12000,
    }), { maxMessageLength: 1200 });

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 1200)).toBe(true);
  });
});
