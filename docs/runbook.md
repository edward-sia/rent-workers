# Runbook

Operational notes for the productionized Workers.

## Staging deploy failed

The staging deploy workflow is `.github/workflows/deploy-staging.yml`.

Check:

1. GitHub Environment `staging` exists.
2. Environment secrets exist: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_TELEGRAM_BOT_TOKEN`, `STAGING_TELEGRAM_WEBHOOK_SECRET`.
3. Environment variables exist: `STAGING_CHARGE_GENERATOR_URL`, `STAGING_PAYMENT_BOT_URL`.
4. Cloudflare staging Worker secrets exist for both Workers. See `docs/staging-cicd.md`.
5. `payment-worker/wrangler.toml` still points staging `SESSION_KV` to `17e24003884e454dbd96d81acc37bf2d`.
6. `charge-generator/wrangler.jsonc` and `payment-worker/wrangler.toml` still point staging `AIRTABLE_BASE_ID` to `appzRYFa1yW5pQDEW`.

Local config check:

```bash
npm run build:staging
```

Smoke endpoint check:

```bash
curl https://charge-generator-staging.<subdomain>.workers.dev/health
curl https://payment-bot-staging.<subdomain>.workers.dev/health
```

## Production deploy failed

The production deploy workflow is `.github/workflows/deploy-production.yml`.

Check:

1. The workflow ran from branch `main`.
2. The manual `confirm` input was exactly `deploy-production`.
3. GitHub Environment `production` exists and the deployment was approved.
4. Environment secrets exist: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_TELEGRAM_BOT_TOKEN`, `PRODUCTION_TELEGRAM_WEBHOOK_SECRET`.
5. Environment variables exist: `PRODUCTION_CHARGE_GENERATOR_URL`, `PRODUCTION_PAYMENT_BOT_URL`.
6. Cloudflare production Worker secrets exist for both Workers. See `docs/production-cicd.md`.

Local config check:

```bash
npm run build:production
```

Smoke endpoint check:

```bash
curl https://charge-generator.<subdomain>.workers.dev/health
curl https://payment-bot.<subdomain>.workers.dev/health
```

## charge-generator did not run on the 15th

1. Check Cloudflare dashboard -> `charge-generator` -> Logs.
2. If there is no log entry, verify the cron in `charge-generator/wrangler.jsonc`:
   ```text
   0 0 15 * *
   ```
3. If the cron fired but failed, look for log lines containing `[YYYY-MM] ERRORS:`.
4. Rerun manually with the bearer token:
   ```bash
   curl -H "Authorization: Bearer $RUN_TOKEN" \
     https://charge-generator.<subdomain>.workers.dev/run
   ```

Manual reruns are idempotent. Existing charges for the same tenancy and period are skipped.

## Manual `/run` returns 401

`/run` now fails closed unless the request includes a valid bearer token.

Check:

- `RUN_TOKEN` exists as a Cloudflare Worker secret.
- The token is at least 16 characters.
- The request header is exactly `Authorization: Bearer <token>`.

Set or rotate the token:

```bash
cd charge-generator
npx wrangler secret put RUN_TOKEN
```

Recommended value:

```bash
openssl rand -hex 32
```

## All charges errored

Check the Cloudflare logs for the first Airtable error.

Common causes:

| Symptom | Likely cause | Action |
|---|---|---|
| `HTTP 401` | Airtable PAT expired, revoked, or missing scope | Rotate `AIRTABLE_TOKEN` with `wrangler secret put AIRTABLE_TOKEN` |
| `HTTP 422` | Airtable field/schema mismatch | Compare `packages/airtable-client/src/schemas.ts` with the Airtable base |
| `Airtable schema mismatch` | Field changed type/name or response shape changed | Update the shared schema and worker code together |
| Repeated 5xx/network errors | Airtable transient outage or network issue | Retry later; client already retries 5xx/network failures twice |

## Airtable schema-check failed

The schema check runs locally via `npm run check:schema` and nightly in GitHub Actions through `.github/workflows/schema-check.yml`.

Check:

1. The workflow or local command has `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID`.
2. The Airtable PAT can read the base metadata/records needed by `scripts/check-airtable-schema.ts`.
3. The output diff for renamed, deleted, or type-changed fields.

Fix:

1. Update `packages/airtable-client/src/schemas.ts` when code needs the new Airtable shape.
2. Update `scripts/check-airtable-schema.ts` required fields when the intended schema changed.
3. Update any worker code or README that still references the old field name.
4. Run `npm run typecheck`, `npm run test`, and `npm run check:schema` before merging.

## Discord webhook failed

Discord notification failures are non-fatal. Charges may already have been created even when the Discord webhook returns 5xx.

Check:

1. Cloudflare logs for `[Discord] webhook failed`.
2. The Worker secret `DISCORD_WEBHOOK_URL`.
3. The Discord channel webhook still exists.

After fixing the webhook, you can manually rerun `/run`; duplicate charges should be skipped.

## Telegram bot returns 401 or stops responding

The payment Worker rejects Telegram webhook POSTs unless Telegram includes the configured secret header.

Check webhook status:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

If `last_error_message` shows `401`, the registered Telegram `secret_token` probably does not match the Worker secret.

Set or rotate the Worker secret:

```bash
cd payment-worker
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Re-register the webhook with the same value:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://payment-bot.<subdomain>.workers.dev" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Then check Cloudflare -> `payment-bot` -> Logs. Repeated 401s from random clients can be ignored unless they come from Telegram after webhook registration.

## Tests warn about compatibility date fallback

The current `@cloudflare/vitest-pool-workers` dependency bundles an older local Workers runtime and may warn that it falls back from the configured compatibility date during tests.

Current handling:

- Keep the warning visible.
- Trust `npm run build` / Wrangler dry-run for deploy bundling.
- Treat upgrading the Workers Vitest pool and Vitest major version as a separate tooling task.

## Documentation drift

When behavior, secrets, commands, file layout, or operational steps change, update the matching README / `AGENTS.md` in the same phase.

Do not wait for the final documentation sweep unless the change is purely editorial.
