# Telegram Move-In and Move-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/moveout` and `/movein` Telegram commands to end and start tenancies, with the rules for dates and charges kept in a new shared `@rent/tenancy` package.

**Architecture:** `@rent/tenancy` holds pure functions with no I/O. It takes over `resolveDueDate` and the rent-charge format from `charge-generator`, and adds the move-in and move-out rules. `@rent/airtable-client` gains `update()`, the Rooms and Tenants tables, and a formula-string helper. `payment-worker` gets two new flow files, `src/moveout.ts` and `src/movein.ts`. They use the existing KV session, which gains a `flow` field.

**Tech Stack:** TypeScript, Cloudflare Workers, grammY, zod, vitest (Node and `@cloudflare/vitest-pool-workers`), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-07-telegram-move-in-move-out-design.md`

## Global Constraints

- Airtable access only through `@rent/airtable-client`. No one-off fetch helpers.
- `@rent/tenancy` has no runtime dependencies and makes no I/O or clock calls. Callers pass dates in as `YYYY-MM-DD` strings.
- Table IDs: Tenancies `tblvVmo12VikITRH6`, Charges `tblNCw6ZxspNxiKCu`, Payments `tbl8Zl9C9fzBDPllu`, Tenants `tblsesIqj1VuokNcP`, Rooms `tblBrzawaTuwahBQg`.
- Single-select values written by the bot: Rooms `Status` is `Occupied` or `Vacant`. Tenancies `Frequency` is `Monthly`.
- Tenancy `Label` is `{Rooms.Code} {Tenants.Name}`.
- Regular charge: `Label: "{tenancy Label} {YYYY-MM} Rent"`, `Type: "Rent"`, `Period: "YYYY-MM"`, `Due Date`, `Amount`, `Tenancy: [id]`.
- Part-month amount: `round2(monthlyRent × 12 / 365 × daysLeft)`, where `daysLeft = daysInMonth − startDay + 1`.
- `generatedThrough`: the next month if the UTC day is 15 or later, otherwise the current month.
- Reject start dates more than 60 days before today (Melbourne).
- Operator "today" is the `Australia/Melbourne` date.
- Callback data prefixes: `mo:` for move-out and `mi:` for move-in, at most 64 bytes.
- Never log or reply with tokens or raw Airtable response bodies. Errors show the HTTP status only (e.g. `HTTP 422`). `charge-generator` logs and Discord messages use record IDs, not tenant labels.
- Tests mock all Airtable and Telegram calls.
- Verify with `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run build:staging`.

## Review Focus

1. **Names with special characters.** For example `O"Brien \ Jr`, `Sun_Peng*` and `小刚夫妇`. The exact-name lookup must quote them safely in the Airtable formula, and replies must not break Telegram Markdown. → Task 4 (`formulaString` test) and Task 7 (name with `_` and `*`).
2. **Old or out-of-flow buttons.** A user taps `mo:confirm` from an old message, after the session expired or while `/pay` is active. Expect "expired" and no Airtable writes. → Task 6.
3. **Typed text goes to the right flow.** During move-in's rent step, typing `1650` must not be treated as a `/pay` amount, and the other way round. → Task 7.
4. **Airtable 429 partway through a move-in.** This happens when the Free-plan monthly limit runs out. The reply names the steps that finished and shows `HTTP 429`. → Task 7.
5. **Moving into a room already marked `Occupied`.** The confirm screen warns before you save. → Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/tenancy/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md` | Package setup, copying `packages/airtable-client` |
| `packages/tenancy/src/dates.ts` | Pure date helpers for ISO strings: periods, month math, day counts |
| `packages/tenancy/src/due-date.ts` | `resolveDueDate`, moved from `charge-generator` |
| `packages/tenancy/src/rent-charge.ts` | Fields for a regular rent charge |
| `packages/tenancy/src/charge-window.ts` | Whether a due date falls inside the tenancy's dates |
| `packages/tenancy/src/move-in.ts` | Label, `Due Day`, part-month amount, start-date check, charge plan |
| `packages/tenancy/src/move-out.ts` | End-date check, charges after the end date, balance owed up to the end date |
| `packages/tenancy/src/index.ts` | Exports |
| `packages/airtable-client/src/client.ts` | Adds `update()` |
| `packages/airtable-client/src/formula.ts` | `formulaString()` for safe values inside formulas |
| `packages/airtable-client/src/tables.ts`, `schemas.ts`, `index.ts` | Rooms and Tenants tables and schemas; new Tenancies fields |
| `scripts/check-airtable-schema.ts` | New tables and fields, plus a check that the select options exist |
| `charge-generator/src/charges.ts` | Uses `@rent/tenancy`; skips charges outside the tenancy's dates |
| `payment-worker/src/format.ts` | Melbourne date helpers |
| `payment-worker/src/types.ts` | Session `flow`, new steps and fields |
| `payment-worker/src/bot.ts` | Routing, `/help`, `/cancel`, the `/pay` filter, sending typed text to the active flow |
| `payment-worker/src/moveout.ts` | `/moveout` handlers |
| `payment-worker/src/movein.ts` | `/movein` handlers, including the handover entry |
| `payment-worker/test/integration/helpers.ts` | Shared Telegram and Airtable mock helpers for the new tests |

---

### Task 1: `@rent/tenancy` package and charge-generator refactor

This is a refactor only. `charge-generator` must behave exactly as it does today.

**Files:**
- Create: `packages/tenancy/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/tenancy/src/{dates.ts,due-date.ts,rent-charge.ts,index.ts}`
- Move: `charge-generator/test/due-date.test.ts` → `packages/tenancy/test/due-date.test.ts` (change only the import path)
- Delete: `charge-generator/src/due-date.ts`
- Modify: `charge-generator/src/charges.ts`, `charge-generator/package.json`, `vitest.workspace.ts`, `package-lock.json`
- Test: `packages/tenancy/test/dates.test.ts`, `packages/tenancy/test/rent-charge.test.ts`

**Interfaces:**
- Produces, exported from `@rent/tenancy`:
  - `resolveDueDate(fields: { 'Due Day'?: number; 'Start Date'?: string }, year: number, month: string): string`. Same behaviour as today.
  - `periodOf(isoDate: string): string`, e.g. `'2026-11-20'` → `'2026-11'`.
  - `addMonths(period: string, n: number): string`, e.g. `('2026-12', 1)` → `'2027-01'`.
  - `daysInMonth(period: string): number`.
  - `addDaysISO(isoDate: string, days: number): string`.
  - `endOfMonthISO(isoDate: string): string`.
  - `interface RentChargeFields { Label: string; Tenancy: string[]; Type: 'Rent'; Period: string; 'Due Date': string; Amount: number }`
  - `buildRentCharge(input: { tenancyId: string; tenancyLabel: string; period: string; dueDate: string; amount: number }): RentChargeFields`

- [ ] **Step 1: Create the package skeleton.** Copy `packages/airtable-client/package.json` with `name: "@rent/tenancy"` and no `dependencies`. Copy its `tsconfig.json`. Add `vitest.config.ts` with `name: 'tenancy'`, Node environment, `include: ['test/**/*.test.ts']`. Add `'packages/tenancy/vitest.config.ts'` to `vitest.workspace.ts`. Add `"@rent/tenancy": "*"` to `charge-generator/package.json` dependencies. Run `npm install` to link the workspace.
- [ ] **Step 2: Write the failing tests.**
  - Move `due-date.test.ts` and point it at `../src/due-date`.
  - `dates.test.ts`:
    - `periodOf('2026-11-20') === '2026-11'`
    - `addMonths('2026-12', 1) === '2027-01'`
    - `addMonths('2026-01', -1) === '2025-12'`
    - `daysInMonth('2028-02') === 29`
    - `addDaysISO('2026-12-31', 1) === '2027-01-01'`
    - `endOfMonthISO('2026-11-07') === '2026-11-30'`
  - `rent-charge.test.ts`: `buildRentCharge({ tenancyId: 'recT1', tenancyLabel: '6B-R6 Sun Peng', period: '2026-12', dueDate: '2026-12-10', amount: 1500 })` equals `{ Label: '6B-R6 Sun Peng 2026-12 Rent', Tenancy: ['recT1'], Type: 'Rent', Period: '2026-12', 'Due Date': '2026-12-10', Amount: 1500 }`.
- [ ] **Step 3: Run them and confirm they fail.** `npm run test -- packages/tenancy` fails with module-not-found.
- [ ] **Step 4: Implement.**
  - Move `resolveDueDate` unchanged.
  - Write the `dates.ts` helpers using UTC `Date` math on `T00:00:00Z`.
  - Write `buildRentCharge`.
  - Export everything from `src/index.ts`.
- [ ] **Step 5: Switch `charge-generator/src/charges.ts` to the package.** Import `resolveDueDate` and `buildRentCharge` from `@rent/tenancy`. Replace the inline charge object with `buildRentCharge({ ..., amount: rent })`. Delete `src/due-date.ts`.
- [ ] **Step 6: Run the checks.** `npm run test` passes, including the existing `charge-generator` integration tests, which check the charge POST body unchanged. `npm run typecheck` and `npm run build` pass.
- [ ] **Step 7: Commit.** `refactor: move rent charge rules into @rent/tenancy`

---

### Task 2: Generator skips charges outside the tenancy's dates

**Files:**
- Create: `packages/tenancy/src/charge-window.ts`
- Test: `packages/tenancy/test/charge-window.test.ts`
- Modify: `charge-generator/src/charges.ts`, `charge-generator/test/integration/scheduled.test.ts`

**Interfaces:**
- Produces: `isWithinTenancy(dueDate: string, tenancy: { 'Start Date'?: string; 'End Date'?: string }): boolean`. A missing `Start Date` means no lower bound. A missing `End Date` means no upper bound. Both bounds are inclusive.

- [ ] **Step 1: Write the failing unit tests.** With Start `2026-05-10` and End `2026-06-20`:
  - `2026-05-10` → true
  - `2026-06-20` → true
  - `2026-05-09` → false
  - `2026-06-21` → false
  - `{}` (no dates) → true
- [ ] **Step 2: Write the failing integration tests in `scheduled.test.ts`.** The existing run date `Date.UTC(2026, 3, 15)` gives period `2026-05`.
  - `skips a tenancy whose due date is before Start Date`: tenancy with `'Start Date': '2026-06-10'`. No Charges POST is made.
  - `skips a tenancy whose due date is after End Date`: `'Due Day': 20`, `'End Date': '2026-05-15'`. No POST.
  - `creates the charge when the due date equals Start Date`: `'Start Date': '2026-05-10'`. One POST with `'Due Date': '2026-05-10'`.
- [ ] **Step 3: Run them and confirm they fail.** `npm run test -- charge-generator`: the two skip tests fail because a POST happens.
- [ ] **Step 4: Implement `isWithinTenancy` and call it in `charges.ts`** after working out `dueDate`. When it returns false, push `tenancy ${id} outside tenancy dates` to `skipped` and `continue`.
- [ ] **Step 5: Run `npm run test` and confirm everything passes.**
- [ ] **Step 6: Commit.** `feat(charge-generator): skip charges outside tenancy dates`

---

### Task 3: Move-in and move-out rules in `@rent/tenancy`

**Files:**
- Create: `packages/tenancy/src/move-in.ts`, `packages/tenancy/src/move-out.ts`
- Test: `packages/tenancy/test/move-in.test.ts`, `packages/tenancy/test/move-out.test.ts`

**Interfaces:**
- Consumes: Task 1 date helpers and `resolveDueDate`.
- Produces:
  - `type FirstPaymentOption = 'regular' | 'part_month'`
  - `tenancyLabel(roomCode: string, tenantName: string): string`. Trims both parts and joins them with one space.
  - `dueDayFor(option: FirstPaymentOption, startDate: string): number`. `regular` gives the start day capped at 28. `part_month` gives 1.
  - `partMonthAmount(monthlyRent: number, startDate: string): number`. Rounded to cents.
  - `checkStartDate(startDate: string, today: string): string | null`. Returns an error message, or null when the date is OK.
  - `generatedThrough(todayUtc: string): string`. Returns a period.
  - `interface PlannedCharge { period: string; dueDate: string; amount: number }`
  - `planMoveInCharges(input: { startDate: string; monthlyRent: number; option: FirstPaymentOption; firstAmount: number; todayUtc: string }): PlannedCharge[]`. The first charge covers `periodOf(startDate)`, is due on `startDate`, and has `firstAmount`. After that comes one regular charge per month up to `generatedThrough(todayUtc)`. A regular charge has `dueDate = resolveDueDate({ 'Due Day': dueDayFor(option, startDate) }, …)` and `amount = monthlyRent`.
  - `checkEndDate(endDate: string, startDate: string | undefined): string | null`
  - `interface ChargeLike { id: string; fields: { 'Due Date'?: string; Balance?: number; Status?: string } }`
  - `chargesAfter<T extends ChargeLike>(charges: T[], endDate: string): T[]`. Charges with a due date after `endDate`, in due-date order.
  - `owedThrough(charges: ChargeLike[], endDate: string): number`. The sum of `Balance` over charges that are not `Paid`, are due on or before `endDate`, and have a balance above 0.

- [ ] **Step 1: Write the failing tests in `move-in.test.ts`.**
  - `tenancyLabel(' 6B-R6 ', 'Sun Peng ') === '6B-R6 Sun Peng'`
  - `dueDayFor('regular', '2026-11-30') === 28`
  - `dueDayFor('regular', '2026-11-20') === 20`
  - `dueDayFor('part_month', '2026-11-20') === 1`
  - `partMonthAmount(1500, '2026-11-20') === 542.47`. That is 1500 × 12 / 365 × 11 = 542.465…, rounded.
  - `partMonthAmount(1500, '2026-11-30') === 49.32`
  - `checkStartDate('2026-09-08', '2026-11-07')` is null, because it is exactly 60 days back. `checkStartDate('2026-09-07', '2026-11-07')` returns an error. `checkStartDate('2027-01-05', '2026-11-07')` is null.
  - `generatedThrough('2026-11-14') === '2026-11'`
  - `generatedThrough('2026-11-15') === '2026-12'`
  - `planMoveInCharges`, one test per row of spec section 4.4:
    - today `2026-11-10`, start `2026-11-20`, regular, rent 1500 → `[{period:'2026-11', dueDate:'2026-11-20', amount:1500}]`
    - today `2026-11-18`, same → adds `{period:'2026-12', dueDate:'2026-12-20', amount:1500}`
    - today `2026-11-18`, start `2026-11-20`, part_month, firstAmount 542.47 → `[{'2026-11','2026-11-20',542.47}, {'2026-12','2026-12-01',1500}]`
    - today `2026-11-10`, start `2027-01-05`, regular → `[{'2027-01','2027-01-05',1500}]`
- [ ] **Step 2: Write the failing tests in `move-out.test.ts`.**
  - `checkEndDate('2026-11-01', '2026-11-05')` returns an error. `checkEndDate('2026-11-05', '2026-11-05')` is null. `checkEndDate('2026-11-05', undefined)` is null.
  - `chargesAfter` keeps only charges due after the end date, sorted.
  - `owedThrough` ignores `Paid` charges, charges after the end date, and zero balances.
- [ ] **Step 3: Run them and confirm they fail.** `npm run test -- packages/tenancy`
- [ ] **Step 4: Implement both files and export them from `index.ts`.**
- [ ] **Step 5: Run the tests and confirm they pass.** Then run `npm run typecheck`.
- [ ] **Step 6: Commit.** `feat(tenancy): add move-in and move-out rules`

---

### Task 4: Airtable client: `update`, new tables, formula strings, schema check

**Files:**
- Create: `packages/airtable-client/src/formula.ts`
- Modify: `packages/airtable-client/src/{client.ts,tables.ts,schemas.ts,index.ts}`, `scripts/check-airtable-schema.ts`
- Test: `packages/airtable-client/test/client-update.test.ts`, `packages/airtable-client/test/formula.test.ts`, `packages/airtable-client/test/schemas.test.ts`

**Interfaces:**
- Produces:
  - `AirtableClient.update<T>(tableId: string, schema: z.ZodType<T>, recordId: string, fields: Partial<T>): Promise<AirtableRecord<T>>`. Sends `PATCH {base}/{table}/{recordId}` with body `{ fields }`.
  - `formulaString(value: string): string`. Returns a double-quoted formula string literal, with `\` escaped first and then `"`.
  - `TABLES.TENANTS = 'tblsesIqj1VuokNcP'`, `TABLES.ROOMS = 'tblBrzawaTuwahBQg'`
  - `RoomSchema = z.object({ Code: z.string(), 'Default Rent': z.number().optional(), Status: z.string().optional() })`
  - `TenantSchema = z.object({ Name: z.string(), Notes: z.string().optional() })`
  - `TenancySchema` adds `Room` and `Tenant` (`z.array(z.string()).optional()`) and `Frequency` (`z.string().optional()`).

