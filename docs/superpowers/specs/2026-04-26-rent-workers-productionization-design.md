# Rent-Workers Productionization — Design Spec

**Date:** 2026-04-26
**Status:** Approved (pending implementation plan)
**Scope:** Both workers — `charge-generator` and `payment-worker`
**Goal:** Productionize both workers and establish persistent regression-test confidence.

---

## 1. Scope and approach

This work is **Tests + Light Hardening**. We add a test framework, comprehensive tests, CI, schema-drift detection, security fixes for both public endpoints, retries/timeouts on outbound HTTP, and a shared Airtable client to eliminate duplication. We do **not** add staging environments, alerting beyond Discord, or auto-deploy pipelines.

Two non-negotiable success criteria:

1. **Regression confidence:** every business-logic branch is covered by an automated test that runs in CI on every push, and a nightly schema-drift check catches Airtable changes within 24 hours.
2. **No public endpoints unauthenticated:** `/run` on charge-generator and the Telegram webhook on payment-worker both verify a shared secret before doing any work.

---

## 2. Repository structure

Convert the repo from two side-by-side npm packages into an npm-workspaces monorepo:

```
rent-workers/
├── package.json              # workspaces root
├── tsconfig.base.json        # shared TS config
├── vitest.workspace.ts       # runs both workers' tests
├── .github/workflows/        # ci.yml, schema-check.yml
├── packages/
│   └── airtable-client/      # shared package: @rent/airtable-client
│       ├── src/
│       │   ├── client.ts     # fetchAll, create — with retries, timeouts, Zod
│       │   ├── qs.ts         # buildQS
│       │   ├── schemas.ts    # Tenancy / Charge / Payment Zod schemas
│       │   ├── tables.ts     # table ID constants
│       │   └── index.ts      # public re-exports
│       ├── test/
│       └── package.json
├── charge-generator/
│   ├── src/
│   │   ├── index.ts          # entry — fetch + scheduled handlers
│   │   ├── charges.ts        # generateCharges()
│   │   ├── due-date.ts       # resolveDueDate() — pure
│   │   ├── discord.ts        # notifyDiscord()
│   │   └── auth.ts           # bearer-token check for /run
│   └── test/
├── payment-worker/
│   ├── src/
│   │   ├── index.ts          # entry — webhook secret check + handler
│   │   ├── bot.ts            # grammy bot factory + step wiring
│   │   ├── session.ts        # KV helpers
│   │   ├── format.ts         # formatAUD, parseAmount, parseDate, todayISO
│   │   ├── auth.ts           # webhook secret + AUTHORIZED_USER_ID guards
│   │   └── types.ts
│   └── test/
└── scripts/
    └── check-airtable-schema.ts  # schema-drift script
```

Workers stay deployable independently via `npm run deploy` from each worker directory. Wrangler bundles `@rent/airtable-client` at deploy time (no separate publish step).

---

## 3. Shared `@rent/airtable-client` package

### Public API

```ts
// schemas.ts
import { z } from 'zod';

export const TenancySchema = z.object({
  Label:          z.string(),
  'Monthly Rent': z.number().optional(),
  'Start Date':   z.string().optional(),
  'End Date':     z.string().optional(),
  'Due Day':      z.number().int().min(1).max(28).optional(),
  Balance:        z.number().optional(),
});
export type Tenancy = z.infer<typeof TenancySchema>;

// + ChargeSchema, PaymentSchema, AirtableRecordSchema<T>(inner)

// tables.ts
export const TABLES = {
  TENANCIES: 'tblvVmo12VikITRH6',
  CHARGES:   'tblNCw6ZxspNxiKCu',
  PAYMENTS:  'tbl8Zl9C9fzBDPllu',
} as const;

// client.ts
export interface AirtableEnv {
  AIRTABLE_TOKEN:   string;
  AIRTABLE_BASE_ID: string;
}

export class AirtableClient {
  constructor(env: AirtableEnv);
  fetchAll<T>(
    tableId: string,
    schema: z.ZodType<T>,
    params?: QueryParams,
  ): Promise<AirtableRecord<T>[]>;
  create<T>(
    tableId: string,
    schema: z.ZodType<T>,
    fields: Partial<T>,
  ): Promise<AirtableRecord<T>>;
}
```

### Behaviour

- **Schema validation:** every fetched record is parsed with the provided Zod schema. Parse failure throws an error including field path and actual value, so a renamed Airtable field fails the read with an actionable message.
- **Timeouts:** every fetch wrapped in `AbortSignal.timeout(10_000)`.
- **Retries:** on `5xx` or network error, retry up to 2 times with exponential backoff (200ms, then 800ms). On `4xx`, fail immediately (these are programmer errors, not transient faults).
- **Pagination:** `offset` handling preserved exactly as today.
- **Errors:** distinguish `RetryableError` and `PermanentError` so logs unambiguously identify failure mode.

### Why a class, not free functions

The class lets us bind `env` once at construction and avoid threading it through every call site. It also gives us a single place to inject a custom `fetch` implementation in tests if `fetchMock` proves limiting.

