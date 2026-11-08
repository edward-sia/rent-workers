# Telegram Move-In and Move-Out Commands - Design Spec

**Date:** 2026-11-07
**Status:** Design agreed, not implemented
**Scope:** new `packages/tenancy`, `packages/airtable-client`, `payment-worker`, `charge-generator`, `scripts/check-airtable-schema.ts`
**Goal:** Let the operator end a tenancy and start a new one from Telegram, without opening Airtable.

---

## 1. Current Context

`payment-worker` has `/pay`, `/reminder`, `/cancel`, `/start` and `/help`. Only `AUTHORIZED_USER_ID` can use it. Multi-step flows keep their state in KV under `session:<userId>`, so one flow runs at a time.

A tenancy is "active" when `End Date` is blank or after today. `/pay` and `charge-generator` both use this rule.

`charge-generator` runs at 00:00 UTC on the 15th. It creates next month's rent charge for every active tenancy and skips a tenancy that already has a charge for that `Period`. It never prorates. It does not check `Start Date` or `End Date` against the charge's due date.

`@rent/airtable-client` can only `fetchAll` and `create`. It cannot update records.

### Airtable data model

| Table | ID | Fields this feature uses |
|---|---|---|
| Tenancies | `tblvVmo12VikITRH6` | `Label` (text, typed by hand), `Room` (link), `Tenant` (link), `Start Date`, `End Date`, `Due Day`, `Monthly Rent`, `Frequency` (single select, only `Monthly` in use), `Balance` (formula) |
| Rooms | `tblBrzawaTuwahBQg` | `Code` (text, e.g. `6B-R6`), `Default Rent` (currency), `Status` (single select: `Occupied`, `Vacant`) |
| Tenants | `tblsesIqj1VuokNcP` | `Name` (text), `Notes` (long text) |
| Charges | `tblNCw6ZxspNxiKCu` | `Label`, `Tenancy`, `Type`, `Period`, `Due Date`, `Amount`, `Balance`, `Status` |

`Label` on Tenancies is `{Rooms.Code} {Tenants.Name}`, e.g. `6B-R6 Sun Peng`. `/pay` relies on this: it drops the first word to get the tenant name for payment labels.

Tenants also has `Phone`, `Emergency Contact`, `Languages` and `ID_Documents`. The bot leaves them blank. Contact happens on WeChat.

### Airtable Free plan limits

The workspace is on the Free plan:

- 1,000 public API calls per month across the workspace. About 14 were used by 7 Nov.
- 1,000 records per base. Production holds 599.

Section 9 lists the call and record cost of each flow.

---

## 2. Agreed Decisions

1. Two commands: `/moveout` and `/movein`. When a move-out finishes, the bot offers a button to start a new tenant in the same room.
2. At move-in you choose how the first charge works (section 4.3).
3. No charge is ever created with a due date after `End Date`. Charges that already exist after the end date are listed at move-out, and you fix them in Airtable.
4. ~~Bond is out of scope.~~ Changed on 2026-11-09: `/movein` records the bond as a Bond charge (section 4.6). Refunds at move-out stay manual.
5. If a tenant is added after the 15th, the bot also creates next month's charge, because the generator has already run.
6. The suggested part-month amount is `Monthly Rent × 12 ÷ 365` per day, times the days left in the start month. You can type a different amount.
7. The bot updates Rooms `Status`.
8. The bot writes `Label` as `{Code} {Name}`. `Label` stays a plain text field.
9. At move-in, the bot looks for a Tenants record with the exact name you typed and asks whether to reuse it.

---

## 3. `/moveout` Flow

1. `/moveout` clears any open session and lists active tenancies, sorted by `Label`. Each button shows the label and balance, as `/pay` does. A tenancy that already has a future `End Date` shows "ends YYYY-MM-DD", and picking it changes that date.
2. Pick the end date: **Today**, **End of this month**, or **Enter date**. "Today" uses the `Australia/Melbourne` date. Typed dates accept `YYYY-MM-DD` and `DD/MM/YYYY`, as `/pay` does.
3. The end date must not be before `Start Date`. If it is, the bot says so and asks again.
4. The bot reads the tenancy's charges once and shows a confirm screen:
   - tenant label and room code
   - end date
   - amount still owed on charges due on or before the end date
   - every charge due **after** the end date, with its status and an Airtable link, plus a note to fix these in Airtable
   - whether the room will be marked vacant (step 5)