- [ ] **Step 1: Write the failing tests.**
  - `client-update.test.ts` follows the pattern in `client-create.test.ts`:
    - It PATCHes `https://api.airtable.com/v0/app1/tbl1/recX` with `{ fields: { Name: 'Y' } }` and returns the parsed record.
    - It retries 503 and then succeeds.
    - It makes one call and rejects on 422.
    - It makes one call and rejects with `/429/` on 429.
  - `formula.test.ts`:
    - `formulaString('Sun Peng') === '"Sun Peng"'`
    - `formulaString('O"Brien \\ Jr') === '"O\\"Brien \\\\ Jr"'`
    - `formulaString('小刚夫妇') === '"小刚夫妇"'`
  - `schemas.test.ts`: `RoomSchema` parses `{ Code: '6B-R6', 'Default Rent': 1500, Status: 'Vacant' }`, and `TenancySchema` parses `Room`, `Tenant` and `Frequency`.
- [ ] **Step 2: Run them and confirm they fail.** `npm run test -- airtable-client`
- [ ] **Step 3: Implement.** `update` reuses the private `request()` with `method: 'PATCH'`, so retries match `create`. Wrap errors as `Airtable update [${tableId}]: …`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Extend `scripts/check-airtable-schema.ts`.**
  - Add `options?: { choices?: { name: string }[] }` to `AirtableField`.
  - Add Rooms fields: `Code` (`singleLineText`), `Default Rent` (`currency`, `number`), `Status` (`singleSelect`), `Tenancies` (`multipleRecordLinks`).
  - Add Tenants fields: `Name` (`singleLineText`), `Notes` (`multilineText`, `richText`).
  - Add Tenancies fields: `Room` and `Tenant` (`multipleRecordLinks`), `Frequency` (`singleSelect`).
  - Add a `REQUIRED_CHOICES` map: Rooms `Status` → `['Occupied', 'Vacant']`, Tenancies `Frequency` → `['Monthly']`. Report a missing choice as `[Rooms] field "Status" missing option: Vacant`.
  - Run `npx tsc -p scripts --noEmit`. It must pass.
