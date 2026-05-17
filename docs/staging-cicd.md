# Staging CI/CD

This repo now has a staging deployment lane for the two Cloudflare Workers.

## Staging Resources

| Resource | Value |
|---|---|
| Airtable staging base | `appzRYFa1yW5pQDEW` |
| Telegram staging bot | `@ChwqueudciBot` |
| Discord staging webhook | configured outside the repo |
| Staging KV binding | `SESSION_KV` |
| Staging KV namespace name | `RENT_STAGING_KV` |
| Staging KV namespace id | `17e24003884e454dbd96d81acc37bf2d` |
| Charge Worker name | `charge-generator-staging` |
| Payment Worker name | `payment-bot-staging` |

## GitHub Environment: `staging`

Create a GitHub Environment named `staging`.

Set these environment secrets:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token allowed to deploy Workers and read/write Worker settings |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |
| `STAGING_TELEGRAM_BOT_TOKEN` | Bot token for `@ChwqueudciBot` |
| `STAGING_TELEGRAM_WEBHOOK_SECRET` | High-entropy Telegram webhook `secret_token` |

Set these environment variables:

| Variable | Example |
|---|---|
| `STAGING_CHARGE_GENERATOR_URL` | `https://charge-generator-staging.<subdomain>.workers.dev` |
| `STAGING_PAYMENT_BOT_URL` | `https://payment-bot-staging.<subdomain>.workers.dev` |

Do not store Airtable PATs, Discord webhooks, or Telegram bot tokens as plaintext GitHub variables.

## Cloudflare Staging Secrets

Set Worker secrets directly in Cloudflare with Wrangler.

For `charge-generator-staging`:

```bash
cd charge-generator
npx wrangler secret put AIRTABLE_TOKEN --env staging
npx wrangler secret put DISCORD_WEBHOOK_URL --env staging
npx wrangler secret put RUN_TOKEN --env staging
```

For `payment-bot-staging`:

```bash
cd payment-worker
npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
npx wrangler secret put AIRTABLE_TOKEN --env staging
npx wrangler secret put AUTHORIZED_USER_ID --env staging
```

`AIRTABLE_BASE_ID` is not a secret; staging is configured in Wrangler as `appzRYFa1yW5pQDEW`.

## Deployment Flow

`.github/workflows/deploy-staging.yml` runs on every push to `main` and can also be started manually.

It does:

1. Install dependencies.
2. Run `npm run typecheck`.
3. Run `npm run lint --if-present`.
4. Run `npm run test`.
5. Run `npm run build`.
6. Deploy `charge-generator` with `--env staging`.
7. Deploy `payment-worker` with `--env staging`.
8. Register the staging Telegram webhook to `STAGING_PAYMENT_BOT_URL`.
9. Smoke test both staging `/health` endpoints.
10. Verify Telegram webhook registration with `getWebhookInfo`.

## Local Verification

Before pushing CI/CD changes:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:staging
```

`npm run deploy:staging` deploys both staging Workers from a local machine if Cloudflare auth is available.

## Production Policy

Production deploy is manual and approval-gated. See `docs/production-cicd.md`.