5. On **Confirm**:
   - PATCH the tenancy's `End Date`.
   - If the end date is today or earlier, PATCH the room's `Status` to `Vacant`. If the end date is in the future, leave the room `Occupied` and say so in the reply.
6. The reply gives Airtable links and a button: **Start new tenant in {Code}**. That button opens `/movein` with the room already picked.

The charges read in step 4 uses one call: `OR(NOT({Status} = "Paid"), IS_AFTER({Due Date}, "<end>"))`. The bot then keeps only this tenancy's charges on its side, following the existing rule that linked-record matching happens in code.

---

## 4. `/movein` Flow

### 4.1 Steps

1. **Room.** List all rooms, vacant ones first, then by `Code`. Skipped when the move-out button supplied the room.
2. **Tenant name.** Type it. The bot searches Tenants for an exact `Name` match, escaping quotes in the formula.
   - Match found: **Use existing** or **Create new**.
   - No match: a new tenant will be created.
3. **Notes (optional).** Type notes for a new tenant, or tap **Skip**. Not asked when reusing a tenant.
4. **Monthly rent.** Tap **Use ${Default Rent}**, or type an amount.
5. **Start date.** **Today**, **1st of next month**, or **Enter date**.
6. **First payment.** Pick one (section 4.3).
7. **Bond.** Tap the suggestion (one month of rent), type an amount, or tap **No bond** (section 4.6).
8. **Confirm screen** lists everything that will be written, including each charge's period, due date and amount. If the room's `Status` is `Occupied`, the screen shows a warning first.

### 4.2 Writes on Confirm, in order

1. Create the Tenants record (`Name`, optional `Notes`), unless reusing one.
2. Create the Tenancies record: `Label`, `Room`, `Tenant`, `Start Date`, `Due Day`, `Monthly Rent`, `Frequency: "Monthly"`.
3. Create the charges from section 4.4.
4. PATCH the room's `Status` to `Occupied`.
5. Create the Bond charge, when there is a bond. It goes last so a failure leaves the rest of the move-in done.

There is no rollback. If a step fails, the reply says which steps succeeded, links the records that were created, and names the step to finish in Airtable. Failure messages show the HTTP status only, never raw Airtable response bodies.

### 4.3 First-payment options

| Option | First charge | `Due Day` |
|---|---|---|
| **Regular monthly from start date** | Full `Monthly Rent`, due on the start date | Start date's day, capped at 28 |
| **Part month, then monthly on the 1st** | Prorated amount, due on the start date, covering start date to month end | 1 |

The part-month option is hidden when the start date is the 1st, because it would be the same as regular monthly.

Part-month suggestion: `round2(Monthly Rent × 12 / 365 × daysLeft)`, where `daysLeft = daysInMonth − startDay + 1`. The operator can tap **Use $X** or type an amount.

The first charge always has `Period` = the start month (`YYYY-MM`). The generator skips any tenancy that already has a charge for a period, so it will never charge that month again.

### 4.4 Which charges the bot creates

The generator runs on the 15th (UTC) and creates next month's charges. So by date `d`, charges exist up to:

```ts
generatedThrough = utcDay(d) >= 15 ? nextMonth(d) : thisMonth(d)
```

The bot creates:

1. The first charge for the start month.
2. A regular charge for each month after the start month, up to and including `generatedThrough`.

Regular charges use the same label, `Type`, `Period` and due-date rules as the generator.

Examples (today → start date):

| Today | Start | Option | Charges the bot creates |
|---|---|---|---|
| 10 Nov | 20 Nov | regular | Nov (due 20 Nov). The 15 Nov run creates Dec. |
| 18 Nov | 20 Nov | regular | Nov (due 20 Nov) and Dec (due 20 Dec) |
| 18 Nov | 20 Nov | part month | Nov prorated (due 20 Nov) and Dec (due 1 Dec) |
| 10 Nov | 5 Jan | regular | Jan (due 5 Jan). The 15 Nov run skips it because Dec's due date is before the start date (section 5). |

Start dates more than 60 days in the past are rejected, so a typo cannot create a run of back-dated charges.

### 4.5 Shared charge rules

The label (`{Label} {YYYY-MM} Rent`), `Type: "Rent"`, `Period` and `resolveDueDate` rules currently live in `charge-generator`. They move into the new `@rent/tenancy` package (section 7), so both Workers build regular charges the same way.

