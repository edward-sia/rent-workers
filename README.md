# rent-workers

npm-workspaces monorepo for Cloudflare Workers that automate rent management for the New Haven property.

## Layout

| Path | What it is | Status |
|---|---|---|
| [`packages/airtable-client/`](./packages/airtable-client/) | Shared Airtable REST client with Zod validation, pagination, retries, and timeouts | Used by both workers |
| [`charge-generator/`](./charge-generator/) | Monthly cron Worker that creates rent charges and posts a Discord summary | Productionized |
| [`payment-worker/`](./payment-worker/) | Telegram webhook Worker for recording tenant payments | Productionized |
| [`scripts/check-airtable-schema.ts`](./scripts/check-airtable-schema.ts) | Airtable schema-drift check used locally and by CI | Added in Phase 5 |
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
npm run lint
npm run test
npm run build
npm run build:staging
npm run build:production
npm run check:schema
```

`npm run check:schema` requires real Airtable credentials in the environment and is the only check that should touch the live Airtable API.

Per-worker development still works from each worker directory:

```bash
cd charge-generator && npm run dev
cd payment-worker && npm run dev
```

## Production Setup Notes

`charge-generator` requires a high-entropy bearer token for manual `/run` requests:

```bash
cd charge-generator
npx wrangler secret put RUN_TOKEN
```

Manual run:

```bash
curl -H "Authorization: Bearer $RUN_TOKEN" \
  https://charge-generator.<subdomain>.workers.dev/run
```

`payment-worker` requires a Telegram webhook secret. Generate a high-entropy value, store it as a Worker secret, then register the Telegram webhook with the same value:

```bash
cd payment-worker
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://payment-bot.<subdomain>.workers.dev" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

GitHub repository secrets for the nightly schema check:

| Secret | Purpose |
|---|---|
| `AIRTABLE_TOKEN` | Read-only PAT for Airtable schema checks |
| `AIRTABLE_BASE_ID` | Airtable base ID, for example `app6He8xRaUzNBTDl` |
| `DISCORD_WEBHOOK_URL` | Alert target for schema drift |

## CI

| Workflow | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Typecheck, lint, test, and build on push/PR |
| `.github/workflows/deploy-staging.yml` | Deploy both Workers to staging after `main` is updated, then smoke test `/health` and Telegram webhook registration |
| `.github/workflows/deploy-production.yml` | Manual, approval-gated production deploy from `main` |
| `.github/workflows/schema-check.yml` | Nightly and manual Airtable schema-drift check |

## Staging

Staging uses separate Cloudflare Worker names, a separate Airtable base, a separate Telegram bot, and a separate KV namespace:

| Component | Staging value |
|---|---|
| Airtable base | `appzRYFa1yW5pQDEW` |
| Telegram bot | `@ChwqueudciBot` |
| Charge Worker | `charge-generator-staging` |
| Payment Worker | `payment-bot-staging` |
| Payment KV namespace | `RENT_STAGING_KV` / `17e24003884e454dbd96d81acc37bf2d` |

See [`docs/staging-cicd.md`](./docs/staging-cicd.md) for the GitHub Environment variables/secrets and Cloudflare secret setup.

## Production Deploy

Production deploy is manual and approval-gated. It must run from `main` through `.github/workflows/deploy-production.yml`.

See [`docs/production-cicd.md`](./docs/production-cicd.md) for the GitHub Environment variables/secrets, Cloudflare secret setup, and run instructions.

## Documentation Policy

Docs are updated alongside implementation phases. When a phase changes behavior, configuration, secrets, commands, or file layout, update the relevant README and `AGENTS.md` before pushing that phase.
