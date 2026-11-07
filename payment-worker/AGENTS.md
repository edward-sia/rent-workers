# payment-worker Agent Notes

This Worker owns the Telegram payment bot.

- `/pay` records tenant payments through the wizard and writes Payment records to Airtable. It lists active tenancies plus ended ones that still owe money.
- `/movein` (`src/movein.ts`, prompts in `src/movein-view.ts`) creates a Tenant (unless one is reused), a Tenancy, the first Charges, then sets the Room to Occupied. It writes in that order with no rollback.
- `/moveout` (`src/moveout.ts`) sets the tenancy `End Date`. It sets the Room to Vacant only when the end date is today (Melbourne) or earlier.
- Callback data prefixes: `mi:` for move-in, `mo:` for move-out. `/pay` keeps its own unprefixed callbacks.
- Confirm buttons set the KV session step to `saving` before any Airtable write. A second tap finds `saving`, writes nothing, and says to check Airtable before trying again. Keep that guard.
- Build the Airtable client with `airtableFor(env)` (`src/airtable.ts`, 5 s per request). `index.ts` gives grammY a 50 s webhook timeout so a Confirm's writes can all finish. Keep the two in step if you add Airtable calls to a Confirm.
- Replies and logs must never include raw Airtable response bodies. Replies show only the HTTP status (`httpStatusOf`) and link to the record. Logs go through `logAirtableFailure(flow, action, error)`, which writes the action and the status only. A 5xx, timeout or unreadable response may have saved, so the reply says to check before retrying.
- Due-date, charge and tenancy rules live in `packages/tenancy`. Do not copy them into this Worker.
- `/reminder` is read-only and shows overdue plus next-14-day outstanding charges.
- Keep Airtable access through `@rent/airtable-client`; do not add one-off fetch helpers.
- Keep linked-record filtering client-side when matching Charges to Tenancies.
- `/reminder` must remain charge-level: a tenant can have multiple overdue months and can appear in both reminder sections.
- `/reminder` output should stay sorted by due date: tenant groups use their earliest due date, and rows within a tenant are due-date ordered.
- Update `payment-worker/README.md`, root `README.md`, `docs/runbook.md`, root `AGENTS.md`, and `CLAUDE.md` when bot commands or operational behavior change.