- [ ] **Step 6: Commit.** `feat(airtable-client): add update, rooms and tenants`

---

### Task 5: payment-worker groundwork: Melbourne dates, session flow, `/pay` filter, help text

**Files:**
- Modify: `payment-worker/src/{format.ts,outstanding.ts,types.ts,bot.ts}`, `payment-worker/package.json`, `package-lock.json`
- Test: `payment-worker/test/format.test.ts`, `payment-worker/test/integration/wizard.test.ts`

**Interfaces:**
- Produces:
  - `melbourneDateISO(now?: Date): string` in `format.ts`. This replaces `todayISO`. `outstanding.ts` uses it in place of its private copy.
  - `melbourneYesterdayISO(now?: Date): string`, which replaces `yesterdayISO`.
  - In `types.ts`:
    - `type Flow = 'pay' | 'movein' | 'moveout'`
    - `WizardSession.flow?: Flow`
    - New `WizardStep` values: `'mo_select_date' | 'mo_enter_date' | 'mo_confirm' | 'mi_select_room' | 'mi_enter_name' | 'mi_choose_tenant' | 'mi_enter_notes' | 'mi_enter_rent' | 'mi_select_start' | 'mi_enter_start' | 'mi_select_first' | 'mi_enter_first_amount' | 'mi_confirm' | 'saving'`
    - New optional session fields:
      - move-out: `endDate`, `startDate`, `roomId`, `roomCode`
      - move-in: `roomOccupied?: boolean`, `defaultRent`, `tenantId`, `tenantName`, `tenantNotes`, `monthlyRent`, `firstOption: FirstPaymentOption`, `firstAmount`
      - list picks: `choices?: Record<string, { label: string; startDate?: string; roomId?: string; defaultRent?: number; occupied?: boolean }>`
  - `HELP_TEXT` constant in `bot.ts`, listing `/pay`, `/reminder`, `/movein`, `/moveout` and `/cancel`.