### 4.6 Bond

Added on 2026-11-09, after the first production move-in showed no bond.

- The bond is a Charges record: `Label` = `{tenancy label} Bond`, `Tenancy`, `Type` = `Bond`, `Due Date` = the start date, `Amount`. It has no `Period`, because the charge generator treats any charge with next month's `Period` as that month's rent and would skip the tenancy.
- The bot suggests one month of rent. The operator can type another amount or choose no bond. The confirm screen shows the bond.
- Being a charge, it shows in `/reminder` and the tenant pays it with `/pay`.
- The Charges `Type` single select needs a `Bond` option. The schema check reports it when missing.
- A confirm screen saved before this change has no bond in its session, so its Confirm replies "expired".
- Bond refunds and deductions at move-out are out of scope and stay manual.

---

## 5. `charge-generator` Change

When building a tenancy's charge for a period, skip it when:

```ts
dueDate < tenancy['Start Date']  ||  (tenancy['End Date'] && dueDate > tenancy['End Date'])
```

This puts decision 3 into code and stops tenants with a future start date from being charged early. The check is a function in `@rent/tenancy`. Skipped tenancies count as skipped in the Discord summary, logged by record ID only, following `charge-generator/AGENTS.md`.

The Airtable read must also fetch `Start Date` and `End Date`. It already does.

---

## 6. Changes Outside the New Commands

- **`/pay` tenant list** also includes ended tenancies that still owe money:
  `OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()), {Balance} > 0)`.
  Without this, a tenant disappears from `/pay` on their last day, and their final payments can't be recorded.
- **Melbourne "today".** `todayISO()` and `yesterdayISO()` in `payment-worker/src/format.ts` use UTC. Before about 10–11am in Melbourne, they return the previous day. Move the Melbourne date helper from `outstanding.ts` into `format.ts` and use it everywhere, including the `/pay` date buttons.
- **`/cancel` and fallback text** stop saying "Use /pay to start again" and give the general command list instead.
- **`/help`** lists `/movein` and `/moveout`.

---

## 7. Code Structure

The tenancy rules go in a new shared package. The Telegram flows stay in `payment-worker`, because Telegram sends all of a bot's messages to one webhook. A separate Worker would need a second bot, or routing between Workers that share one KV session. Both cost more setup and deployment work than they save.

### `packages/tenancy` (new, `@rent/tenancy`)

Pure functions only: no Airtable calls, no Telegram, no clock. Callers pass in today's date. Inputs and outputs are plain values, so the package has no runtime dependencies.

| File | Contents |
|---|---|
| `src/due-date.ts` | `resolveDueDate`, moved from `charge-generator/src/due-date.ts` without changes |
| `src/rent-charge.ts` | Regular charge fields: label `{Label} {YYYY-MM} Rent`, `Type: "Rent"`, `Period`, `Due Date`, `Amount` |
| `src/charge-window.ts` | The section 5 rule: is a due date within `Start Date`…`End Date` |
| `src/move-in.ts` | `Due Day` from the first-payment option, part-month amount, which charges to create (section 4.4), `Label` from room code and tenant name, start-date checks |
| `src/move-out.ts` | End-date checks, and which charges fall after an end date |
| `src/index.ts` | Exports |

Package setup copies `packages/airtable-client`:
- `package.json` with `main` and `exports` pointing at `src/index.ts`, and `typecheck` and `test` scripts
- `tsconfig.json` extending `tsconfig.base.json`
- a Node `vitest.config.ts`, added to `vitest.workspace.ts`

Both Workers add `"@rent/tenancy": "*"` to their dependencies. Wrangler bundles the package source the same way it bundles `@rent/airtable-client` today.

### `packages/airtable-client`

- `TABLES`: add `TENANTS` and `ROOMS`.
- `schemas.ts`: add `RoomSchema` (`Code`, `Default Rent`, `Status`) and `TenantSchema` (`Name`, `Notes`). Extend `TenancySchema` with `Room`, `Tenant` (string arrays) and `Frequency`.
- `client.ts`: add `update(tableId, schema, recordId, fields)` using `PATCH /v0/{base}/{table}/{id}`. Error handling and retries match `create`. 4xx errors (including 429 when the monthly limit runs out) are not retried.

### `charge-generator`

- `src/charges.ts` imports `resolveDueDate`, the charge fields builder and the charge-window check from `@rent/tenancy`.
- Delete `src/due-date.ts`. Its tests move to `packages/tenancy/test/due-date.test.ts`.

