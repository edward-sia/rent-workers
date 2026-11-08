# @rent/tenancy

Pure rules for due dates, rent charges and tenancy dates. `charge-generator` and `payment-worker` both use it.

The package does no I/O. It has no Airtable client, no `fetch`, no KV, and no clock. Callers pass today's date in, so every function gives the same answer for the same input and can be tested without mocks.

## What It Holds

| File | Exports | What they do |
|---|---|---|
| `src/due-date.ts` | `resolveDueDate` | Picks a tenancy's due date for a month: `Due Day` if set (1 to 28), else the day of `Start Date` capped at 28, else the 1st. |
| `src/dates.ts` | `periodOf`, `addMonths`, `daysInMonth`, `addDaysISO`, `endOfMonthISO` | Date arithmetic on `YYYY-MM-DD` dates and `YYYY-MM` periods. |
| `src/rent-charge.ts` | `buildRentCharge` | Builds the Charges fields for one month of rent. |
| `src/charge-window.ts` | `isWithinTenancy` | True when a due date falls inside `Start Date` to `End Date`. Both bounds are inclusive. A missing bound means no limit on that side. |
| `src/move-in.ts` | `tenancyLabel`, `dueDayFor`, `partMonthAmount`, `checkStartDate`, `generatedThrough`, `planMoveInCharges` | Rules for `/movein`: the tenancy label, the due day for each first-payment option, the part-month amount (rent x 12 / 365 per day), the 60-day limit on how far back a start date may be, and which charges to create. |
| `src/move-out.ts` | `checkEndDate`, `chargesAfter`, `owedThrough` | Rules for `/moveout`: the end date may not be before the start date, which charges fall due after the end date, and how much is owed up to the end date. |

`planMoveInCharges` always returns the first charge. It adds one regular charge per month after that, up to the last month the charge generator has already covered. The generator runs on the 15th (UTC), so that month is the current one before the 15th and the next one from the 15th onward (`generatedThrough`).

## Rule For Contributors

Keep due-date, charge and tenancy rules here, and keep this package free of I/O. Code that reads or writes Airtable, Telegram or KV belongs in a worker or in `@rent/airtable-client`.

## Usage

```ts
import { isWithinTenancy, resolveDueDate } from '@rent/tenancy';

const dueDate = resolveDueDate({ 'Due Day': 5 }, 2026, '12'); // '2026-12-05'
isWithinTenancy(dueDate, { 'Start Date': '2026-06-01', 'End Date': '2026-11-30' }); // false
```

## Tests

```bash
npm run test -- packages/tenancy
```

Tests live in `test/`, one file per source file.
