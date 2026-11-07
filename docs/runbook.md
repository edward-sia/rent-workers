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

Production auth layers:

| Layer | Used by | Failure shape |
|---|---|---|
| Cloudflare Access email `Allow` policy | Browser access for approved humans | Browser gets a Cloudflare login prompt or `403` |
| Cloudflare Access service-token `Service Auth` policy | GitHub smoke tests and `curl` scripts | `curl` receives `302`/HTML before the Worker responds |
| Worker `RUN_TOKEN` bearer check | Manual `/run` charge generation | Worker returns `401 Unauthorized` |

Check:

1. The workflow ran from branch `main`.
2. The manual `confirm` input was exactly `deploy-production`.
3. GitHub Environment `production` exists and the deployment was approved.
4. Environment secrets exist: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_TELEGRAM_BOT_TOKEN`, `PRODUCTION_TELEGRAM_WEBHOOK_SECRET`, `PRODUCTION_CF_ACCESS_CLIENT_ID`, `PRODUCTION_CF_ACCESS_CLIENT_SECRET`.
5. Environment variables exist: `PRODUCTION_CHARGE_GENERATOR_URL`, `PRODUCTION_PAYMENT_BOT_URL`.
6. The Cloudflare Access service token is included in the production Access application policies with action `Service Auth`.
7. Cloudflare production Worker secrets exist for both Workers. See `docs/production-cicd.md`.

Local config check:

```bash
npm run build:production
```

Smoke endpoint check:

```bash
curl https://charge-generator.<subdomain>.workers.dev/health
curl https://payment-bot.<subdomain>.workers.dev/health
```

If the smoke test logs show `Expected JSON` with an HTML body or a 302 login response, Cloudflare Access rejected the smoke-test request before it reached the Worker. Confirm `PRODUCTION_CF_ACCESS_CLIENT_ID` and `PRODUCTION_CF_ACCESS_CLIENT_SECRET` are set in the GitHub `production` environment, then confirm the same service token is allowed by the relevant Access application policy with action `Service Auth`.

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

The generator also skips a tenancy when the period's due date is before its `Start Date` or after its `End Date`. The Discord summary lists these as `tenancy <id>` under their own "⏭ Skipped: outside tenancy dates" heading. "Already existed" lists only tenancies that already had a charge for the period. The log line counts them as `outside=<n>`. That is expected for a tenancy that has ended or has not started. If a tenancy that should get a charge shows up there, check its `Start Date`, `End Date` and `Due Day`.

## Manual `/run` returns 401

`/run` now fails closed unless the request includes a valid bearer token.

Check:

- `RUN_TOKEN` exists as a Cloudflare Worker secret.
- The token is at least 16 characters.
- The request header is exactly `Authorization: Bearer <token>`.
- If the response is `302` or HTML from `newhaven.cloudflareaccess.com`, Cloudflare Access blocked the request before it reached the Worker. Include valid Access service-token headers or update the Access policy.

Test Cloudflare Access on the non-mutating health endpoint before rerunning charges:

```bash
curl --include \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://charge-generator.<subdomain>.workers.dev/health
```

Expected: `200` with `{"ok":true,"service":"charge-generator"}`.

If this still returns `302`:

- Confirm the local shell variables are set; GitHub Environment secrets are not automatically available in your terminal.
- Confirm `CF_ACCESS_CLIENT_ID` is the Access service-token client id, usually ending in `.access`; it is not `RUN_TOKEN` and not a Cloudflare API token.
- In Cloudflare Zero Trust, the Access application for `charge-generator.<subdomain>.workers.dev` must have a policy with action `Service Auth` that includes this service token.
- Do not configure Access to read service tokens from the `Authorization` header for this Worker; the Worker already uses `Authorization: Bearer <RUN_TOKEN>`.

If `/health` returns `200` with the Access headers but `/run` still returns `302`, inspect Cloudflare Access for a separate or more-specific application/path policy covering `/run`. The `/run` Access application/policy must also include the same service token with action `Service Auth`; authorizing only the health endpoint is not enough.

Set or rotate the token:

```bash
cd charge-generator
npx wrangler secret put RUN_TOKEN --env=""
```

Recommended value:

```bash
openssl rand -hex 32
```

Manual run behind Cloudflare Access:

```bash
curl \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $RUN_TOKEN" \
  https://charge-generator.<subdomain>.workers.dev/run