- [ ] **Step 1: Write the failing tests.**
  - `format.test.ts`:
    - `melbourneDateISO(new Date('2026-11-07T23:30:00Z')) === '2026-11-08'`
    - `melbourneYesterdayISO(new Date('2026-11-07T23:30:00Z')) === '2026-11-07'`
  - `wizard.test.ts`, new test `"/pay asks Airtable for active tenancies and ended ones that still owe"`: capture the Tenancies request path, decode it, and check that `filterByFormula` equals `OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()), {Balance} > 0)`.
  - `wizard.test.ts`, new test `"/cancel lists all commands"`: the reply includes `/movein` and `/moveout`.
- [ ] **Step 2: Run them and confirm they fail.** `npm run test -- payment-worker`
- [ ] **Step 3: Implement.**
  - Add `"@rent/tenancy": "*"` to `payment-worker/package.json` and run `npm install`.
  - Add the date helpers, using `Intl.DateTimeFormat` with `timeZone: 'Australia/Melbourne'`. Yesterday comes from `addDaysISO` in `@rent/tenancy`.
  - Change the `/pay` formula.
  - Set `flow: 'pay'` on every `/pay` `setSession`.
  - Use `HELP_TEXT` for `/start`, `/help`, `/cancel` and the text fallback.
- [ ] **Step 4: Run `npm run test` and `npm run typecheck`. Both must pass.**
- [ ] **Step 5: Commit.** `feat(payment-worker): Melbourne dates, keep owing tenants in /pay`

