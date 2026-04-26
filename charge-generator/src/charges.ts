import {
  AirtableClient,
  type AirtableRecord,
  type Charge,
  ChargeSchema,
  TABLES,
  type Tenancy,
  TenancySchema,
} from '@rent/airtable-client';
import { notifyDiscord } from './discord';
import { resolveDueDate } from './due-date';

export interface ChargesEnv {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  DISCORD_WEBHOOK_URL: string;
}

export async function generateCharges(env: ChargesEnv): Promise<void> {
  const client = new AirtableClient(env);

  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const period = `${year}-${month}`;

  let tenancies: AirtableRecord<Tenancy>[];
  let existing: AirtableRecord<Charge>[];
  try {
    tenancies = await client.fetchAll(
      TABLES.TENANCIES,
      TenancySchema,
      {
        fields: ['Label', 'Monthly Rent', 'Start Date', 'End Date', 'Due Day'],
        filterByFormula: 'OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))',
      },
    );

    existing = await client.fetchAll(
      TABLES.CHARGES,
      ChargeSchema,
      {
        fields: ['Label', 'Period', 'Tenancy'],
        filterByFormula: `{Period} = "${period}"`,
      },
    );
  } catch (e) {
    const reason = summarizeAirtableFailure(e);
    const msg = `Airtable read failed${reason ? ` (${reason})` : ''}`;
    console.error(`[${period}] ${msg}`);
    await notifyDiscord(env.DISCORD_WEBHOOK_URL, period, [], [], [msg]);
    throw new Error(msg);
  }

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
      skipped.push(`tenancy ${tenancy.id}`);
      continue;
    }

    const rent = tenancy.fields['Monthly Rent'] ?? 0;
    const dueDate = resolveDueDate(tenancy.fields, year, month);

    try {
      const charge = await client.create(TABLES.CHARGES, ChargeSchema, {
        Label: `${label} ${period} Rent`,
        Tenancy: [tenancy.id],
        Type: 'Rent',
        Period: period,
        'Due Date': dueDate,
        Amount: rent,
      });
      created.push(`tenancy ${tenancy.id} → charge ${charge.id} due ${dueDate}`);
    } catch (e) {
      const reason = summarizeAirtableFailure(e);
      const msg = `tenancy ${tenancy.id}: Airtable create failed${reason ? ` (${reason})` : ''}`;
      errors.push(msg);
      console.error(
        `[charge error] period=${period} tenancy=${tenancy.id} status=${reason ?? 'failed'}`,
      );
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

function summarizeAirtableFailure(e: unknown): string | undefined {
  const message = e instanceof Error ? e.message : String(e);
  return message.match(/\bHTTP\s+\d{3}\b/)?.[0]
    ?? (message.includes('Airtable schema mismatch') ? 'schema mismatch' : undefined);
}
