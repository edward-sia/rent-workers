# Payment Bot Reminder Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/reminder` Telegram command that lists overdue rent charges plus charges due in the next 14 days, grouped by tenant without collapsing multiple months of debt.

**Architecture:** Extract outstanding-charge query and grouping logic from `payment-worker/src/bot.ts` into focused payment-worker modules. `/pay` and `/reminder` share the outstanding-charge filter rules, while `reminder.ts` owns concise Telegram Markdown formatting and message splitting. All Airtable I/O continues through `@rent/airtable-client`.

**Tech Stack:** TypeScript, Cloudflare Workers, grammy, `@rent/airtable-client`, Zod, Vitest, `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-05-18-payment-bot-reminder-design.md`

---

## Implementation Status

Implemented in branch `codex/payment-bot-reminder`.

Fresh verification completed:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:staging
npm run build:production
```

---

## Pre-Implementation Notes

- Start from current `origin/main`, not the stale local `main` observed during planning.
- Preserve the untracked `security_best_practices_report.md` unless the user explicitly asks to remove or stage it.
- `origin/main` includes the `ChargeSchema` fix that accepts `Status: "Due"`; the implementation branch must include it.
- No live Airtable API calls are allowed in tests. Mock Airtable and Telegram HTTP calls.

Recommended branch setup:

```bash
git fetch origin
git switch -c codex/payment-bot-reminder origin/main
```

If the branch already exists locally, switch to it and rebase it onto `origin/main`.

---

## File Structure

Create:

- `payment-worker/src/outstanding.ts`
  - Normalizes charge records into reminder-ready rows.
  - Filters outstanding charges into `pay_now` and `due_soon`.
  - Groups charge rows by tenant without dropping multiple charges.

- `payment-worker/src/reminder.ts`
  - Formats grouped rows into concise Telegram Markdown messages.
  - Splits long output into multiple messages at safe section or tenant boundaries.

- `payment-worker/test/outstanding.test.ts`
  - Node-unit tests for filter, bucket, sort, and grouping rules.

- `payment-worker/test/reminder.test.ts`
  - Node-unit tests for concise formatting, escaping, totals, and splitting.

- `payment-worker/test/integration/reminder.test.ts`
  - Worker-pool integration tests for the Telegram `/reminder` command.

- `payment-worker/AGENTS.md`
  - Worker-specific agent notes for payment bot behavior, tests, and docs.

Modify:

- `payment-worker/src/bot.ts`
  - Add `/reminder`.
  - Add `/reminder` to help text.
  - Reuse `fetchReminderBuckets` for `/reminder` and `listOutstandingChargesForTenancy` in the `/pay` tenancy callback.

- `payment-worker/README.md`
  - Document `/reminder`, file layout, tests, and operational notes.

- `README.md`
  - Mention that `payment-worker` can show overdue and next-14-day outstanding payments.

- `docs/runbook.md`
  - Add troubleshooting for missing or incorrect `/reminder` output.

- `AGENTS.md`
  - Mention payment-worker owns Telegram payment recording and the read-only reminder command.

- `CLAUDE.md`
  - Keep agent-facing guidance aligned with `AGENTS.md`.

---

## Task 1: Add Outstanding-Charge Domain Logic

**Files:**

- Create: `payment-worker/test/outstanding.test.ts`
- Create: `payment-worker/src/outstanding.ts`

- [ ] **Step 1: Write failing tests for charge-level filtering and grouping**

Create `payment-worker/test/outstanding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AirtableRecord, Charge, Tenancy } from '@rent/airtable-client';
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
        charge('recC1', { Label: 'March Rent', Balance: 1650, Status: 'Overdue', 'Due Date': '2026-03-05', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('recC2', { Label: 'April Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': '2026-04-05', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('recC3', { Label: 'May Rent', Balance: 1650, Status: 'Partial', 'Due Date': '2026-05-05', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('recC4', { Label: 'June Rent', Balance: 1650, Status: 'Due', 'Due Date': '2026-06-01', Tenancy: ['recT1'], Type: 'Rent' }),
      ],
    });

    expect(result.payNow.map((row) => row.chargeId)).toEqual(['recC1', 'recC2', 'recC3']);
    expect(result.dueSoon.map((row) => row.chargeId)).toEqual(['recC4']);
    expect(result.payNowTotal).toBe(4950);
    expect(result.dueSoonTotal).toBe(1650);
  });

  it('excludes paid, zero-balance, missing-date, and outside-window charges', () => {
    const result = bucketOutstandingCharges({
      today,
      horizonDays: 14,
      tenancies,
      charges: [
        charge('paid', { Label: 'Paid Rent', Balance: 100, Status: 'Paid', 'Due Date': '2026-05-01', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('zero', { Label: 'Zero Rent', Balance: 0, Status: 'Unpaid', 'Due Date': '2026-05-01', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('missing-date', { Label: 'Missing Date', Balance: 100, Status: 'Unpaid', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('future', { Label: 'Future Rent', Balance: 100, Status: 'Unpaid', 'Due Date': '2026-06-10', Tenancy: ['recT1'], Type: 'Rent' }),
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
        charge('recC1', { Label: 'May Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': '2026-05-05', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('recC2', { Label: 'June Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': '2026-06-01', Tenancy: ['recT1'], Type: 'Rent' }),
        charge('recC3', { Label: 'Jane Rent', Balance: 1800, Status: 'Unpaid', 'Due Date': '2026-06-01', Tenancy: ['recT2'], Type: 'Rent' }),
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

  it('keeps /pay tenancy charge selection charge-level and sorted by due date', () => {
    const rows = listOutstandingChargesForTenancy([
      charge('recC2', { Label: 'June Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': '2026-06-01', Tenancy: ['recT1'], Type: 'Rent' }),
      charge('recC1', { Label: 'May Rent', Balance: 1650, Status: 'Due', 'Due Date': '2026-05-05', Tenancy: ['recT1'], Type: 'Rent' }),
      charge('recC3', { Label: 'Other Tenant Rent', Balance: 1800, Status: 'Unpaid', 'Due Date': '2026-05-05', Tenancy: ['recT2'], Type: 'Rent' }),
    ], 'recT1');

    expect(rows.map((row) => row.id)).toEqual(['recC1', 'recC2']);
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
npm run test -- payment-worker/test/outstanding.test.ts
```

Expected: fail because `payment-worker/src/outstanding.ts` does not exist.

- [ ] **Step 3: Implement `payment-worker/src/outstanding.ts`**

```ts
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

  return [...groups.values()].sort((a, b) => a.tenantLabel.localeCompare(b.tenantLabel));
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
```

- [ ] **Step 4: Run the outstanding unit test**

Run:

```bash
npm run test -- payment-worker/test/outstanding.test.ts
```

Expected: pass.

---

## Task 2: Add Reminder Message Formatting

**Files:**

- Create: `payment-worker/test/reminder.test.ts`
- Create: `payment-worker/src/reminder.ts`

- [ ] **Step 1: Write failing tests for concise formatting and splitting**

Create `payment-worker/test/reminder.test.ts`:

```ts
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
        { chargeId: 'recC1', tenancyId: 'recT1', tenantLabel: '6B Sun Peng', chargeLabel: 'March', rowLabel: '2026-03-05 Rent', dueDate: '2026-03-05', status: 'Overdue', balance: 1650, bucket: 'pay_now' },
        { chargeId: 'recC2', tenancyId: 'recT1', tenantLabel: '6B Sun Peng', chargeLabel: 'April', rowLabel: '2026-04-05 Rent', dueDate: '2026-04-05', status: 'Unpaid', balance: 1650, bucket: 'pay_now' },
        { chargeId: 'recC3', tenancyId: 'recT1', tenantLabel: '6B Sun Peng', chargeLabel: 'May', rowLabel: '2026-05-05 Rent', dueDate: '2026-05-05', status: 'Partial', balance: 1650, bucket: 'pay_now' },
      ],
      dueSoon: [
        { chargeId: 'recC4', tenancyId: 'recT1', tenantLabel: '6B Sun Peng', chargeLabel: 'June', rowLabel: '2026-06-01 Rent', dueDate: '2026-06-01', status: 'Due', balance: 1650, bucket: 'due_soon' },
      ],
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Pay now - subtotal $4,950.00');
    expect(messages[0]).toContain('6B Sun Peng - subtotal $4,950.00');
    expect(messages[0]).toContain('• 2026-03-05 Rent · $1,650.00');
    expect(messages[0]).toContain('Due in next 14 days - subtotal $1,650.00');
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
        { chargeId: 'recC1', tenancyId: 'recT1', tenantLabel: '6B A_B [VIP]', chargeLabel: 'X', rowLabel: '2026-03-05 Rent_[x]', dueDate: '2026-03-05', status: 'Unpaid', balance: 100, bucket: 'pay_now' },
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
```

- [ ] **Step 2: Run the formatter test and confirm it fails**

Run:

```bash
npm run test -- payment-worker/test/reminder.test.ts
```

Expected: fail because `payment-worker/src/reminder.ts` does not exist.

- [ ] **Step 3: Implement `payment-worker/src/reminder.ts`**

```ts
import { escapeTelegramMarkdown, formatAUD } from './format';
import {
  groupReminderChargesByTenant,
  type ReminderBuckets,
  type ReminderCharge,
  type ReminderTenantGroup,
} from './outstanding';

const TELEGRAM_SAFE_MESSAGE_LENGTH = 3900;

export interface FormatReminderOptions {
  maxMessageLength?: number;
}

export function formatReminderMessages(
  buckets: ReminderBuckets,
  options: FormatReminderOptions = {},
): string[] {
  const maxMessageLength = options.maxMessageLength ?? TELEGRAM_SAFE_MESSAGE_LENGTH;
  const blocks: string[] = [];

  addSection(blocks, 'Pay now', buckets.payNowTotal, groupReminderChargesByTenant(buckets.payNow));
  addSection(blocks, 'Due in next 14 days', buckets.dueSoonTotal, groupReminderChargesByTenant(buckets.dueSoon));

  if (blocks.length === 0) {
    return ['No overdue payments or payments due in the next 14 days.'];
  }

  return splitBlocks(blocks, maxMessageLength);
}

function addSection(
  blocks: string[],
  title: string,
  total: number,
  groups: ReminderTenantGroup[],
): void {
  if (groups.length === 0) return;

  blocks.push(`${title} - subtotal ${escapeTelegramMarkdown(formatAUD(total))}`);
  for (const group of groups) {
    blocks.push(formatTenantGroup(group));
  }
}

function formatTenantGroup(group: ReminderTenantGroup): string {
  const lines = [
    `${escapeTelegramMarkdown(group.tenantLabel)} - subtotal ${escapeTelegramMarkdown(formatAUD(group.subtotal))}`,
    ...group.charges.map(formatChargeRow),
  ];
  return lines.join('\n');
}

function formatChargeRow(charge: ReminderCharge): string {
  return `• ${escapeTelegramMarkdown(charge.rowLabel)} · ${escapeTelegramMarkdown(formatAUD(charge.balance))}`;
}

function splitBlocks(blocks: string[], maxLength: number): string[] {
  const messages: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (block.length > maxLength) {
      if (current) {
        messages.push(current);
        current = '';
      }
      messages.push(...splitLargeBlock(block, maxLength));
      continue;
    }

    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxLength && current) {
      messages.push(current);
      current = block;
    } else {
      current = next;
    }
  }

  if (current) messages.push(current);
  return messages;
}

function splitLargeBlock(block: string, maxLength: number): string[] {
  const lines = block.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: Run the formatter test**

Run:

```bash
npm run test -- payment-worker/test/reminder.test.ts
```

Expected: pass.

---

## Task 3: Wire `/reminder` Into the Telegram Bot

**Files:**

- Modify: `payment-worker/src/bot.ts`
- Create: `payment-worker/test/integration/reminder.test.ts`

- [ ] **Step 1: Write integration tests for `/reminder`**

Create `payment-worker/test/integration/reminder.test.ts` using the existing `payment-worker/test/integration/wizard.test.ts` helper style:

```ts
import { SELF, env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';

const AIRTABLE_ORIGIN = 'https://api.airtable.com';
const TELEGRAM_ORIGIN = 'https://api.telegram.org';
const SECRET = 'a'.repeat(32);
const USER_ID = 1234;
const TENANCIES = 'tblvVmo12VikITRH6';
const CHARGES = 'tblNCw6ZxspNxiKCu';
const testEnv = env as unknown as Env;

interface MockReplyOptions {
  body?: unknown;
}

beforeEach(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await testEnv.SESSION_KV.delete(`session:${USER_ID}`);
});

afterEach(() => {
  fetchMock.deactivate();
});

function telegramUpdate(body: object): Promise<Response> {
  return SELF.fetch('https://worker.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': SECRET,
    },
    body: JSON.stringify(body),
  });
}

function messageUpdate(updateId: number, text: string, userId = USER_ID): object {
  const commandLength = text.startsWith('/') ? text.split(/\s/, 1)[0]?.length ?? text.length : 0;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: 'private' },
      from: { id: userId, is_bot: false, first_name: 'Operator' },
      text,
      ...(commandLength > 0
        ? { entities: [{ offset: 0, length: commandLength, type: 'bot_command' }] }
        : {}),
    },
  };
}

function parseBody(body: unknown): any {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return Object.fromEntries(new URLSearchParams(body));
    }
  }
  if (body instanceof ArrayBuffer) return parseBody(new TextDecoder().decode(body));
  if (body instanceof Uint8Array) return parseBody(new TextDecoder().decode(body));
  throw new Error(`Unexpected mock body: ${String(body)}`);
}

function stubTelegram(times = 10): any[] {
  const payloads: any[] = [];
  fetchMock
    .get(TELEGRAM_ORIGIN)
    .intercept({ path: /.*/, method: 'POST' })
    .reply((opts: MockReplyOptions) => {
      payloads.push(parseBody(opts.body));
      return { statusCode: 200, data: { ok: true, result: {} } };
    })
    .times(times);
  return payloads;
}

function mockTenancies(): void {
  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
    .reply(200, {
      records: [
        { id: 'recT1', fields: { Label: '6B Sun Peng' } },
      ],
    });
}

function mockCharges(): void {
  const today = todayISOInMelbourne();
  const overdueOne = addDaysISO(today, -74);
  const overdueTwo = addDaysISO(today, -43);
  const overdueThree = addDaysISO(today, -13);
  const dueSoon = addDaysISO(today, 2);
  const paidDueSoon = addDaysISO(today, 3);

  fetchMock
    .get(AIRTABLE_ORIGIN)
    .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
    .reply(200, {
      records: [
        { id: 'recC1', fields: { Label: 'March Rent', Balance: 1650, Status: 'Overdue', 'Due Date': overdueOne, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recC2', fields: { Label: 'April Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': overdueTwo, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recC3', fields: { Label: 'May Rent', Balance: 1650, Status: 'Partial', 'Due Date': overdueThree, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recC4', fields: { Label: 'June Rent', Balance: 1650, Status: 'Due', 'Due Date': dueSoon, Tenancy: ['recT1'], Type: 'Rent' } },
        { id: 'recPaid', fields: { Label: 'Paid Rent', Balance: 1650, Status: 'Paid', 'Due Date': paidDueSoon, Tenancy: ['recT1'], Type: 'Rent' } },
      ],
    });
}

function todayISOInMelbourne(): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
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

function addDaysISO(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('/reminder command', () => {
  it('lists overdue and due-soon charges without changing the wizard session', async () => {
    const telegramPayloads = stubTelegram(1);
    await testEnv.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify({ step: 'enter_amount', chargeId: 'recOld' }), {
      expirationTtl: 3600,
    });
    mockTenancies();
    mockCharges();

    const res = await telegramUpdate(messageUpdate(1, '/reminder'));

    expect(res.status).toBe(200);
    expect(JSON.parse((await testEnv.SESSION_KV.get(`session:${USER_ID}`)) ?? '{}')).toEqual({
      step: 'enter_amount',
      chargeId: 'recOld',
    });
    const text = String(telegramPayloads[0].text);
    expect(text).toContain('Pay now - subtotal $4,950.00');
    expect(text).toContain('6B Sun Peng - subtotal $4,950.00');
    expect(text).toContain('Rent');
    expect(text).toContain('Due in next 14 days - subtotal $1,650.00');
    expect(text).toContain('6B Sun Peng - subtotal $1,650.00');
    expect(text).not.toContain('Paid Rent');
  });

  it('rejects non-authorized users before reading Airtable', async () => {
    const telegramPayloads = stubTelegram(1);

    const res = await telegramUpdate(messageUpdate(2, '/reminder', 999));

    expect(res.status).toBe(200);
    expect(telegramPayloads.some((payload) => String(payload.text).includes('Unauthorised'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test and confirm it fails**

Run:

```bash
npm run test -- payment-worker/test/integration/reminder.test.ts
```

Expected: fail because `/reminder` is not registered.

- [ ] **Step 3: Update `payment-worker/src/bot.ts` imports**

Add imports:

```ts
import { fetchReminderBuckets, listOutstandingChargesForTenancy } from './outstanding';
import { formatReminderMessages } from './reminder';
```

- [ ] **Step 4: Update help text**

Change help text to include:

```ts
`/pay — Record a tenant payment\n` +
`/reminder — Show overdue and next-14-day outstanding payments\n` +
`/cancel — Cancel current operation`
```

- [ ] **Step 5: Add the `/reminder` command**

Add after `/cancel`:

```ts
bot.command('reminder', async (ctx) => {
  try {
    const buckets = await fetchReminderBuckets(env);
    for (const message of formatReminderMessages(buckets)) {
      await ctx.reply(message, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    console.error(`[payment-bot] reminder failed: ${e instanceof Error ? e.message : String(e)}`);
    await ctx.reply('Failed to load reminders. Check Worker logs for the Airtable error.');
  }
});
```

- [ ] **Step 6: Reuse charge filtering in the `/pay` tenancy callback**

Replace the existing chained filter/sort:

```ts
const charges = allCharges
  .filter(charge => charge.fields.Tenancy?.includes(tenancyId))
  .sort((a, b) => String(a.fields['Due Date'] ?? '').localeCompare(String(b.fields['Due Date'] ?? '')));
```

with:

```ts
const charges = listOutstandingChargesForTenancy(allCharges, tenancyId);
```

- [ ] **Step 7: Run the reminder integration test**

Run:

```bash
npm run test -- payment-worker/test/integration/reminder.test.ts
```

Expected: pass.

- [ ] **Step 8: Run existing payment-worker integration tests**

Run:

```bash
npm run test -- payment-worker/test/integration/wizard.test.ts payment-worker/test/integration/webhook.test.ts
```

Expected: pass. `/pay` still lists all non-paid charge rows for a tenant.

---

## Task 4: Update Documentation and Agent Notes

**Files:**

- Create: `payment-worker/AGENTS.md`
- Modify: `payment-worker/README.md`
- Modify: `README.md`
- Modify: `docs/runbook.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create `payment-worker/AGENTS.md`**

```md
# payment-worker Agent Notes

This Worker owns the Telegram payment bot.

- `/pay` records tenant payments through the wizard and writes Payment records to Airtable.
- `/reminder` is read-only and shows overdue plus next-14-day outstanding charges.
- Keep Airtable access through `@rent/airtable-client`; do not add one-off fetch helpers.
- Keep linked-record filtering client-side when matching Charges to Tenancies.
- `/reminder` must remain charge-level: a tenant can have multiple overdue months and can appear in both reminder sections.
- Update `payment-worker/README.md`, root `README.md`, `docs/runbook.md`, root `AGENTS.md`, and `CLAUDE.md` when bot commands or operational behavior change.
```

- [ ] **Step 2: Update `payment-worker/README.md` commands table**

Add:

```md
| `/reminder` | Show overdue payments and payments due in the next 14 days |
```

- [ ] **Step 3: Update `payment-worker/README.md` file layout**

Add under `src/`:

```text
  outstanding.ts -- outstanding charge filtering, grouping, and reminder bucket rules
  reminder.ts    -- Telegram Markdown reminder formatting and message splitting
```

- [ ] **Step 4: Update `payment-worker/README.md` operational notes**

Add:

```md
- `/reminder` is read-only: it does not create Payment records and does not mutate the wizard session.
- `/reminder` lists every outstanding charge, not one row per tenant, so tenants more than one month behind show every unpaid month.
- Reminder output has two buckets: overdue charges under "Pay now" and charges due from today through the next 14 days under "Due in next 14 days".
```

- [ ] **Step 5: Update root `README.md` layout table**

Change the `payment-worker` row to:

```md
| [`payment-worker/`](./payment-worker/) | Telegram webhook Worker for recording tenant payments and querying overdue/upcoming outstanding payments | Productionized |
```

- [ ] **Step 6: Update `docs/runbook.md`**

Add a section after "Telegram bot returns 401 or stops responding":

```md
## `/reminder` output is empty or incorrect

`/reminder` reads Airtable Charges and Tenancies through `@rent/airtable-client`. It includes charges with positive `Balance`, non-`Paid` status, and a `Due Date` that is either before today or from today through the next 14 days.

Check:

1. The charge has a positive `Balance`.
2. The charge `Status` is `Due`, `Unpaid`, `Partial`, `Overdue`, or blank. `Paid` charges are intentionally hidden.
3. The charge has a valid `Due Date`.
4. The charge has a linked `Tenancy` record, and that tenancy still exists.
5. `AIRTABLE_TOKEN` can read both Charges and Tenancies.

If Airtable field names or status values changed, update `packages/airtable-client/src/schemas.ts`, the schema check script, tests, and this runbook together.
```

- [ ] **Step 7: Update root `AGENTS.md` and `CLAUDE.md`**

Add or adjust guidance to say:

```md
`payment-worker` owns the Telegram payment-recording webhook, the `/pay` wizard, the read-only `/reminder` outstanding-payment summary, and its staging KV binding.
```

- [ ] **Step 8: Run docs grep to confirm command references**

Run:

```bash
rg -n "/reminder|outstanding-payment|outstanding payment|next 14" README.md AGENTS.md CLAUDE.md docs payment-worker
```

Expected: output includes the command in user-facing docs, worker docs, runbook, and agent notes.

---

## Task 5: Full Verification

**Files:**

- No new files.

- [ ] **Step 1: Run TypeScript typecheck**

Run:

```bash
npm run typecheck
```

Expected: all workspaces pass.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 3: Run all tests**

Run:

```bash
npm run test
```

Expected: all tests pass. Existing Cloudflare compatibility-date warnings may appear; they are documented in `docs/runbook.md`.

- [ ] **Step 4: Run build dry-runs**

Run:

```bash
npm run build
```

Expected: both workers dry-run deploy successfully.

- [ ] **Step 5: Run staging and production build dry-runs**

Run:

```bash
npm run build:staging
npm run build:production
```

Expected: staging and production environment dry-runs succeed.

- [ ] **Step 6: Review git diff**

Run:

```bash
git diff --stat
git diff -- payment-worker/src/bot.ts payment-worker/src/outstanding.ts payment-worker/src/reminder.ts
git diff -- payment-worker/README.md payment-worker/AGENTS.md README.md docs/runbook.md AGENTS.md CLAUDE.md
```

Expected: diff only contains reminder-command implementation, shared outstanding-charge refactor, tests, and matching docs.

---

## Completion Criteria

- `/reminder` shows overdue charges plus charges due in the next 14 days.
- A tenant can appear in both sections.
- A tenant owing multiple months shows every outstanding charge row.
- `Balance` drives inclusion and totals.
- `/reminder` does not mutate KV session state.
- Existing `/pay` flow still works.
- Docs and agent notes are aligned with behavior.
- Repo-root verification passes.