---

### Task 6: `/moveout` flow

**Files:**
- Create: `payment-worker/src/moveout.ts`, `payment-worker/test/integration/helpers.ts`
- Modify: `payment-worker/src/bot.ts`
- Test: `payment-worker/test/integration/moveout.test.ts`

**Interfaces:**
- Consumes: `checkEndDate`, `chargesAfter`, `owedThrough` and `endOfMonthISO` (Tasks 1 and 3); `AirtableClient.update` and `TABLES.ROOMS` (Task 4); `melbourneDateISO` and the session types (Task 5).
- Produces:
  - `registerMoveOut(bot: Bot, env: Env): void`
  - `handleMoveOutText(ctx: Context, env: Env, session: WizardSession, text: string): Promise<boolean>`. Returns true when it handled the text.
  - `helpers.ts` exports `telegramUpdate`, `messageUpdate`, `callbackUpdate`, `parseBody`, `stubTelegram`, `buttonData(payloads): string[]`, and the table ID constants. Copy these from `wizard.test.ts`, but leave that file unchanged.
- Callback data:
  - `mo:t:<tenancyId>`
  - `mo:d:today`, `mo:d:eom`, `mo:d:manual`
  - `mo:confirm`, `mo:cancel`
  - the handover button is `mi:r:<roomId>`, handled in Task 7
