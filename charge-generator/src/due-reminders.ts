import {
  AirtableClient,
  TABLES,
} from '@rent/airtable-client';
import { z } from 'zod';

export interface DueReminderEnv {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  DISCORD_WEBHOOK_URL: string;
}

const DUE_SOON_FORMULA = [
  'AND(',
  '{Due Date} != BLANK(),',
  "IS_AFTER({Due Date}, DATEADD(TODAY(), -1, 'days')),",
  "IS_BEFORE({Due Date}, DATEADD(TODAY(), 8, 'days')),",
  "OR({Status} = BLANK(), {Status} = 'Unpaid', {Status} = 'Partial', {Status} = 'Overdue')",
  ')',
].join('');

const DueReminderChargeSchema = z.object({
  'Due Date': z.string().optional(),
  Status: z.enum(['Unpaid', 'Partial', 'Paid', 'Overdue']).optional(),
});

export async function notifyChargesDueSoon(env: DueReminderEnv): Promise<void> {
  const client = new AirtableClient(env);
  const charges = await client.fetchAll(
    TABLES.CHARGES,
    DueReminderChargeSchema,
    {
      fields: ['Due Date', 'Status'],
      filterByFormula: DUE_SOON_FORMULA,
      'sort[0][field]': 'Due Date',
      'sort[0][direction]': 'asc',
    },
  );

  if (charges.length === 0) {
    console.log('[due reminder] due=0 discord=skipped');
    return;
  }

  const lines = charges.map(({ id, fields }) => {
    const dueDate = fields['Due Date'] ?? 'unknown date';
    const status = fields.Status ?? 'blank';
    return `charge ${id} - due ${dueDate} - status ${status}`;
  });

  const discordOk = await notifyDueSoonDiscord(env.DISCORD_WEBHOOK_URL, lines);
  console.log(`[due reminder] due=${charges.length} discord=${discordOk}`);
}

export async function notifyDueSoonDiscord(
  webhookUrl: string,
  dueCharges: string[],
): Promise<boolean> {
  const embed = {
    title: 'Rent Due Soon',
    color: 0xffbb33,
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: `Due in the next 7 days (${dueCharges.length})`,
        value: fitDiscordField(dueCharges.join('\n')),
        inline: false,
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[Discord] due reminder webhook failed: status=${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[Discord] due reminder webhook threw: ${(e as Error).message}`);
    return false;
  }
}

function fitDiscordField(value: string): string {
  if (value.length <= 1024) return value;
  return `${value.slice(0, 1000)}\n... truncated`;
}
