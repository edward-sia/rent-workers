# rent-workers

npm-workspaces monorepo for Cloudflare Workers that automate rent management for the New Haven property.

## Layout

| Path | What it is | Status |
|---|---|---|
| [`packages/airtable-client/`](./packages/airtable-client/) | Shared Airtable REST client with Zod validation, pagination, retries, and timeouts | In use by `charge-generator` |
| [`charge-generator/`](./charge-generator/) | Monthly cron Worker that creates rent charges and posts a Discord summary | Productionized in Phase 3 |
| [`payment-worker/`](./payment-worker/) | Telegram webhook Worker for recording tenant payments | Pending Phase 4 migration |
| [`docs/superpowers/`](./docs/superpowers/) | Approved productionization spec and implementation plan | Source of truth for remaining phases |

## Shared Airtable Base

Both workers operate on `app6He8xRaUzNBTDl`:

```
Tenancies ---- read by charge-generator and payment-worker
Charges   ---- written by charge-generator; read/written by payment-worker
Payments  ---- written by payment-worker
```

## Development

Install once at the repo root:

```bash
npm install
```

Common checks:

```bash
npm run typecheck
npm run test
npm run build
```

Per-worker development still works from each worker directory:

```bash
cd charge-generator && npm run dev
cd payment-worker && npm run dev
```

## Production Setup Notes

`charge-generator` now requires a high-entropy bearer token for manual `/run` requests:

```bash
cd charge-generator
npx wrangler secret put RUN_TOKEN
```

Manual run:

```bash
curl -H "Authorization: Bearer $RUN_TOKEN" \
  https://charge-generator.<subdomain>.workers.dev/run
```

The remaining payment bot hardening is planned for Phase 4: `TELEGRAM_WEBHOOK_SECRET`, Airtable client migration, and Worker integration tests.

## Documentation Policy

Docs are updated alongside implementation phases. When a phase changes behavior, configuration, secrets, commands, or file layout, update the relevant README and `AGENTS.md` before pushing that phase.