- Airtable reads:
  - Tenancies, with fields `Label, Balance, Start Date, End Date, Room` and the filter `OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))`. The results are saved in `session.choices` so the next step doesn't fetch again.
  - Charges, with fields `Label, Balance, Status, Due Date, Tenancy` and the filter `OR(NOT({Status} = "Paid"), IS_AFTER({Due Date}, "<end>"))`. The bot then keeps only this tenancy's charges, using `Tenancy.includes(id)`.
- Room code for the handover button: the first word of the tenancy `Label`.

- [ ] **Step 1: Write the failing integration tests** in `moveout.test.ts`:
  - `full move-out with end date today`:
    - Steps: `/moveout` → `mo:t:recT1` → `mo:d:today` → `mo:confirm`.
    - The Tenancies PATCH to `/recT1` has body `{ fields: { 'End Date': <melbourneDateISO()> } }`.
    - The Rooms PATCH to `/recR1` has body `{ fields: { Status: 'Vacant' } }`.
    - The KV session is null afterwards.
    - The last reply's buttons include `mi:r:recR1`.
  - `future end date leaves the room alone`: type a date 30 days ahead. The tenancy is PATCHed. No Rooms interceptor is registered, so a room PATCH would fail the test under `disableNetConnect`. The reply mentions `Occupied`.
  - `confirm screen lists charges due after the end date`: the Charges mock returns one charge due after the end date. The confirm text includes that charge's label and an Airtable link.
  - `end date before start date is rejected`: `Start Date` is `2026-11-05`, and the typed end date is `2026-11-01`. The reply has an error, the session step is still `mo_enter_date`, and nothing is PATCHed.
  - `stale confirm writes nothing` (Review Focus 2): with a session of `{ flow: 'pay', step: 'enter_amount' }`, tap `mo:confirm`. The reply includes `expired` and nothing is PATCHed. With no session at all, the result is the same.
  - `second confirm writes nothing`: with the session already `{ flow: 'moveout', step: 'saving' }`, tap `mo:confirm`. Nothing is PATCHed.