### `payment-worker`

- `src/types.ts`: add `flow: 'pay' | 'movein' | 'moveout'` to the session, plus the new steps and fields. A `saving` step marks a Confirm already in progress.
- `src/movein.ts` and `src/moveout.ts` (new): the Telegram handlers for each flow. They:
  - read and write Airtable through `@rent/airtable-client`
  - get every decision (dates, amounts, which charges) from `@rent/tenancy`
- `src/bot.ts`: register the two flows, with callback prefixes `mi:` and `mo:` so they never clash with `/pay`'s prefixes. Telegram limits callback data to 64 bytes, and Airtable record IDs are 17 characters, so this fits. The `message:text` handler passes typed replies to the active flow, based on the session's `flow`.

Renaming `payment-worker` to something wider, such as `rent-bot`, is a separate later change. It creates a new Cloudflare Worker, so it also needs new secrets, the webhook registered again, and the Access policy updated.

### Double-tap protection

On Confirm, the bot first writes `step: 'saving'` to KV and then does the Airtable writes. A second Confirm that finds `saving` (or no session) replies "Already saved or expired" and writes nothing. This costs no Airtable calls.

**Revised after PR review (2026-11-08).** The KV step alone can't stop two Confirms that arrive together, because both can read the confirm step before either writes `saving`. A test reproduced it: two simultaneous taps created two tenants, two tenancies and two charges. Three changes now apply to `/pay`, `/movein` and `/moveout`:

- Each confirm screen has an operation ID. It is stored in the session and carried in the Confirm button. A button whose ID doesn't match the session writes nothing, so an older screen can't save a newer operation.
- Before writing, Confirm must claim the operation ID from a per-user `ConfirmLock` Durable Object (SQLite storage, allowed on the Free plan). Each ID is handed out once.
- `/movein` stores the charges its screen showed. If they change before Confirm, because the 15th (UTC) passed, the bot shows the screen again instead of saving different charges.

The `saving` step stays, so Cancel and typed text still see that a save is running.

**Revised after the second PR review (2026-11-08).** Two more gaps:

- `/pay`'s charge, method and date buttons didn't check the step. Its date buttons stay under the confirm screen, so tapping one during a slow save moved the session from `saving` back to `confirm` with a new operation ID. That screen's Confirm then recorded the same payment again. Every button now works only at its own step, and the charge button must belong to the session's tenancy. `/pay`'s Cancel now clears only a `/pay` session.
- When the lock couldn't be reached, the error replaced the confirm screen and removed its buttons, though it said to tap Confirm again. The error is now a new message, and the confirm screen keeps its buttons.

### `scripts/check-airtable-schema.ts`

- Add Rooms and Tenants fields, plus the new Tenancies fields, to `REQUIRED_FIELDS`.
- Check that these single-select options exist by name:
  - Rooms `Status`: `Occupied` and `Vacant`
  - Tenancies `Frequency`: `Monthly`

  Without this check, a renamed option would make writes fail with 422.

---

## 8. Error Handling

- Airtable read failures: reply with a short message and log the error, as `/reminder` does.
- Partial write failures: section 4.2.
- Unauthorized users stay blocked by the existing middleware.
- Logs and Telegram replies never include tokens or raw Airtable response bodies.

---

## 9. Free-Plan Budget

| Action | Airtable API calls | New records |
|---|---|---|
| `/moveout` | 4: list tenancies, read charges, PATCH tenancy, PATCH room | 0 |
| `/movein` | 5–8: list rooms, match name, create tenant, create tenancy, 1–2 rent charges, PATCH room, bond charge | 2–5 |
| `/pay` (today, for comparison) | about 5 | 1 |

Move-ins and move-outs are rare, so the monthly call limit is not at risk. Charges the bot creates would mostly have been created by the generator anyway.

The record cap is a longer-term limit outside this feature. Each tenant adds about two records a month (one charge, one payment).

---

## 10. Tests

Write tests before the implementation. All Airtable and Telegram calls are mocked.

**`packages/airtable-client`**
- `update` sends a PATCH with `{ fields }` to the record URL.
- `update` checks the response against the schema.
- `update` retries 5xx errors and does not retry 4xx or 429.

