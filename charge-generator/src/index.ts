// ─────────────────────────────────────────────────────────
// charge-generator/src/index.ts
// Cloudflare Worker — Monthly Rent Charge Generator
// Cron: 0 0 1 * *  (midnight UTC, 1st of each month)
// ─────────────────────────────────────────────────────────

import { buildQS } from './helper';

export interface Env {
  AIRTABLE_TOKEN:       string;  // Personal Access Token
  AIRTABLE_BASE_ID:     string;  // ID of the Airtable base containing Tenancies and Charges tables
  DISCORD_WEBHOOK_URL:  string;  // Discord webhook
}

// ── Table + field constants ───────────────────────────────
const TENANCIES_TABLE = 'tblvVmo12VikITRH6';
const CHARGES_TABLE   = 'tblNCw6ZxspNxiKCu';

const AT_BASE = (env: Env) =>
  `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}`;

const AT_HEADERS = (env: Env) => ({
  'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
  'Content-Type':  'application/json',
});

// ── Types ─────────────────────────────────────────────────
interface AirtableRecord {
  id:     string;
  fields: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────

/** Fetch ALL records from a table, handling Airtable pagination */
async function fetchAllRecords(
  tableId: string,
  params: Record<string, string | string[]>,
  env: Env,
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const res = await fetch(
      `${AT_BASE(env)}/${tableId}?${buildQS(params, offset)}`,
      { headers: AT_HEADERS(env) },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable fetch failed [${tableId}]: ${err}`);
    }

    const data = await res.json() as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

/** Resolve due date — Due Day field overrides, falls back to Start Date day */
function resolveDueDate(
  fields: Record<string, unknown>,
  year: number,
  month: string,
): string {
  const overrideDay = fields['Due Day'] as number | null;
  if (overrideDay && overrideDay >= 1 && overrideDay <= 28) {
    return `${year}-${month}-${String(overrideDay).padStart(2, '0')}`;
  }

  const startDate = fields['Start Date'] as string | null;
  if (startDate) {
    const day = new Date(startDate).getUTCDate();
    const safeDay = Math.min(day, 28);
    return `${year}-${month}-${String(safeDay).padStart(2, '0')}`;
  }

  return `${year}-${month}-01`; // last resort
}

/** Post a summary embed to Discord */
async function notifyDiscord(
  webhookUrl: string,
  period: string,
  created: string[],
  skipped: string[],
  errors: string[],
): Promise<boolean> {                                    // ← was void
  const colour = errors.length > 0 ? 0xFF4444
               : created.length > 0 ? 0x00C851
               : 0xFFBB33;

  const embed = {
    title:     `🏠 Rent Charges — ${period}`,
    color:     colour,
    timestamp: new Date().toISOString(),
    fields: [
      {
        name:   `✅ Created (${created.length})`,
        value:  created.length ? created.join('\n') : '—',
        inline: false,
      },
      {
        name:   `⏭ Already existed (${skipped.length})`,
        value:  skipped.length ? skipped.join('\n') : '—',
        inline: false,
      },
      ...(errors.length ? [{
        name:   `❌ Errors (${errors.length})`,
        value:  errors.join('\n'),
        inline: false,
      }] : []),
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[Discord] webhook failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[Discord] webhook threw: ${(e as Error).message}`);
    return false;
  }
}

// ── Core logic ────────────────────────────────────────────
async function generateCharges(env: Env): Promise<void> {
  const now    = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const year   = next.getUTCFullYear();
  const month  = String(next.getUTCMonth() + 1).padStart(2, '0');
  const period = `${year}-${month}`;

  // 1. Fetch active tenancies — filter out ended ones at API level
  const tenancies = await fetchAllRecords(
    TENANCIES_TABLE,
    {
      fields: ['Label', 'Monthly Rent', 'Start Date', 'End Date', 'Due Day'],
      // Only records where End Date is blank OR End Date >= today
      filterByFormula: `OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))`,
    },
    env,
  );

  // 2. Idempotency — fetch existing charges for this period
  const existing = await fetchAllRecords(
    CHARGES_TABLE,
    {
      fields:          ['Period', 'Tenancy'],
      filterByFormula: `{Period} = "${period}"`,
    },
    env,
  );

  const alreadyCovered = new Set<string>();
  for (const charge of existing) {
    const linked = charge.fields['Tenancy'] as string[] | null;
    if (linked) linked.forEach(id => alreadyCovered.add(id));
  }

  // 3. Create missing charges
  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  for (const tenancy of tenancies) {
    const label = tenancy.fields['Label'] as string;

    if (alreadyCovered.has(tenancy.id)) {
      skipped.push(label);
      continue;
    }

    const rent    = (tenancy.fields['Monthly Rent'] as number) ?? 0;
    const dueDate = resolveDueDate(tenancy.fields, year, month);

    try {
      const res = await fetch(
        `${AT_BASE(env)}/${CHARGES_TABLE}`,
        {
          method:  'POST',
          headers: AT_HEADERS(env),
          body: JSON.stringify({
            fields: {
              'Label'   : `${label} ${period} Rent`,
              'Tenancy' : [tenancy.id],
              'Type'    : 'Rent',
              'Period'  : period,
              'Due Date': dueDate,
              'Amount'  : rent,
            },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      created.push(`${label} → due ${dueDate}`);
    } catch (e) {
      const msg = `${label}: ${(e as Error).message}`;
      errors.push(msg);
      console.error(`[charge error] ${msg}`);    // ← NEW: now visible in CF logs
    }
  }

  // 4. Discord notification
  const discordOk = await notifyDiscord(
    env.DISCORD_WEBHOOK_URL,
    period,
    created,
    skipped,
    errors,
  );

  // 5. Log for CF dashboard
  // Full error detail always lands in CF logs regardless of Discord
  if (errors.length > 0) {
    console.error(`[${period}] ERRORS:\n${errors.join('\n')}`);
  }
  console.log(
    `[${period}] created=${created.length} skipped=${skipped.length} errors=${errors.length} discord=${discordOk}`
  );
}

// ── Entry point ───────────────────────────────────────────
export default {
  // Cron trigger
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await generateCharges(env);
  },

  // HTTP trigger for manual runs + testing
  // GET https://charge-generator.<your-subdomain>.workers.dev/run
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      await generateCharges(env);
      return new Response('Done — check Discord', { status: 200 });
    }
    return new Response('charge-generator is running', { status: 200 });
  },
};