- [ ] **Step 2: Run them and confirm they fail.** `npm run test -- payment-worker`
- [ ] **Step 3: Implement `moveout.ts`.**
  - Before writing, `mo:confirm` checks that `session.flow === 'moveout' && session.step === 'mo_confirm'`. It then saves `step: 'saving'`, PATCHes the tenancy, and PATCHes the room only when `endDate <= melbourneDateISO()` and there is a `roomId`.
  - Escape every Airtable value with `escapeTelegramMarkdown`.
  - On error, reply `❌ Move-out not saved: HTTP <status>` (or which step failed) and clear the session.
  - In `bot.ts`, call `registerMoveOut`, and in `message:text` try `handleMoveOutText` before the `/pay` steps.
- [ ] **Step 4: Run `npm run test` and `npm run typecheck`. Both must pass.**
- [ ] **Step 5: Commit.** `feat(payment-worker): add /moveout`

---

### Task 7: `/movein` flow and the handover button

**Files:**
- Create: `payment-worker/src/movein.ts`
- Modify: `payment-worker/src/bot.ts`
- Test: `payment-worker/test/integration/movein.test.ts`

**Interfaces:**
- Consumes:
  - from `@rent/tenancy`: `tenancyLabel`, `dueDayFor`, `partMonthAmount`, `checkStartDate`, `planMoveInCharges`, `buildRentCharge`, `addMonths`, `periodOf`
  - from `@rent/airtable-client`: `formulaString`, `RoomSchema`, `TenantSchema`, `update`
  - the helpers from Task 6
- Produces:
  - `registerMoveIn(bot: Bot, env: Env): void`
  - `handleMoveInText(ctx: Context, env: Env, session: WizardSession, text: string): Promise<boolean>`
- Callback data:
  - `mi:r:<roomId>`. This always starts a fresh move-in session. If the room isn't in `session.choices` (as when it comes from the handover button), fetch that one room with `RECORD_ID() = "<id>"`.
  - `mi:tenant:existing`, `mi:tenant:new`
  - `mi:notes:skip`
  - `mi:rent:default`
  - `mi:s:today`, `mi:s:next1`, `mi:s:manual`
  - `mi:f:regular`, `mi:f:part`
  - `mi:amt:suggested`
  - `mi:confirm`, `mi:cancel`
- Room list: fields `Code, Default Rent, Status`. Sort `Vacant` first, then by `Code`. Save the list in `session.choices`.
- Name lookup: Tenants with `filterByFormula: '{Name} = ' + formulaString(name)` and fields `['Name']`.
- Writes on Confirm, in order:
  1. Tenants POST, unless reusing an existing tenant.
  2. Tenancies POST with `{ Label, Room: [roomId], Tenant: [tenantId], 'Start Date', 'Due Day', 'Monthly Rent', Frequency: 'Monthly' }`.
  3. One Charges POST per `planMoveInCharges(...)` item, built with `buildRentCharge`. `todayUtc` is `new Date().toISOString().slice(0, 10)`.
  4. Rooms PATCH with `{ Status: 'Occupied' }`.

  Keep a list of finished steps, so that a failure reply can name them.
- The part-month button is hidden when the start date is the 1st.
- The confirm screen warns `⚠️ {Code} is currently Occupied` when the chosen room's status is `Occupied`.

- [ ] **Step 1: Write the failing integration tests** in `movein.test.ts`. Start dates are typed as the 1st of the month three months ahead, so the plan holds exactly one charge whatever today's date is.
  - `full move-in with a new tenant`:
    - Steps: `/movein` → `mi:r:recR1` → type `Sun_Peng*` (Review Focus 1) → name lookup returns no records → `mi:notes:skip` → `mi:rent:default` (Default Rent 1500) → `mi:s:manual` → type start → `mi:f:regular` → `mi:confirm`.
    - Check the exact POST bodies:
      - Tenants: `{ Name: 'Sun_Peng*' }`
      - Tenancies: `Label: '6B-R6 Sun_Peng*'`, `Due Day: 1`, `Frequency: 'Monthly'`
      - one Charges POST: `Amount: 1500`, `Period` = the start month
    - Check the Rooms PATCH: `{ Status: 'Occupied' }`.
    - Every reply sent with `parse_mode: 'Markdown'` shows the name as `Sun\_Peng\*`.
  - `reuses an existing tenant`: the name lookup returns `recN9`, then tap `mi:tenant:existing`. No Tenants POST is made. The Tenancies body has `Tenant: ['recN9']`. Notes are not asked for.
  - `handover button starts with the room set`: with no session, tap `mi:r:recR1`. One Rooms GET is made with a `RECORD_ID()` filter. The next reply asks for the tenant name.
  - `rent text goes to move-in, not /pay` (Review Focus 3): with the session at `{ flow: 'movein', step: 'mi_enter_rent', … }`, type `1650`. The session's `monthlyRent` is 1650 and the step is `mi_select_start`. No `/pay` method keyboard is sent.
  - `429 after the tenant is created` (Review Focus 4): the Tenancies POST returns 429. The reply includes `HTTP 429` and a link to the created tenant. No Charges POST and no room PATCH are made. The session is cleared.
  - `occupied room warning` (Review Focus 5): the room has `Status: 'Occupied'`. The confirm text includes `currently Occupied`.
  - `start date too far in the past is rejected`: type a date 61 days back. The reply has an error and the step is still `mi_enter_start`.
  - `/cancel mid-flow writes nothing`.
