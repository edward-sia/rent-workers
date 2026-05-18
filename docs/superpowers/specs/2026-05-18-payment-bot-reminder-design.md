# Payment Bot Reminder Command - Design Spec

**Date:** 2026-05-18
**Status:** Implemented in branch `codex/payment-bot-reminder`
**Scope:** `payment-worker`
**Goal:** Add a `/reminder` Telegram command that shows outstanding rent charges that are overdue or due within the next 14 days.

---

## 1. Current Context

`payment-worker` is the Telegram webhook Worker for recording tenant payments. It already reads active tenancies and outstanding charges during the `/pay` wizard, but that logic is embedded in `payment-worker/src/bot.ts`.

The new command should be read-only. It must not create Airtable records, mutate the payment wizard session, or change charge-generator cron behavior.

Before implementation, start from current `origin/main`. The local checkout used for this spec was behind `origin/main` by four commits, including the merged `ChargeSchema` update that accepts Airtable `Status: "Due"`. The implementation branch should include that status support.

---

## 2. User-Facing Behavior

`/reminder` returns outstanding payments in two top-level sections:

1. `Pay now`
   - Includes every outstanding charge with `Due Date < today`.
   - This covers tenants who are one or more months behind.
   - Sort oldest due date first.

2. `Due in next 14 days`
   - Includes every outstanding charge with `today <= Due Date <= today + 14 days`.
   - Sort nearest due date first.

A charge can appear in only one section. A tenant can appear in both sections when they have overdue debt and another upcoming charge.

Within each section, tenant groups are ordered by their earliest due date, and charge rows inside each tenant group are also ordered by due date.

Example output:

```text
Pay now - subtotal $4,950.00

6B Sun Peng - subtotal $4,950.00
• 2026-03-05 Rent · $1,650.00
• 2026-04-05 Rent · $1,650.00
• 2026-05-05 Rent · $1,650.00

Due in next 14 days - subtotal $1,650.00

6B Sun Peng - subtotal $1,650.00
• 2026-06-05 Rent · $1,650.00
```

The section name communicates urgency. Row text should stay concise and must not repeat the same date twice in one row.

---

## 3. Inclusion Rules

Use charge-level filtering. Do not collapse a tenant to one row before filtering.

```ts
isOutstanding = status !== 'Paid' && balance > 0
isOverdue = dueDate < today
isDueSoon = dueDate >= today && dueDate <= todayPlus14
include = isOutstanding && (isOverdue || isDueSoon)
bucket = isOverdue ? 'pay_now' : 'due_soon'
```

Outstanding statuses are:

- `Due`
- `Unpaid`
- `Partial`
- `Overdue`
- blank or missing status

`Paid` charges are excluded. Charges with missing or invalid `Due Date` are excluded from the first implementation so the command stays focused on time-sensitive payments. Airtable schema drift continues to be handled by the shared schema and schema-check workflow.

Use `Balance`, not `Amount`, for inclusion and totals. This accounts for partial payments.

Compute `today` in the rent operating timezone, `Australia/Melbourne`, then compare Airtable date-only values as `YYYY-MM-DD` strings. Tests should inject or construct deterministic dates instead of depending on the wall-clock date.

---

## 4. Data Flow

`/reminder` should fetch:

- `Charges`: `Label`, `Balance`, `Status`, `Due Date`, `Tenancy`, `Type`
- `Tenancies`: `Label`

The charge's `Tenancy` field is a linked-record ID array, so the formatter needs a tenancy ID to label map. If a charge references an unknown tenancy, fall back to the tenancy record ID or `Unknown tenancy`.

Keep linked-record matching client-side. This matches the existing `payment-worker` behavior and avoids fragile Airtable formulas on linked-record display values.

---

## 5. Refactoring Boundary

Create a small outstanding-charge domain module and keep `bot.ts` focused on Telegram routing.

Proposed files:

- `payment-worker/src/outstanding.ts`
  - Fetch and normalize outstanding charge records.
  - Filter into overdue and next-14-day buckets.
  - Group by tenant while preserving one row per charge.

- `payment-worker/src/reminder.ts`
  - Format reminder sections for Telegram Markdown.
  - Split long output into multiple messages if needed.

Update `payment-worker/src/bot.ts` to:

- Add `/reminder`.
- Add `/reminder` to `/help`.
- Reuse outstanding-charge helpers in the existing `/pay` charge-selection flow where practical.
- Avoid changing KV session state when `/reminder` is called.

Do not add a new Worker, cron, Durable Object, queue, or Airtable table.

---

## 6. Telegram Formatting

Use Markdown mode and escape Airtable-provided values with the existing Telegram escape helper.

Rows should use this shape:

```text
• 2026-03-05 Rent · $1,650.00
```

Derive the label as:

1. `Due Date + " " + Type` when `Type` exists.
2. `Due Date + " Rent"` when `Type` is missing.
3. Fallback to the charge `Label` when `Due Date` is unavailable for a future extension.

If Telegram output approaches the message limit, split at section or tenant boundaries. Do not split a single tenant block across messages unless the tenant block alone exceeds the limit.

---

## 7. Error Handling

If Airtable reads fail, let the command reply with a concise failure message and log the underlying error:

```text
Failed to load reminders. Check Worker logs for the Airtable error.
```

Do not expose Airtable tokens, raw response bodies, tenant notes, or large schema error dumps in Telegram.

Unauthorized Telegram users should continue to be blocked by the existing `AUTHORIZED_USER_ID` middleware.

---

## 8. Tests

Add tests before implementation changes.

Required coverage:

- A tenant with three overdue charges and one due-soon charge appears with all four charges, split across the two sections.
- The same tenant can appear in both top-level sections with different subtotals.
- `Paid` charges are excluded.
- `Partial` charges use `Balance` for totals.
- `Due` status is accepted.
- Missing or zero balance charges are excluded.
- `/reminder` does not write or clear the KV wizard session.
- Markdown escaping protects Airtable labels.
- Long reminder output is split into multiple Telegram messages at safe boundaries.

All Airtable and Telegram calls in tests must be mocked. Tests must not hit the live Airtable API.

---

## 9. Documentation

Update docs in the same implementation change:

- `payment-worker/README.md`: commands table, file layout, testing coverage, operational notes.
- `payment-worker/AGENTS.md`: create worker-specific notes if absent.
- `README.md`: mention that `payment-worker` can query upcoming and overdue payments.
- `docs/runbook.md`: add troubleshooting for empty or incorrect `/reminder` output.
- `AGENTS.md` and `CLAUDE.md`: keep agent-facing guidance aligned.

---

## 10. Verification

Run from repo root:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

After syncing current `origin/main`, also verify:

```bash
npm run build:staging
npm run build:production
```
