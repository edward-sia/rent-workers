# payment-worker Agent Notes

This Worker owns the Telegram payment bot.

- `/pay` records tenant payments through the wizard and writes Payment records to Airtable.
- `/reminder` is read-only and shows overdue plus next-14-day outstanding charges.
- Keep Airtable access through `@rent/airtable-client`; do not add one-off fetch helpers.
- Keep linked-record filtering client-side when matching Charges to Tenancies.
- `/reminder` must remain charge-level: a tenant can have multiple overdue months and can appear in both reminder sections.
- `/reminder` output should stay sorted by due date: tenant groups use their earliest due date, and rows within a tenant are due-date ordered.
- Update `payment-worker/README.md`, root `README.md`, `docs/runbook.md`, root `AGENTS.md`, and `CLAUDE.md` when bot commands or operational behavior change.