```

## All charges errored

Check the Cloudflare logs for the first Airtable error.

Common causes:

| Symptom | Likely cause | Action |
|---|---|---|
| `HTTP 401` | Airtable PAT expired, revoked, or missing scope | Rotate `AIRTABLE_TOKEN` with `wrangler secret put AIRTABLE_TOKEN` |
| `HTTP 422` | Airtable field/schema mismatch | Compare `packages/airtable-client/src/schemas.ts` with the Airtable base |
| `Airtable schema mismatch` | Field changed type/name or response shape changed | Update the shared schema and worker code together |
| Repeated 5xx/network errors | Airtable transient outage or network issue | Retry later. The client already retries reads (GET) and updates (PATCH) twice. It sends creates (POST) once, so a failed create may still have saved: check for the record before you create it again |

## Airtable schema-check failed

The schema check runs locally via `npm run check:schema` and nightly in GitHub Actions through `.github/workflows/schema-check.yml`.

Check:

1. The workflow or local command has `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID`.
2. The Airtable PAT can read the base metadata/records needed by `scripts/check-airtable-schema.ts`.
3. The output diff for renamed, deleted, or type-changed fields.

The check covers Tenancies, Charges, Payments, Rooms and Tenants fields. It also checks that Rooms `Status` has the select options `Occupied` and `Vacant`, and that Tenancies `Frequency` has the option `Monthly`. If someone renames one of those options in Airtable, `/movein` and `/moveout` would fail to write, so this check fails first.

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

## `/reminder` output is empty or incorrect

`/reminder` reads Airtable Charges and Tenancies through `@rent/airtable-client`. It includes charges with positive `Balance`, non-`Paid` status, and a `Due Date` that is either before today or from today through the next 14 days.

Output is split into "Pay now" and "Due in next 14 days". Within each section, tenant groups are ordered by their earliest due date, and charge rows within each tenant are also due-date ordered.

Check:

1. The charge has a positive `Balance`.
2. The charge `Status` is `Due`, `Unpaid`, `Partial`, `Overdue`, or blank. `Paid` charges are intentionally hidden.
3. The charge has a valid `Due Date`.
4. The charge has a linked `Tenancy` record, and that tenancy still exists.
5. `AIRTABLE_TOKEN` can read both Charges and Tenancies.

If Airtable field names or status values changed, update `packages/airtable-client/src/schemas.ts`, the schema check script, tests, and this runbook together.

## `/pay` does not list a tenant

`/pay` lists tenancies with no `End Date`, tenancies whose `End Date` is after today, and ended tenancies that still have a positive `Balance`. "Today" here is Airtable's `TODAY()` in the filter formula, not the Melbourne date. A tenant who moved out and still owes money stays in the list until the balance is paid. If a tenancy is missing, check its `End Date` and `Balance` in Airtable.

## `/moveout` and `/movein`: how they work

Both commands only write to Airtable after you tap Confirm. The date buttons, the move-in start-date check and the move-out Vacant decision use the Melbourne date for "today". The `/moveout` tenancy list is different: Airtable filters it with its own `TODAY()`, so near midnight it can be a day off from the Melbourne date. Both reply to errors with an HTTP status and a link, never with the Airtable response body. Worker logs name the failed call and give the same status, for example `[payment-bot] movein failed: create Tenancies: HTTP 422`. Logs never include the response body either.

If tapping Confirm or Cancel replies that the move-out or move-in is "already being saved, or the save has finished", the first Confirm is still running or stopped partway. Wait a minute, then check Airtable for what was written before you start the command again.

### `/moveout`

1. `/moveout` lists tenancies with no `End Date` or an `End Date` after Airtable's `TODAY()`.
2. Pick one, then pick the end date: Today, End of this month, or type a date. The end date cannot be before the tenancy `Start Date`.
3. The confirm screen shows the amount owed through the end date and what will happen to the room.
4. If any charge is due after the end date, the confirm screen lists it with its status and a link. The bot does not change these charges. See "Fixing charges due after an end date" below.
5. Confirm sets the tenancy `End Date`. It sets the room `Status` to `Vacant` only when the end date is today or earlier. For a later end date the room stays `Occupied`. When that day comes, set the room to `Vacant` in Airtable yourself.
6. The reply has a "Start new tenant in {room}" button that begins `/movein` with that room chosen.

If the reply says "Move-out may have saved", open the tenancy link and check whether `End Date` is set before you run `/moveout` again. If the reply says the end date saved but the room was not updated, set the room to `Vacant` in Airtable.

### `/movein`

1. `/movein` lists rooms, vacant ones first. Pick a room.
2. Type the tenant name. If a tenant with that exact `Name` exists, choose "Use existing" or "Create new". A new tenant can get notes.
3. Pick the monthly rent (the room's `Default Rent` button or a typed amount) and the start date (Today, 1st of next month, or typed). A start date more than 60 days in the past is rejected.
4. Pick how the first payment works:
   - **Regular monthly from start date.** The first charge is the full rent, due on the start date. Later charges fall due on the same day each month (day 28 at most).
   - **Part month, then monthly on the 1st.** The first charge is the prorated amount for the rest of the start month (rent x 12 / 365 per day, or an amount you type), due on the start date. Later charges are due on the 1st. This option is not shown when the start date is the 1st.
5. The confirm screen lists the tenant, tenancy label (`{Room code} {Tenant name}`), due day and every charge. It warns if the room is already `Occupied`.
6. Confirm creates the first charge and, when the bot runs on or after the 15th (UTC), next month's charge as well. Before the 15th the charge generator creates next month's charge on its run.

Cost on the Airtable free plan: a move-in uses about 5 to 7 API calls and a move-out about 4. A full staging test run is about 30 calls.

## Finishing a half-done move-in

Confirm writes records in this order, with no rollback:

1. Tenants (skipped when you reused an existing tenant)
2. Tenancies
3. Charges (one write per charge)
4. Rooms: `Status` set to `Occupied`

If a write fails, the bot replies "Move-in not finished". The reply lists the finished steps with links and lists the steps still to do. To finish:

1. Open each link and confirm those records look right.
2. For each step still to do, create the record in Airtable by hand: the Tenancy (with `Room`, `Tenant`, `Start Date`, `Due Day`, `Monthly Rent`, `Frequency` = `Monthly`), then the Charges (`Tenancy`, `Type` = `Rent`, `Period`, `Due Date`, `Amount`, label `{tenancy label} {YYYY-MM} Rent`), then the room `Status`.
3. Do not create a charge that already exists. The charge generator skips a period that already has a charge for the tenancy.

A failure with HTTP 4xx means that step did not save. A reply that says "This step may have saved" (a 5xx, a timeout, or an unreadable response) means Airtable may have applied the write anyway. Open that table first and look for the record before you redo the step. The Airtable client sends each create (POST) once and does not retry it. The record may still exist from that one attempt. Create it by hand only if it is not there. If you do find a duplicate, delete it by hand.

If the reply says "Move-in not saved ... Nothing was changed", the very first write failed with a 4xx. Worker logs show which table and status. Check that table's fields in Airtable, then run `/movein` again.

## Fixing charges due after an end date

When a tenant moves out before the generator's already-created charges are due, those charges stay in Airtable. The `/moveout` confirm screen lists them as "Charges due after the end date". The bot does not edit or delete charges, so fix them by hand.

For each charge listed:

1. Open it with the link on the confirm screen.
2. If the tenant should not pay it, delete the charge, or reduce its `Amount` when the tenant owes part of that month (for example a part month at the end of the tenancy).
3. If a Payment is already linked to the charge, leave the charge and decide with the tenant whether to refund or move the payment.

The charge generator will not create new charges after `End Date`. The Discord summary lists those tenancies under "⏭ Skipped: outside tenancy dates".

## BotFather command list

Telegram shows the command menu from BotFather, not from the Worker. After adding `/movein` and `/moveout`, open @BotFather, send `/setcommands`, choose the bot, and send this text:

```text
pay - Record a tenant payment
reminder - Show overdue and upcoming payments
movein - Start a new tenancy
moveout - End a tenancy
cancel - Cancel current operation
```

Do this once for the production bot and once for the staging bot (`@ChwqueudciBot`). The commands work without it. Only the menu needs it.

## Tests warn about compatibility date fallback

The current `@cloudflare/vitest-pool-workers` dependency bundles an older local Workers runtime and may warn that it falls back from the configured compatibility date during tests.

Current handling:

- Keep the warning visible.
- Trust `npm run build` / Wrangler dry-run for deploy bundling.
- Treat upgrading the Workers Vitest pool and Vitest major version as a separate tooling task.

## Documentation drift

When behavior, secrets, commands, file layout, or operational steps change, update the matching README / `AGENTS.md` in the same phase.

Do not wait for the final documentation sweep unless the change is purely editorial.
