# Cloudflare Workers

STOP. Cloudflare Workers APIs, Wrangler config, and platform limits change over time. Retrieve current Cloudflare documentation before changing Workers runtime behavior, bindings, compatibility flags, limits, or Wrangler commands.

## Current Worker Shape

`charge-generator` is a TypeScript Cloudflare Worker.

| File | Responsibility |
|---|---|
| `src/index.ts` | Worker entrypoint: scheduled handler and `/run` fetch route |
| `src/charges.ts` | Charge-generation orchestration |
| `src/due-date.ts` | Pure due-date resolver |
| `src/discord.ts` | Discord summary webhook |
| `src/auth.ts` | `/run` bearer-token guard |

Airtable I/O lives in the shared workspace package `@rent/airtable-client`; do not reintroduce local Airtable fetch helpers in this worker.

Discord notifications and Cloudflare logs must stay minimized: use counts, status codes, and stable Airtable record IDs, not tenant labels, rent amounts, or raw upstream response bodies.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local development |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run typecheck` | TypeScript check for this worker |
| `npm run build` | Wrangler deploy dry-run |
| `npm run cf-typegen` | Generate Worker binding types |

From the repo root:

| Command | Purpose |
|---|---|
| `npm run typecheck` | Type-check all workspaces |
| `npm run test -- charge-generator` | Run this worker's tests |
| `npm run test` | Run all workspace tests |
| `npm run build` | Dry-run builds for deployable workers |

## Secrets

`/run` requires `RUN_TOKEN`:

```bash
npx wrangler secret put RUN_TOKEN
```

Manual runs must include:

```bash
Authorization: Bearer <RUN_TOKEN>
```

## Docs Discipline

When changing behavior, config, secrets, file layout, commands, or operational steps, update this file and the relevant README in the same phase/commit series. Do not defer obvious documentation drift to the final documentation sweep.

## Product Docs

- Workers: https://developers.cloudflare.com/workers/
- Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Errors: https://developers.cloudflare.com/workers/observability/errors/

For limits and quotas, retrieve the relevant product `/platform/limits/` page.
