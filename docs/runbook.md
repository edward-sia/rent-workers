# Runbook

Operational notes for behavior that has landed on the productionization branch.

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

## Discord webhook failed

Discord notification failures are non-fatal. Charges may already have been created even when the Discord webhook returns 5xx.

Check:

1. Cloudflare logs for `[Discord] webhook failed`.
2. The Worker secret `DISCORD_WEBHOOK_URL`.
3. The Discord channel webhook still exists.

After fixing the webhook, you can manually rerun `/run`; duplicate charges should be skipped.

## Tests warn about compatibility date fallback

The current `@cloudflare/vitest-pool-workers` dependency bundles an older local Workers runtime and may warn that it falls back from the configured compatibility date during tests.

Current handling:

- Keep the warning visible.
- Trust `npm run build` / Wrangler dry-run for deploy bundling.
- Treat upgrading the Workers Vitest pool and Vitest major version as a separate tooling task, not part of Phase 3.

## Documentation drift

When behavior, secrets, commands, file layout, or operational steps change, update the matching README / `AGENTS.md` in the same phase.

Do not wait for the final documentation sweep unless the change is purely editorial.
