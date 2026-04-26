# rent-workers

Cloudflare Workers monorepo for automating rent management at New Haven.

Two workers share the same Airtable base and complement each other end-to-end:
`charge-generator` creates the charges each month; `payment-bot` records payments against them.

## Workers

| Worker | Trigger | Purpose |
|---|---|---|
| [`charge-generator/`](./charge-generator/) | Cron — 15th of month | Creates next month's rent charge records in Airtable; notifies Discord |
| [`payment-worker/`](./payment-worker/) | Telegram webhook | Guided wizard for recording a tenant payment against an outstanding charge |

## Shared Airtable base

Both workers operate on the same base (`app6He8xRaUzNBTDl`):

```
Tenancies ──┬── read by charge-generator  (active tenancy list)
            └── read by payment-bot       (tenant selection + balance)

Charges ────┬── written by charge-generator  (monthly rent charges)
            └── read + written by payment-bot (outstanding balance, payment link)

Payments ───── written by payment-bot  (individual payment records)
```

## End-to-end flow

```
15th of month
  charge-generator runs (cron)
  └── creates Charge records for each active tenancy (next month's rent)
      └── Discord notification: created / skipped / errors

Tenant pays rent
  property manager opens Telegram bot → /pay
  payment-bot wizard runs
  └── select tenant → select charge → amount → method → date → confirm
      └── Payment record created in Airtable, linked to the Charge
```

## Development

Each worker is independent — navigate into its directory and use its own scripts:

```bash
cd charge-generator   # or payment-worker
npm install
npm run dev           # local dev
npm run deploy        # deploy to Cloudflare
```

See each worker's README for full setup, secrets, and deployment steps.
