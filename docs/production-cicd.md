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
| `PRODUCTION_CF_ACCESS_CLIENT_ID` | Cloudflare Access service-token client id required for production smoke tests |
| `PRODUCTION_CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service-token client secret required for production smoke tests |

Set these environment variables:

| Variable | Example |
|---|---|
| `PRODUCTION_CHARGE_GENERATOR_URL` | `https://charge-generator.<subdomain>.workers.dev` |
| `PRODUCTION_PAYMENT_BOT_URL` | `https://payment-bot.<subdomain>.workers.dev` |

Do not store Airtable PATs, Discord webhooks, or Telegram bot tokens as plaintext GitHub variables.

The current production Worker URLs are protected by Cloudflare Access. Create an Access service token, allow that token in the relevant Access application policies with action `Service Auth`, and set both `PRODUCTION_CF_ACCESS_CLIENT_ID` and `PRODUCTION_CF_ACCESS_CLIENT_SECRET`. The production smoke test always sends those headers to `/health`. Manual `/run` calls to the same hostname must also include those Access headers in addition to `Authorization: Bearer <RUN_TOKEN>`.

Production has three distinct authentication layers:

| Layer | Used by | What it proves |
|---|---|---|
| Cloudflare Access `Allow` policy with an email selector | Browser sessions | The signed-in human is allowed to reach the Worker hostname |
| Cloudflare Access `Service Auth` policy with a service token | CI smoke tests and scripted calls | The automated caller is allowed to reach the Worker hostname |
| Worker `RUN_TOKEN` bearer check | Manual `/run` only | The caller intentionally has permission to execute the mutating charge-generation job |

Keep `RUN_TOKEN` even though production already uses Cloudflare Access. The Access policies decide whether a request can reach the Worker; `RUN_TOKEN` decides whether a request that reached the Worker may trigger `/run`. This prevents an authenticated browser session or a broad service-token policy from accidentally executing charge generation.

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

For manual `charge-generator` production reruns behind Cloudflare Access, send both authentication layers:

```bash
curl \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $RUN_TOKEN" \
  "$PRODUCTION_CHARGE_GENERATOR_URL/run"
```

Debug Access separately before triggering `/run`:

```bash
curl --include \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "$PRODUCTION_CHARGE_GENERATOR_URL/health"
```

This must return `200` before `/run` can work. A `302` here means the Access service token is missing, wrong, expired, or not included by a `Service Auth` policy on the Access application.

If `/health` returns `200` with the Access headers but `/run` still returns `302`, check for a separate or more-specific Cloudflare Access application/path policy protecting `/run`. Add the same service token to that `/run` policy with action `Service Auth`.

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
13. Smoke test both production `/health` endpoints with Cloudflare Access service-token headers.
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
