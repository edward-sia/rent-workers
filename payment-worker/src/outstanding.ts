import {
  AirtableClient,
  type AirtableRecord,
  type Charge,
  ChargeSchema,
  TABLES,
  type Tenancy,
  TenancySchema,
} from '@rent/airtable-client';
import type { Env } from './types';

const RENT_TIME_ZONE = 'Australia/Melbourne';

export type ReminderBucket = 'pay_now' | 'due_soon';

export interface ReminderCharge {
  chargeId: string;
  tenancyId: string;
  tenantLabel: string;
  chargeLabel: string;
  rowLabel: string;
  dueDate: string;
  status: Charge['Status'];
  balance: number;
  bucket: ReminderBucket;
}

export interface ReminderTenantGroup {
  tenancyId: string;
  tenantLabel: string;
  subtotal: number;
  charges: ReminderCharge[];
}

export interface ReminderBuckets {
  payNow: ReminderCharge[];
  dueSoon: ReminderCharge[];
  payNowTotal: number;
  dueSoonTotal: number;
}

export interface BucketOutstandingChargesInput {
  today: string;
  horizonDays: number;
  tenancies: AirtableRecord<Tenancy>[];
  charges: AirtableRecord<Charge>[];
}

export async function fetchReminderBuckets(
  env: Env,
  today = todayISO(),
  horizonDays = 14,
): Promise<ReminderBuckets> {
  const airtable = new AirtableClient(env);
  const [tenancies, charges] = await Promise.all([
    airtable.fetchAll(TABLES.TENANCIES, TenancySchema, {
      fields: ['Label'],
    }),
    airtable.fetchAll(TABLES.CHARGES, ChargeSchema, {
      fields: ['Label', 'Balance', 'Status', 'Due Date', 'Tenancy', 'Type'],
      filterByFormula: 'NOT({Status} = "Paid")',
    }),
  ]);

  return bucketOutstandingCharges({ today, horizonDays, tenancies, charges });
}

export function bucketOutstandingCharges(input: BucketOutstandingChargesInput): ReminderBuckets {
  const horizon = addDaysISO(input.today, input.horizonDays);
  const labels = new Map(input.tenancies.map((tenancy) => [tenancy.id, tenancy.fields.Label]));
  const payNow: ReminderCharge[] = [];
  const dueSoon: ReminderCharge[] = [];

  for (const charge of input.charges) {
    const balance = charge.fields.Balance ?? 0;
    const dueDate = charge.fields['Due Date'];
    const status = charge.fields.Status;

    if (status === 'Paid' || balance <= 0 || !isISODate(dueDate)) continue;

    const isOverdue = dueDate < input.today;
    const isDueSoon = dueDate >= input.today && dueDate <= horizon;
    if (!isOverdue && !isDueSoon) continue;

    const tenancyId = charge.fields.Tenancy?.[0] ?? 'unknown';
    const type = charge.fields.Type?.trim() || 'Rent';
    const row: ReminderCharge = {
      chargeId: charge.id,
      tenancyId,
      tenantLabel: labels.get(tenancyId) ?? (tenancyId === 'unknown' ? 'Unknown tenancy' : tenancyId),
      chargeLabel: charge.fields.Label,
      rowLabel: `${dueDate} ${type}`,
      dueDate,
      status,
      balance,
      bucket: isOverdue ? 'pay_now' : 'due_soon',
    };

    if (row.bucket === 'pay_now') payNow.push(row);
    else dueSoon.push(row);
  }

  payNow.sort(compareReminderCharges);
  dueSoon.sort(compareReminderCharges);

  return {
    payNow,
    dueSoon,
    payNowTotal: sumBalances(payNow),
    dueSoonTotal: sumBalances(dueSoon),
  };
}

export function groupReminderChargesByTenant(charges: ReminderCharge[]): ReminderTenantGroup[] {
  const groups = new Map<string, ReminderTenantGroup>();

  for (const charge of charges) {
    const existing = groups.get(charge.tenancyId);
    if (existing) {
      existing.charges.push(charge);
      existing.subtotal += charge.balance;
    } else {
      groups.set(charge.tenancyId, {
        tenancyId: charge.tenancyId,
        tenantLabel: charge.tenantLabel,
        subtotal: charge.balance,
        charges: [charge],
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      charges: [...group.charges].sort(compareReminderCharges),
    }))
    .sort(compareReminderTenantGroups);
}

export function listOutstandingChargesForTenancy(
  charges: AirtableRecord<Charge>[],
  tenancyId: string,
): AirtableRecord<Charge>[] {
  return charges
    .filter((charge) => charge.fields.Status !== 'Paid')
    .filter((charge) => (charge.fields.Balance ?? 0) > 0)
    .filter((charge) => charge.fields.Tenancy?.includes(tenancyId))
    .sort((a, b) =>
      String(a.fields['Due Date'] ?? '').localeCompare(String(b.fields['Due Date'] ?? '')) ||
      a.fields.Label.localeCompare(b.fields.Label),
    );
}

function compareReminderCharges(a: ReminderCharge, b: ReminderCharge): number {
  return a.dueDate.localeCompare(b.dueDate) ||
    a.tenantLabel.localeCompare(b.tenantLabel) ||
    a.rowLabel.localeCompare(b.rowLabel);
}

function compareReminderTenantGroups(a: ReminderTenantGroup, b: ReminderTenantGroup): number {
  const aFirstDueDate = a.charges[0]?.dueDate ?? '';
  const bFirstDueDate = b.charges[0]?.dueDate ?? '';

  return aFirstDueDate.localeCompare(bFirstDueDate) ||
    a.tenantLabel.localeCompare(b.tenantLabel) ||
    a.tenancyId.localeCompare(b.tenancyId);
}

function sumBalances(charges: ReminderCharge[]): number {
  return charges.reduce((total, charge) => total + charge.balance, 0);
}

function addDaysISO(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function todayISO(): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: RENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to resolve current rent date');
  return `${year}-${month}-${day}`;
}
