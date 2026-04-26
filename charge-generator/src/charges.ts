import {
  AirtableClient,
  ChargeSchema,
  TABLES,
  TenancySchema,
} from '@rent/airtable-client';
import { notifyDiscord } from './discord';
import { resolveDueDate } from './due-date';

export interface ChargesEnv {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  DISCORD_WEBHOOK_URL: string;
}

export interface ChargePeriod {
  period: string;
  year: number;
  month: string;
}

export function getNextChargePeriod(date = new Date()): ChargePeriod {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const period = `${year}-${month}`;

  return { period, year, month };
}

export async function generateCharges(
  env: ChargesEnv,
  chargePeriod = getNextChargePeriod(),
): Promise<void> {
  const client = new AirtableClient(env);
  const { period, year, month } = chargePeriod;

  const tenancies = await client.fetchAll(
    TABLES.TENANCIES,
    TenancySchema,
    {
      fields: ['Label', 'Monthly Rent', 'Start Date', 'End Date', 'Due Day'],
      filterByFormula: 'OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))',
    },
  );

  const existing = await client.fetchAll(
    TABLES.CHARGES,
    ChargeSchema,
    {
      fields: ['Label', 'Period', 'Tenancy'],
      filterByFormula: `{Period} = "${period}"`,
    },
  );

  const alreadyCovered = new Set<string>();
  for (const charge of existing) {
    for (const id of charge.fields.Tenancy ?? []) alreadyCovered.add(id);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const tenancy of tenancies) {
    const label = tenancy.fields.Label;

    if (alreadyCovered.has(tenancy.id)) {
      skipped.push(label);
      continue;
    }

    const rent = tenancy.fields['Monthly Rent'] ?? 0;
    const dueDate = resolveDueDate(tenancy.fields, year, month);

    try {
      await client.create(TABLES.CHARGES, ChargeSchema, {
        Label: `${label} ${period} Rent`,
        Tenancy: [tenancy.id],
        Type: 'Rent',
        Period: period,
        'Due Date': dueDate,
        Amount: rent,
      });
      created.push(`${label} → due ${dueDate}`);
    } catch (e) {
      const msg = `${label}: ${(e as Error).message}`;
      errors.push(msg);
      console.error(`[charge error] ${msg}`);
    }
  }

  const discordOk = await notifyDiscord(
    env.DISCORD_WEBHOOK_URL,
    period,
    created,
    skipped,
    errors,
  );

  if (errors.length > 0) {
    console.error(`[${period}] ERRORS:\n${errors.join('\n')}`);
  }
  console.log(
    `[${period}] created=${created.length} skipped=${skipped.length} errors=${errors.length} discord=${discordOk}`,
  );
}
