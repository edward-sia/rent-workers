# payment-worker Agent Notes

This Worker owns the Telegram payment bot.

- `/pay` records tenant payments through the wizard and writes Payment records to Airtable.
- `/reminder` is read-only and shows overdue plus next-14-day outstanding charges.
- Keep Airtable access through `@rent/airtable-client`; do not add one-off fetch helpers.
- Keep linked-record filtering client-side when matching Charges to Tenancies.
- `/reminder` must remain charge-level: a tenant can have multiple overdue months and can appear in both reminder sections.
- Update `payment-worker/README.md`, root `README.md`, `docs/runbook.md`, root `AGENTS.md`, and `CLAUDE.md` when bot commands or operational behavior change.