- [ ] **Step 2: Run them and confirm they fail.** `npm run test -- payment-worker`
- [ ] **Step 3: Implement `movein.ts`.**
  - Register it in `bot.ts`, and add `handleMoveInText` to the `message:text` routing.
  - `mi:confirm` uses the same `saving` check as Task 6.
  - The confirm screen lists each planned charge as `period · due date · amount`.
- [ ] **Step 4: Run `npm run test`, `npm run typecheck` and `npm run lint`. All must pass.**
- [ ] **Step 5: Commit.** `feat(payment-worker): add /movein with room handover`

---

### Task 8: Docs and full verification

**Files:**
- Create: `packages/tenancy/README.md`
- Modify:
  - `README.md` (package table)
  - `payment-worker/README.md` (commands, flows, file layout, test table)
  - `payment-worker/AGENTS.md`
  - `charge-generator/README.md`, `charge-generator/AGENTS.md` (file table without `due-date.ts`, the tenancy-dates skip rule)
  - `packages/airtable-client/README.md` (`update`, `formulaString`, new tables)
  - `docs/runbook.md`
  - `AGENTS.md`, `CLAUDE.md`

- [ ] **Step 1: Update the docs** listed in spec section 12. `AGENTS.md` and `CLAUDE.md` each get these lines:
  - "Keep due-date, charge and tenancy rules in `packages/tenancy`; it stays free of I/O."
  - "`/movein` and `/moveout` live in `payment-worker/src/movein.ts` and `moveout.ts`."

  `docs/runbook.md` gets three sections:
  - **Finishing a half-done move-in:** which records to check, in write order.
  - **Fixing charges due after an end date.**
  - **BotFather command list.** Send this to `/setcommands`:

    ```text
    pay - Record a tenant payment
    reminder - Show overdue and upcoming payments
    movein - Start a new tenancy
    moveout - End a tenancy
    cancel - Cancel current operation
    ```
- [ ] **Step 2: Run the full local checks.** `npm run typecheck && npm run lint && npm run test && npm run build && npm run build:staging` must all pass.
- [ ] **Step 3: Commit.** `docs: document /movein, /moveout and @rent/tenancy`
- [ ] **Step 4: Run the schema check against staging (manual, needs the user's token).** `AIRTABLE_TOKEN=… AIRTABLE_BASE_ID=appzRYFa1yW5pQDEW npm run check:schema` must print `Airtable schema OK`. If the staging base lacks Rooms, Tenants or the new fields, stop and tell the user.
- [ ] **Step 5: Staging run (manual, about 30 Airtable calls).**
  - Deploy the branch to staging with `gh workflow run deploy-staging --ref <branch>`.
  - Then follow spec section 11, steps 1–6, with `@ChwqueudciBot`.
  - Record each step's result in the PR description.

---

## Self-Review Notes

- **Spec coverage:**
  - §3 → Task 6
  - §4.1–4.4 → Tasks 3 and 7
  - §4.5 → Task 1
  - §5 → Task 2
  - §6 → Task 5
  - §7 → Tasks 1, 4, 5, 6 and 7
  - §8 → Tasks 6 and 7 (error replies)
  - §10 → the tests in each task
  - §11 → Task 8
  - §12 → Task 8
- **The `/reminder` output** is unchanged apart from its source of "today", which already used Melbourne time.
