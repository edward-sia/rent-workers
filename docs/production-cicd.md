# Production CI/CD

Production deployment is intentionally manual and approval-gated.

Unlike staging, production does not deploy automatically on every `main` push. Run `.github/workflows/deploy-production.yml` manually from `main` after the staging workflow has passed.

## GitHub Environment: `production`

Create a GitHub Environment named `production`.

Recommended protection:

- Required reviewers: enabled.
- Deployment branches: `main` only.

Set these environment secrets:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token allowed to deploy Workers and read/write Worker settings |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |
| `PRODUCTION_TELEGRAM_BOT_TOKEN` | Production Telegram bot token |
| `PRODUCTION_TELEGRAM_WEBHOOK_SECRET` | Production Telegram webhook `secret_token`; must match the Cloudflare `TELEGRAM_WEBHOOK_SECRET` on `payment-bot` |
| `PRODUCTION_CF_ACCESS_CLIENT_ID` | Optional Cloudflare Access service-token client id for production smoke tests |
| `PRODUCTION_CF_ACCESS_CLIENT_SECRET` | Optional Cloudflare Access service-token client secret for production smoke tests |

Set these environment variables:

| Variable | Example |
|---|---|
| `PRODUCTION_CHARGE_GENERATOR_URL` | `https://charge-generator.<subdomain>.workers.dev` |
| `PRODUCTION_PAYMENT_BOT_URL` | `https://payment-bot.<subdomain>.workers.dev` |

Do not store Airtable PATs, Discord webhooks, or Telegram bot tokens as plaintext GitHub variables.

If a production Worker route is protected by Cloudflare Access, create an Access service token, allow that token in the relevant Access application policy, and set both `PRODUCTION_CF_ACCESS_CLIENT_ID` and `PRODUCTION_CF_ACCESS_CLIENT_SECRET`. The smoke test sends those headers to `/health` when both secrets are present.

## Cloudflare Production Secrets

These production Worker secrets should already exist. If rotating or setting them up from scratch, use:

For `charge-generator`:

```bash
cd charge-generator
npx wrangler secret put AIRTABLE_TOKEN --env=""
npx wrangler secret put DISCORD_WEBHOOK_URL --env=""
npx wrangler secret put RUN_TOKEN --env=""
```

For `payment-bot`:

```bash
cd payment-worker
npx wrangler secret put TELEGRAM_BOT_TOKEN --env=""
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env=""
npx wrangler secret put AIRTABLE_TOKEN --env=""
npx wrangler secret put AUTHORIZED_USER_ID --env=""
```

`--env=""` deliberately targets the top-level production Wrangler configuration.

## Deployment Flow

The production workflow does:

1. Confirm it is running from `refs/heads/main`.
2. Confirm the manual input is exactly `deploy-production`.
3. Wait for GitHub Environment `production` approval if reviewers are configured.
4. Install dependencies.
5. Run `npm run typecheck`.
6. Run `npm run lint --if-present`.
7. Run `npm run test`.
8. Run `npm run build`.
9. Run `npm run build:production`.
10. Deploy `charge-generator` to production.
11. Deploy `payment-bot` to production.
12. Register the production Telegram webhook to `PRODUCTION_PAYMENT_BOT_URL`.
13. Smoke test both production `/health` endpoints, using Cloudflare Access service-token headers if configured.
14. Verify Telegram webhook registration with `getWebhookInfo`.

## Manual Run

From GitHub Actions:

1. Open `deploy-production`.
2. Choose `Run workflow`.
3. Select branch `main`.
4. Enter `deploy-production`.
5. Approve the `production` environment deployment.

From the GitHub CLI:

```bash
gh workflow run deploy-production.yml --ref main -f confirm=deploy-production
```

## Local Verification

Before running production deployment:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:staging
npm run build:production
```

`npm run deploy:production` deploys both production Workers from a local machine if Cloudflare auth is available. Prefer the GitHub workflow for auditable production releases.