---

## 4. Security hardening

### `/run` on charge-generator

- New secret `RUN_TOKEN` set via `wrangler secret put RUN_TOKEN`.
- Worker checks `Authorization: Bearer <RUN_TOKEN>` header before invoking `generateCharges()`.
- Returns 401 with empty body on mismatch.
- Length-check the header before string-compare to short-circuit obviously wrong inputs. Constant-time compare not needed (high-entropy token, not a login flow).

### Telegram webhook on payment-worker

- New secret `TELEGRAM_WEBHOOK_SECRET` set via `wrangler secret put TELEGRAM_WEBHOOK_SECRET`.
- Worker entry point checks `request.headers.get('X-Telegram-Bot-Api-Secret-Token') === env.TELEGRAM_WEBHOOK_SECRET` before invoking grammy. Returns 401 otherwise.
- Telegram's `setWebhook` API accepts `secret_token`; once registered, Telegram echoes it on every webhook POST.
- The existing `AUTHORIZED_USER_ID` middleware stays — it's a second layer on top of the webhook secret.

### Threat model addressed

- **Before:** anyone discovering the `/run` URL could trigger an Airtable run; anyone discovering the Telegram webhook URL could POST forged updates (mitigated only by the user-ID guard, but they could still spam the bot's Airtable reads with crafted callback queries).
- **After:** both endpoints require knowledge of a 256-bit secret. The user-ID guard remains as defence-in-depth on the Telegram side.

---

## 5. Test strategy

### Framework

`vitest` + `@cloudflare/vitest-pool-workers`. Real `workerd` runtime, real KV in-memory, native fetch interception via the pool's `fetchMock`.

### Layers

**Layer 1 — pure unit tests** (no Worker runtime needed, run on plain Node):

- `due-date.test.ts` — `resolveDueDate()`: Due Day override, Start Date day fallback, 28-day cap (Feb), leap year, missing both fields.
- `format.test.ts` — `formatAUD`, `parseAmount` (`$1,650`, `1650.00`, `1650`; rejects `abc`, `-5`, `0`), `parseDate` (`YYYY-MM-DD`, `DD/MM/YYYY`; rejects `2026-13-40`).
- `qs.test.ts` — `buildQS()`: array → `fields[]=`, scalar → `key=`, offset appended last.
- `airtable-client.test.ts` — retries on 503 (succeeds attempt 2), no retry on 422, timeout fires at 10s, schema parse error includes field path.

**Layer 2 — integration tests** (full Worker, mocked HTTP):

*charge-generator:*

- `scheduled.test.ts` — invokes `SELF.scheduled()`:
  - Happy path: 3 active tenancies, 0 existing charges → 3 created, Discord posted with green embed.
  - Idempotency: 3 active, 2 already exist → 1 created, 2 skipped, yellow Discord.
  - Partial failure: Airtable POST returns 422 for one tenancy → 2 created, 1 error, red Discord, error logged.
  - Discord webhook 502 → charges still created, function returns successfully (Discord failure non-fatal).
  - End-dated tenancy excluded by filter → not in created list.
  - Airtable 503 on read → retries, then succeeds.
- `fetch.test.ts` — `/run` requires bearer; valid bearer triggers same path; root path returns banner.

*payment-worker:*

- `webhook.test.ts` — wrong/missing `X-Telegram-Bot-Api-Secret-Token` → 401; correct token → handled.
- `auth.test.ts` — Telegram update from non-`AUTHORIZED_USER_ID` → "⛔ Unauthorised", session never written.
- `wizard.test.ts` — full happy path simulating 6 callback queries / messages:
  - `/pay` → tenant list rendered.
  - tenant tap → charges rendered, session written.
  - charge tap → amount prompt, session updated.
  - text "1650" → method buttons.
  - tap "Cash" → date buttons.
  - tap "Today" → confirmation card.
  - tap "Confirm" → Airtable create called with expected payload, success message includes deep link, session cleared.
- `wizard-edge.test.ts`:
  - Invalid amount `abc` → error reply, session unchanged.
  - Invalid manual date `2026-13-01` → error reply, session unchanged.
  - `/cancel` from any step → session cleared.
  - Confirm with expired session (KV miss) → "Session expired" reply, no Airtable write.
  - Tenant has zero outstanding charges → "no outstanding charges" message, no charge step.

**Layer 3 — schema-drift script** (`scripts/check-airtable-schema.ts`):

- Hits `https://api.airtable.com/v0/meta/bases/{baseId}/tables`.
- For each of Tenancies/Charges/Payments, asserts the field names + types we depend on still exist with compatible types.
- Exits non-zero on mismatch, with a diff in stdout.
- Run via `npm run check:schema`; nightly GitHub Actions workflow runs it and posts to Discord on failure.

### Coverage target

Every business-logic branch covered. CI fails on coverage drop greater than 2% from the baseline established at the end of this work.

---

## 6. CI workflows

### `.github/workflows/ci.yml` — every push and PR

```yaml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-node 22
      - npm ci
      - npm run typecheck   # tsc --noEmit across all workspaces
      - npm run lint        # ESLint with @typescript-eslint/recommended
      - npm run test        # vitest run across all workspaces
      - npm run build       # wrangler deploy --dry-run for both workers
```

Fails on: any test failure, any type error, coverage drop greater than 2%.

### `.github/workflows/schema-check.yml` — nightly cron + manual dispatch

```yaml
on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily
  workflow_dispatch:
jobs:
  schema-check:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-node 22
      - npm ci
      - npm run check:schema
      - on failure: POST diff to DISCORD_WEBHOOK_URL
```

### Required GitHub repo secrets

- `AIRTABLE_TOKEN` — read-only PAT recommended for the schema check (separate from the read+write token used by the workers).
- `AIRTABLE_BASE_ID`.
- `DISCORD_WEBHOOK_URL`.

### Deploy stays manual

`npm run deploy` per worker. No auto-deploy on merge — explicit human-in-the-loop is appropriate for a workflow that writes to production Airtable.

---

## 7. Implementation sequencing

Refactor and tests are interleaved so the repo never sits in a half-broken state and integration tests lock in existing behaviour before further changes.

1. **Monorepo skeleton:** workspaces root, `tsconfig.base.json`, `vitest.workspace.ts`, top-level scripts. Workers continue to build and deploy unchanged.
2. **Build `@rent/airtable-client` test-first:** new code, so every helper is written alongside its test. Retries, timeouts, Zod parsing, pagination, schema-tables module — all green before any worker depends on it.
3. **charge-generator migration:**
   - Extract `due-date.ts`, `discord.ts`, `auth.ts`. Unit-test each.
   - Migrate `index.ts` to use `@rent/airtable-client`.
   - Add `/run` bearer check.
   - Write integration tests against cron + fetch handlers (these characterize the existing orchestration and lock it in).
4. **payment-worker migration:**
   - Extract `format.ts`, `session.ts`, `auth.ts`. Split `bot.ts` into per-step modules where it improves clarity.
   - Migrate to `@rent/airtable-client`.
   - Add webhook-secret check at the entry point.
   - Write integration tests against the full webhook flow.
5. **Schema-drift script + CI workflows.** Depend on everything above being in place.
6. **Documentation sweep.** Updated in lockstep with each migration step, finalized at the end.
7. **Align `compatibility_date`** in both `wrangler.jsonc` / `wrangler.toml` to a recent shared date (today's: `2026-04-26` or close). Today the workers run on different `workerd` versions (2024-01-01 vs 2025-01-01) — aligning removes an avoidable source of "works on one but not the other" drift.

Each step is a small, reviewable change. `main` is always green and deployable.

---

## 8. Documentation updates

Files touched or created:

- `README.md` (root) — monorepo layout, dev commands, production setup pointer.
- `charge-generator/README.md` — env vars table includes `RUN_TOKEN`; manual-trigger curl example uses the bearer header; new "Testing" section.
- `payment-worker/README.md` — env vars table includes `TELEGRAM_WEBHOOK_SECRET`; `setWebhook` curl uses `secret_token=`; architecture diagram caption mentions the webhook-secret check; new "Testing" section.
- `packages/airtable-client/README.md` — new. API surface, schemas, retry semantics, "how to add a new table".
- `charge-generator/AGENTS.md` — sweep for accuracy after the refactor.
- `docs/runbook.md` — new, short. "What to do when": cron didn't fire, schema check failed, Telegram bot stops responding, all charges errored.

No top-level `CLAUDE.md` will be created.

---

## 9. Manual steps required from the operator

These cannot be done by code; they need to happen during or just after deployment of the changes.

1. `cd charge-generator && wrangler secret put RUN_TOKEN` — value: `openssl rand -hex 32`.
2. `cd payment-worker && wrangler secret put TELEGRAM_WEBHOOK_SECRET` — value: `openssl rand -hex 32`.
3. Re-register the Telegram webhook with the secret:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://payment-bot.<sub>.workers.dev" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
4. Add GitHub repo secrets for the nightly schema check:
   - `AIRTABLE_TOKEN` (read-only PAT recommended)
   - `AIRTABLE_BASE_ID`
   - `DISCORD_WEBHOOK_URL`
5. Update any saved `/run` invocations or shortcuts to include `Authorization: Bearer <RUN_TOKEN>`.

This list will also live at the top of the root README under "Post-merge setup" and in each worker's README.

---

## 10. Out of scope (explicitly)

To prevent scope creep during implementation, these are deliberately excluded:

- Staging vs prod environment split.
- Cloudflare Access in front of either Worker.
- A real sandbox Airtable base for E2E tests.
- Auto-deploy on merge.
- Multi-user support on payment-worker.
- Externalizing table IDs to env vars (kept as code constants, paired with their Zod schemas).
- A top-level `CLAUDE.md`.
- Alerting beyond the existing Discord channel.

These can be revisited in a follow-up if the situation demands; not now.