**`packages/tenancy` (Node vitest, no mocks needed)**
- `due-date.test.ts`: moved from `charge-generator` unchanged, and still passes.
- Regular charge fields match what `charge-generator` writes today: label, `Type`, `Period`, `Due Date`, `Amount`.
- The charge window accepts due dates equal to `Start Date` or `End Date`, and rejects dates outside them.
- `Due Day` for both options, including start days 29–31.
- Part-month amount, including start on the 1st and the last day of the month.
- The charges-to-create cases in the section 4.4 table, plus a start before the 15th and a start after it.
- An end date before the start date is rejected. Start dates more than 60 days in the past are rejected.
- Charges after an end date are picked out correctly.
- `Label` is `{Code} {Name}`, with surrounding spaces trimmed.

**`payment-worker` unit tests (`format.test.ts`)**
- Melbourne "today" at 23:30 UTC gives the next calendar day.

**`payment-worker` integration tests (Workers pool + `fetchMock`, same style as `wizard.test.ts`)**
- Full `/moveout`: exact PATCH bodies for the tenancy and room, the session is cleared, and the reply has the handover button.
- `/moveout` with a future end date: the room is not PATCHed.
- `/moveout` confirm screen lists a charge due after the end date.
- Full `/movein` with a new tenant: exact POST bodies for Tenants, Tenancies and Charges, then the room PATCH.
- `/movein` reusing an existing tenant: no Tenants POST.
- The handover button starts `/movein` with the room already set.
- A second Confirm writes nothing.
- Bad rent, bad dates and `/cancel` mid-flow leave Airtable untouched.
- An unauthorized user causes no writes.
- `/pay` lists an ended tenancy that still owes money.
- Partial failure: the tenancy POST returns 422 after the tenant was created, and the reply names what to fix.

**`charge-generator` integration tests (`scheduled.test.ts`)**
- Skips a tenancy when the due date is before `Start Date`.
- Skips a tenancy when the due date is after `End Date`.
- Still creates the charge when the due date equals either boundary.
- The existing tests still pass after `due-date.ts` moves to `@rent/tenancy`.

---

## 11. Verification

Local, from the repo root:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:staging
```

Schema check against staging, then production (one API call each):

```bash
AIRTABLE_BASE_ID=appzRYFa1yW5pQDEW npm run check:schema
```

Staging run with `@ChwqueudciBot` and base `appzRYFa1yW5pQDEW`. It takes about 30 API calls, so plan one run.

1. `/movein` a test tenant into a vacant room with a part-month first payment. Check in Airtable:
   - the Tenants and Tenancies records
   - `Label`
   - `Due Day = 1`
   - the prorated charge
   - room `Occupied`
2. `/pay` shows the new tenant.
3. Call `/run` on `charge-generator-staging`. It creates no duplicate for months the bot already created.
4. `/moveout` the test tenant with end date today. Check:
   - `End Date` is set
   - the room shows `Vacant`
   - the confirm screen listed any later charges
5. `/pay` still lists the tenant while they owe money. `/reminder` still works.
6. Tap the handover button and cancel. The flow starts with the room already set.

After deploying to production, check Cloudflare logs for the Worker, then check that the schema-check workflow still passes the next day.

---

## 12. Documentation

Update in the same change:

- `payment-worker/README.md`: commands, flows, file layout, tests.
- `charge-generator/README.md` and `charge-generator/AGENTS.md`: the start/end date skip rule, and that due-date and charge rules now come from `@rent/tenancy`. The `AGENTS.md` file table loses `src/due-date.ts`.
- `packages/tenancy/README.md` (new): what the package holds, and the rule that it stays free of I/O.
- `packages/airtable-client/README.md`: `update` and the new tables.
- `README.md`, `docs/runbook.md`: what the new commands do; how to fix a half-finished move-in; how to fix charges after an end date.
- `AGENTS.md`, `payment-worker/AGENTS.md`, `CLAUDE.md`: agent notes for the new commands, plus a rule that due-date, charge and tenancy rules live in `packages/tenancy` and stay free of I/O.
- `README.md` package table: add `packages/tenancy`.
- BotFather command list: add `movein` and `moveout` (manual step, in the runbook).

---

## 13. Open Items

- **Is staging in the same Airtable workspace as production?** If so, staging runs use the same 1,000-call monthly limit.
- **Existing labels that don't match `{Code} {Name}`** (e.g. `1/19-R6 Couple` against tenant name `Dongbei Couple`) are left alone. Only new tenancies get the generated label.
