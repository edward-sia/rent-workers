# Rent-Workers Productionization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert two side-by-side Cloudflare Workers (`charge-generator`, `payment-worker`) into a tested, hardened npm-workspaces monorepo with a shared, Zod-validated Airtable client and CI-enforced regression coverage.

**Architecture:** npm workspaces monorepo. New `packages/airtable-client` package centralizes HTTP, retries, timeouts, schema validation, and table IDs. Both workers depend on it via workspace protocol. `vitest` + `@cloudflare/vitest-pool-workers` for tests; GitHub Actions for CI + nightly schema-drift detection. Public endpoints (`/run`, Telegram webhook) gated by shared-secret bearer / `secret_token`.

**Tech Stack:** TypeScript, Cloudflare Workers (`workerd`), npm workspaces, Zod, vitest, `@cloudflare/vitest-pool-workers`, grammy, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-04-26-rent-workers-productionization-design.md`

---

## Implementation progress

Updated: 2026-04-26

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Monorepo skeleton | Complete | Workspaces root, shared TS config, and Vitest workspace are in place. |
| Phase 2 — Shared `@rent/airtable-client` | Complete | Shared Airtable client, schemas, retries, timeouts, and tests are in place. |
| Phase 3 — Migrate `charge-generator` | Complete | `charge-generator` uses `@rent/airtable-client`, `/run` requires `RUN_TOKEN`, and unit/integration tests cover scheduled and fetch flows. |
| Phase 4 — Migrate `payment-worker` | Next | Payment worker docs should be updated as each task lands. |

## Documentation lane

Documentation is no longer deferred entirely to Phase 6. From Phase 4 onward, every task that changes behavior, config, secrets, file layout, commands, or operational steps must include the matching README / `AGENTS.md` update before the task is pushed.

Phase 6 remains as the final documentation sweep, but it should be cleanup rather than the first time docs learn about completed work.

Close each phase with a small docs-sync commit when needed. That commit should update only behavior that has actually landed; do not document future Phase 4/5 secrets, CI workflows, or schema-check behavior before those phases are implemented.

---

## Notes for the implementing engineer

- Active implementation is on the `productionize-workers` branch/worktree. Keep commits small and push stable phase checkpoints to GitHub.
- Both workers must remain deployable at the end of every task. If a task would break a worker mid-way, the task is sized wrong — split it.
- Pure-TypeScript tests run on Node via vitest's default pool. Worker-runtime tests (anything that imports `cloudflare:workers` or uses `SELF.scheduled` / `SELF.fetch`) run via `@cloudflare/vitest-pool-workers`. We configure both pools in `vitest.workspace.ts`.
- `wrangler` reads `compatibility_date` to pick the runtime version. We align both workers to a recent date as part of Phase 5.
- The Airtable base is shared and live. Tests must NEVER hit the real Airtable API — every test uses `fetchMock` (worker-pool) or stubbed `fetch` (Node). The schema-drift script is the only thing that hits real Airtable.

---

## Phase 1 — Monorepo skeleton

Goal of phase: convert the repo into npm workspaces without changing any worker behavior. Both workers must still `wrangler deploy --dry-run` cleanly at the end of this phase.

### Task 1.1: Add workspace root `package.json`

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "rent-workers",
  "version": "0.0.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "charge-generator",
    "payment-worker"
  ],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint":      "npm run lint      --workspaces --if-present",
    "test":      "vitest run",
    "test:watch":"vitest",
    "build":     "npm run build     --workspaces --if-present",
    "check:schema": "tsx scripts/check-airtable-schema.ts"
  },
  "devDependencies": {
    "typescript":  "^5.5.2",
    "vitest":      "^2.1.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "tsx":         "^4.19.0",
    "zod":         "^3.23.8",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser":        "^8.8.0",
    "eslint":      "^9.12.0"
  }
}
```

- [ ] **Step 2: Run `npm install` at the repo root**

Run: `npm install`
Expected: creates a single root `node_modules/` and a single root `package-lock.json`. Both workers' existing `package-lock.json` files become unused (we'll delete them next).

- [ ] **Step 3: Delete per-worker `package-lock.json` and `node_modules/`**

```bash
rm -rf charge-generator/package-lock.json charge-generator/node_modules
rm -rf payment-worker/package-lock.json   payment-worker/node_modules
```

- [ ] **Step 4: Verify both workers still build**

```bash
cd charge-generator && npx wrangler deploy --dry-run --outdir /tmp/cg-build
cd ../payment-worker && npx wrangler deploy --dry-run --outdir /tmp/pw-build
cd ..
```

Expected: both produce a bundled `worker.js` with no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git rm charge-generator/package-lock.json payment-worker/package-lock.json
git commit -m "chore: convert to npm workspaces monorepo"
```

### Task 1.2: Add shared `tsconfig.base.json`

**Files:**
- Create: `tsconfig.base.json`
- Modify: `charge-generator/tsconfig.json`
- Modify: `payment-worker/tsconfig.json`

- [ ] **Step 1: Create the base config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "lib": ["ES2022"],
    "types": []
  }
}
```

- [ ] **Step 2: Update `charge-generator/tsconfig.json` to extend the base**

Replace the entire file with:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*", "worker-configuration.d.ts"]
}
```

- [ ] **Step 3: Update `payment-worker/tsconfig.json` to extend the base**

Replace the entire file with:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Verify typecheck passes for both workers**

```bash
cd charge-generator && npx tsc --noEmit && cd ..
cd payment-worker   && npx tsc --noEmit && cd ..
```

Expected: both exit 0.

- [ ] **Step 5: Add `typecheck` script to each worker's `package.json`**

In both `charge-generator/package.json` and `payment-worker/package.json`, add inside `"scripts"`:

```json
"typecheck": "tsc --noEmit",
"build":     "wrangler deploy --dry-run --outdir /tmp/$npm_package_name-build"
```

- [ ] **Step 6: Verify root `npm run typecheck` and `npm run build` work**

```bash
npm run typecheck
npm run build
```

Expected: both succeed across both workers.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.base.json charge-generator/tsconfig.json payment-worker/tsconfig.json charge-generator/package.json payment-worker/package.json
git commit -m "chore: share base tsconfig across workspaces"
```

### Task 1.3: Add root `vitest.workspace.ts` (empty workspace)

**Files:**
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Create the workspace config**

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Worker-runtime tests will be added per-package as they appear:
  //   'packages/airtable-client/vitest.config.ts',
  //   'charge-generator/vitest.config.ts',
  //   'payment-worker/vitest.config.ts',
]);
```

- [ ] **Step 2: Verify `npm run test` succeeds with no tests**

Run: `npm run test`
Expected: vitest reports "No test files found" and exits 0 (or with a benign warning). If it exits non-zero, append `--passWithNoTests` to the root `test` script.

- [ ] **Step 3: Commit**

```bash
git add vitest.workspace.ts
git commit -m "chore: add vitest workspace skeleton"
```

---

## Phase 2 — Build `@rent/airtable-client` (test-first)

Goal of phase: ship a fully tested shared package with Zod schemas, retries, timeouts, and pagination. Workers don't depend on it yet.

### Task 2.1: Create the package skeleton

**Files:**
- Create: `packages/airtable-client/package.json`
- Create: `packages/airtable-client/tsconfig.json`
- Create: `packages/airtable-client/src/index.ts`
- Create: `packages/airtable-client/vitest.config.ts`

- [ ] **Step 1: Create `packages/airtable-client/package.json`**

```json
{
  "name": "@rent/airtable-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  },
  "peerDependencies": {
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `packages/airtable-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create `packages/airtable-client/src/index.ts`**

```ts
// public surface — populated by later tasks
export {};
```

- [ ] **Step 4: Create `packages/airtable-client/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Wire it into the workspace vitest config**

Edit `vitest.workspace.ts` to:

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/airtable-client/vitest.config.ts',
]);
```

- [ ] **Step 6: Run typecheck and tests, both should pass with no work**

```bash
npm run typecheck
npm run test
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/airtable-client vitest.workspace.ts
git commit -m "feat(airtable-client): add empty package skeleton"
```

### Task 2.2: Implement `buildQS` (test-first)

**Files:**
- Create: `packages/airtable-client/test/qs.test.ts`
- Create: `packages/airtable-client/src/qs.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/airtable-client/test/qs.test.ts
import { describe, it, expect } from 'vitest';
import { buildQS } from '../src/qs';

describe('buildQS', () => {
  it('serializes scalar params with key=value', () => {
    const qs = buildQS({ filterByFormula: '{Foo}=1' });
    expect(qs.toString()).toBe('filterByFormula=%7BFoo%7D%3D1');
  });

  it('serializes array params with bracket notation', () => {
    const qs = buildQS({ fields: ['Label', 'Monthly Rent'] });
    expect(qs.toString()).toBe('fields%5B%5D=Label&fields%5B%5D=Monthly+Rent');
  });

  it('combines scalar and array params', () => {
    const qs = buildQS({
      fields:          ['Label'],
      filterByFormula: 'TRUE()',
    });
    const params = Array.from(qs.entries());
    expect(params).toContainEqual(['fields[]', 'Label']);
    expect(params).toContainEqual(['filterByFormula', 'TRUE()']);
  });

  it('appends offset last when provided', () => {
    const qs = buildQS({ fields: ['Label'] }, 'off-token-123');
    expect(qs.get('offset')).toBe('off-token-123');
  });

  it('omits offset when undefined', () => {
    const qs = buildQS({ fields: ['Label'] });
    expect(qs.has('offset')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- qs`
Expected: FAIL with `Cannot find module '../src/qs'` or similar.

- [ ] **Step 3: Implement `buildQS`**

```ts
// packages/airtable-client/src/qs.ts
export function buildQS(
  params: Record<string, string | string[]>,
  offset?: string,
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(`${key}[]`, v);
    } else {
      qs.set(key, value);
    }
  }
  if (offset) qs.set('offset', offset);
  return qs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- qs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/airtable-client/src/qs.ts packages/airtable-client/test/qs.test.ts
git commit -m "feat(airtable-client): add buildQS with bracket-notation support"
```

### Task 2.3: Define table IDs

**Files:**
- Create: `packages/airtable-client/src/tables.ts`

- [ ] **Step 1: Create the tables module**

```ts
// packages/airtable-client/src/tables.ts
export const TABLES = {
  TENANCIES: 'tblvVmo12VikITRH6',
  CHARGES:   'tblNCw6ZxspNxiKCu',
  PAYMENTS:  'tbl8Zl9C9fzBDPllu',
} as const;

export type TableId = typeof TABLES[keyof typeof TABLES];
```

- [ ] **Step 2: Re-export from index**

Update `packages/airtable-client/src/index.ts`:

```ts
export { TABLES, type TableId } from './tables';
```

- [ ] **Step 3: Commit**

```bash
git add packages/airtable-client/src
git commit -m "feat(airtable-client): export shared table IDs"
```

### Task 2.4: Define Zod schemas (test-first)

**Files:**
- Create: `packages/airtable-client/test/schemas.test.ts`
- Create: `packages/airtable-client/src/schemas.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/airtable-client/test/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { TenancySchema, ChargeSchema, PaymentSchema } from '../src/schemas';

describe('TenancySchema', () => {
  it('accepts a minimal valid tenancy', () => {
    const parsed = TenancySchema.parse({ Label: '6B-R6 Sun Peng' });
    expect(parsed.Label).toBe('6B-R6 Sun Peng');
  });

  it('rejects when Label is missing', () => {
    expect(() => TenancySchema.parse({})).toThrow();
  });

  it('accepts optional Monthly Rent and Due Day', () => {
    const parsed = TenancySchema.parse({
      Label: 'X',
      'Monthly Rent': 1650,
      'Due Day': 15,
    });
    expect(parsed['Monthly Rent']).toBe(1650);
    expect(parsed['Due Day']).toBe(15);
  });

  it('rejects Due Day above 28', () => {
    expect(() =>
      TenancySchema.parse({ Label: 'X', 'Due Day': 29 }),
    ).toThrow();
  });
});

describe('ChargeSchema', () => {
  it('accepts a minimal valid charge', () => {
    const parsed = ChargeSchema.parse({ Label: 'X 2026-05 Rent' });
    expect(parsed.Label).toBe('X 2026-05 Rent');
  });

  it('accepts linked Tenancy as array of strings', () => {
    const parsed = ChargeSchema.parse({
      Label: 'X',
      Tenancy: ['rec123'],
    });
    expect(parsed.Tenancy).toEqual(['rec123']);
  });
});

describe('PaymentSchema', () => {
  it('accepts a payment with Charge link and amount', () => {
    const parsed = PaymentSchema.parse({
      Label:  'Sun Peng 2026-04-25 $1,650.00',
      Charge: ['rec123'],
      Amount: 1650,
    });
    expect(parsed.Amount).toBe(1650);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schemas**

```ts
// packages/airtable-client/src/schemas.ts
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

export const ChargeSchema = z.object({
  Label:      z.string(),
  Period:     z.string().optional(),
  'Due Date': z.string().optional(),
  Amount:     z.number().optional(),
  Balance:    z.number().optional(),
  Status:     z.enum(['Unpaid', 'Partial', 'Paid', 'Overdue']).optional(),
  Type:       z.string().optional(),
  Tenancy:    z.array(z.string()).optional(),
});
export type Charge = z.infer<typeof ChargeSchema>;

export const PaymentSchema = z.object({
  Label:       z.string(),
  Charge:      z.array(z.string()).optional(),
  Amount:      z.number().optional(),
  'Paid Date': z.string().optional(),
  Method:      z.string().optional(),
  Notes:       z.string().optional(),
});
export type Payment = z.infer<typeof PaymentSchema>;
```

- [ ] **Step 4: Add `zod` as a direct dependency to the package**

Edit `packages/airtable-client/package.json`, change `peerDependencies` block to:

```json
"dependencies": {
  "zod": "^3.23.8"
}
```

Then `npm install` from repo root.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- schemas`
Expected: PASS, 7 tests.

- [ ] **Step 6: Re-export from index**

Update `packages/airtable-client/src/index.ts`:

```ts
export { TABLES, type TableId } from './tables';
export {
  TenancySchema, type Tenancy,
  ChargeSchema,  type Charge,
  PaymentSchema, type Payment,
} from './schemas';
```

- [ ] **Step 7: Commit**

```bash
git add packages/airtable-client
git commit -m "feat(airtable-client): add Zod schemas for Tenancy/Charge/Payment"
```

### Task 2.5: Implement `AirtableClient.fetchAll` happy path (test-first)

**Files:**
- Create: `packages/airtable-client/test/client-fetch.test.ts`
- Create: `packages/airtable-client/src/client.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/airtable-client/test/client-fetch.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const TableSchema = z.object({ Name: z.string() });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AirtableClient.fetchAll — happy path', () => {
  it('returns parsed records on a single page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ records: [{ id: 'rec1', fields: { Name: 'A' } }] }),
      { status: 200 },
    )));

    const client = new AirtableClient(env);
    const records = await client.fetchAll('tbl1', TableSchema);

    expect(records).toEqual([{ id: 'rec1', fields: { Name: 'A' } }]);
  });

  it('sends Authorization and Content-Type headers', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ records: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    await client.fetchAll('tbl1', TableSchema);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer t');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('encodes params as fields[]= bracket notation', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ records: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    await client.fetchAll('tbl1', TableSchema, {
      fields:          ['Name'],
      filterByFormula: 'TRUE()',
    });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('fields%5B%5D=Name');
    expect(url).toContain('filterByFormula=TRUE');
  });

  it('paginates using offset until exhausted', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({
          records: [{ id: 'rec1', fields: { Name: 'A' } }],
          offset:  'next-token',
        }));
      }
      return new Response(JSON.stringify({
        records: [{ id: 'rec2', fields: { Name: 'B' } }],
      }));
    }));

    const client = new AirtableClient(env);
    const records = await client.fetchAll('tbl1', TableSchema);

    expect(records.map(r => r.id)).toEqual(['rec1', 'rec2']);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client-fetch`
Expected: FAIL — `AirtableClient` not found.

- [ ] **Step 3: Implement minimal `AirtableClient.fetchAll`**

```ts
// packages/airtable-client/src/client.ts
import { z } from 'zod';
import { buildQS } from './qs';

export interface AirtableEnv {
  AIRTABLE_TOKEN:   string;
  AIRTABLE_BASE_ID: string;
}

export interface AirtableRecord<T> {
  id:     string;
  fields: T;
}

export type QueryParams = Record<string, string | string[]>;

interface AirtableListResponse {
  records: { id: string; fields: unknown }[];
  offset?: string;
}

export class AirtableClient {
  constructor(private readonly env: AirtableEnv) {}

  async fetchAll<T>(
    tableId: string,
    schema:  z.ZodType<T>,
    params:  QueryParams = {},
  ): Promise<AirtableRecord<T>[]> {
    const out: AirtableRecord<T>[] = [];
    let offset: string | undefined;

    do {
      const url = `${this.baseUrl()}/${tableId}?${buildQS(params, offset)}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        throw new Error(`Airtable fetch [${tableId}]: ${res.status} ${await res.text()}`);
      }
      const data = await res.json() as AirtableListResponse;
      for (const r of data.records) {
        const fields = schema.parse(r.fields);
        out.push({ id: r.id, fields });
      }
      offset = data.offset;
    } while (offset);

    return out;
  }

  private baseUrl(): string {
    return `https://api.airtable.com/v0/${this.env.AIRTABLE_BASE_ID}`;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.env.AIRTABLE_TOKEN}`,
      'Content-Type':  'application/json',
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- client-fetch`
Expected: PASS, 4 tests.

- [ ] **Step 5: Re-export from index**

Update `packages/airtable-client/src/index.ts` to add:

```ts
export {
  AirtableClient,
  type AirtableEnv,
  type AirtableRecord,
  type QueryParams,
} from './client';
```

- [ ] **Step 6: Commit**

```bash
git add packages/airtable-client
git commit -m "feat(airtable-client): AirtableClient.fetchAll with pagination + Zod parsing"
```

### Task 2.6: Schema parse failures throw with field path (test-first)

**Files:**
- Modify: `packages/airtable-client/test/client-fetch.test.ts`
- Modify: `packages/airtable-client/src/client.ts`

- [ ] **Step 1: Add the failing test**

Append to `client-fetch.test.ts`:

```ts
describe('AirtableClient.fetchAll — schema validation', () => {
  it('throws an error mentioning the field path on parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ records: [{ id: 'rec1', fields: { Name: 42 } }] }),
      { status: 200 },
    )));

    const client = new AirtableClient(env);
    await expect(
      client.fetchAll('tbl1', TableSchema),
    ).rejects.toThrow(/Name/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client-fetch`
Expected: PASS overall — but actually this test will pass already because Zod's default error includes the path. Verify by reading the thrown message — it should contain `Name`. If it does, GOOD; mark this step complete.

If it does not, replace the parse line in `client.ts` with:

```ts
const result = schema.safeParse(r.fields);
if (!result.success) {
  const issue = result.error.issues[0];
  throw new Error(
    `Airtable schema mismatch [${tableId}/${r.id}] at ${issue?.path.join('.')}: ${issue?.message}`,
  );
}
out.push({ id: r.id, fields: result.data });
```

- [ ] **Step 3: Commit**

```bash
git add packages/airtable-client
git commit -m "feat(airtable-client): include field path in schema parse errors"
```

### Task 2.7: Add timeout via `AbortSignal.timeout` (test-first)

**Files:**
- Create: `packages/airtable-client/test/client-timeout.test.ts`
- Modify: `packages/airtable-client/src/client.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/airtable-client/test/client-timeout.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient — timeout', () => {
  it('passes an AbortSignal to fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ records: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    await client.fetchAll('tbl1', T);

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).signal).toBeDefined();
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts when the timeout fires', async () => {
    vi.useFakeTimers();
    let abortReason: unknown;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = (init as RequestInit).signal as AbortSignal;
        sig.addEventListener('abort', () => {
          abortReason = sig.reason;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }));

    const client = new AirtableClient(env, { timeoutMs: 1000, retries: 0 });
    const promise = client.fetchAll('tbl1', T);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(promise).rejects.toThrow();
    expect(abortReason).toBeDefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client-timeout`
Expected: FAIL — `signal` undefined and constructor doesn't accept options.

- [ ] **Step 3: Add timeout support**

Update `packages/airtable-client/src/client.ts`:

```ts
export interface AirtableClientOptions {
  /** Per-request timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** Max retries on 5xx / network error. Default 2. */
  retries?: number;
}

export class AirtableClient {
  private readonly timeoutMs: number;
  private readonly retries:   number;

  constructor(
    private readonly env: AirtableEnv,
    opts: AirtableClientOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries   = opts.retries   ?? 2;
  }

  // ... fetchAll body — replace the `fetch(url, ...)` line with:
  //   const res = await fetch(url, {
  //     headers: this.headers(),
  //     signal:  AbortSignal.timeout(this.timeoutMs),
  //   });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- client-timeout`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/airtable-client
git commit -m "feat(airtable-client): add per-request timeout via AbortSignal"
```

### Task 2.8: Add retry on 5xx / network error (test-first)

**Files:**
- Create: `packages/airtable-client/test/client-retry.test.ts`
- Modify: `packages/airtable-client/src/client.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/airtable-client/test/client-retry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient — retry', () => {
  it('retries on 503 and succeeds on attempt 2', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({
        records: [{ id: 'r1', fields: { Name: 'X' } }],
      }), { status: 200 });
    }));

    const client = new AirtableClient(env, { retries: 2, timeoutMs: 1000 });
    const out = await client.fetchAll('tbl1', T);
    expect(out).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('does NOT retry on 422', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('bad request', { status: 422 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(client.fetchAll('tbl1', T)).rejects.toThrow(/422/);
    expect(calls).toBe(1);
  });

  it('gives up after retries exhausted', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('busy', { status: 503 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(client.fetchAll('tbl1', T)).rejects.toThrow(/503/);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('retries on network error', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError('network down');
      return new Response(JSON.stringify({ records: [] }));
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await client.fetchAll('tbl1', T);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client-retry`
Expected: FAIL on the retry tests — current code only attempts once.

- [ ] **Step 3: Implement retry logic**

In `packages/airtable-client/src/client.ts`, extract the request logic into a helper and wrap it with retries. Replace the inside of `fetchAll`'s `do { ... } while` loop with calls to a new `private async request(url: string): Promise<Response>` method:

```ts
private async request(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= this.retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: this.headers(),
        signal:  AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) return res;
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
        if (attempt < this.retries) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw lastErr;
      }
      // 4xx — non-retryable
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      // Network errors and AbortError — retryable
      if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) {
        lastErr = e;
        if (attempt < this.retries) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw e;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error('unreachable');
}

private backoffMs(attempt: number): number {
  // 200ms, 800ms (4x growth)
  return 200 * Math.pow(4, attempt);
}

private sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
```

Update `fetchAll` to use `await this.request(url)` and update its error message wrapping:

```ts
async fetchAll<T>(...): Promise<AirtableRecord<T>[]> {
  const out: AirtableRecord<T>[] = [];
  let offset: string | undefined;
  do {
    const url = `${this.baseUrl()}/${tableId}?${buildQS(params, offset)}`;
    let res: Response;
    try {
      res = await this.request(url);
    } catch (e) {
      throw new Error(`Airtable fetch [${tableId}]: ${(e as Error).message}`);
    }
    const data = await res.json() as AirtableListResponse;
    for (const r of data.records) {
      const result = schema.safeParse(r.fields);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new Error(
          `Airtable schema mismatch [${tableId}/${r.id}] at ${issue?.path.join('.')}: ${issue?.message}`,
        );
      }
      out.push({ id: r.id, fields: result.data });
    }
    offset = data.offset;
  } while (offset);
  return out;
}
```

- [ ] **Step 4: Run all client tests to verify they pass**

Run: `npm run test -- client`
Expected: PASS, all client tests.

- [ ] **Step 5: Commit**

```bash
git add packages/airtable-client
git commit -m "feat(airtable-client): retry 5xx/network errors with exponential backoff"
```

### Task 2.9: Implement `AirtableClient.create` (test-first)

**Files:**
- Create: `packages/airtable-client/test/client-create.test.ts`
- Modify: `packages/airtable-client/src/client.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/airtable-client/test/client-create.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { AirtableClient } from '../src/client';

const env = { AIRTABLE_TOKEN: 't', AIRTABLE_BASE_ID: 'app1' };
const T = z.object({ Name: z.string() });

beforeEach(() => vi.restoreAllMocks());

describe('AirtableClient.create', () => {
  it('POSTs the fields and returns the created record parsed', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ id: 'recNEW', fields: { Name: 'X' } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AirtableClient(env);
    const rec = await client.create('tbl1', T, { Name: 'X' });

    expect(rec).toEqual({ id: 'recNEW', fields: { Name: 'X' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.airtable.com/v0/app1/tbl1');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fields: { Name: 'X' },
    });
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({
        id: 'recNEW', fields: { Name: 'X' },
      }));
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await client.create('tbl1', T, { Name: 'X' });
    expect(calls).toBe(2);
  });

  it('does NOT retry on 422', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('bad', { status: 422 });
    }));

    const client = new AirtableClient(env, { retries: 2 });
    await expect(
      client.create('tbl1', T, { Name: 'X' }),
    ).rejects.toThrow(/422/);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- client-create`
Expected: FAIL — `create` method does not exist.

- [ ] **Step 3: Add the `create` method**

In `packages/airtable-client/src/client.ts`, refactor `request` to accept a `RequestInit` so POST can reuse it. Replace the `request` method signature and update `fetchAll`:

```ts
private async request(url: string, init: RequestInit = {}): Promise<Response> {
  const baseInit: RequestInit = {
    ...init,
    headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= this.retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...baseInit,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) return res;
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
        if (attempt < this.retries) { await this.sleep(this.backoffMs(attempt)); continue; }
        throw lastErr;
      }
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) {
        lastErr = e;
        if (attempt < this.retries) { await this.sleep(this.backoffMs(attempt)); continue; }
        throw e;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error('unreachable');
}
```

Add the `create` method:

```ts
async create<T>(
  tableId: string,
  schema:  z.ZodType<T>,
  fields:  Partial<T>,
): Promise<AirtableRecord<T>> {
  const url = `${this.baseUrl()}/${tableId}`;
  let res: Response;
  try {
    res = await this.request(url, {
      method: 'POST',
      body:   JSON.stringify({ fields }),
    });
  } catch (e) {
    throw new Error(`Airtable create [${tableId}]: ${(e as Error).message}`);
  }
  const data = await res.json() as { id: string; fields: unknown };
  const parsed = schema.safeParse(data.fields);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Airtable schema mismatch on create [${tableId}/${data.id}] at ${issue?.path.join('.')}: ${issue?.message}`,
    );
  }
  return { id: data.id, fields: parsed.data };
}
```

- [ ] **Step 4: Run all client tests to verify they pass**

Run: `npm run test -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/airtable-client
git commit -m "feat(airtable-client): add create() with retry + schema validation"
```

---

## Phase 3 — Migrate `charge-generator`

Goal of phase: extract pure helpers, migrate to `@rent/airtable-client`, add `/run` bearer auth, write integration tests against cron + fetch handlers.

### Task 3.1: Add `@rent/airtable-client` as a dependency

**Files:**
- Modify: `charge-generator/package.json`

- [ ] **Step 1: Add the dep**

In `charge-generator/package.json`, add to `"dependencies"` (creating the section if absent):

```json
"dependencies": {
  "@rent/airtable-client": "*",
  "zod": "^3.23.8"
}
```

- [ ] **Step 2: Re-install**

```bash
npm install
```

- [ ] **Step 3: Verify charge-generator still builds**

```bash
cd charge-generator && npx wrangler deploy --dry-run --outdir /tmp/cg-build && cd ..
```

Expected: success (worker still uses its local `helper.ts`, just has new deps available).

- [ ] **Step 4: Commit**

```bash
git add charge-generator/package.json package-lock.json
git commit -m "chore(charge-generator): depend on @rent/airtable-client"
```

### Task 3.2: Extract `due-date.ts` (test-first)

**Files:**
- Create: `charge-generator/test/due-date.test.ts`
- Create: `charge-generator/src/due-date.ts`
- Modify: `charge-generator/vitest.config.ts` (create)
- Modify: `vitest.workspace.ts`

- [ ] **Step 1: Create `charge-generator/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

Wire it into the workspace:

```ts
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/airtable-client/vitest.config.ts',
  'charge-generator/vitest.config.ts',
]);
```

- [ ] **Step 2: Write the failing test**

```ts
// charge-generator/test/due-date.test.ts
import { describe, it, expect } from 'vitest';
import { resolveDueDate } from '../src/due-date';

describe('resolveDueDate', () => {
  it('uses Due Day override when set and within 1..28', () => {
    expect(resolveDueDate({ 'Due Day': 15 }, 2026, '05')).toBe('2026-05-15');
  });

  it('falls back to Start Date day when Due Day not set', () => {
    expect(
      resolveDueDate({ 'Start Date': '2024-03-10' }, 2026, '05'),
    ).toBe('2026-05-10');
  });

  it('caps day at 28 to avoid invalid Feb dates', () => {
    expect(
      resolveDueDate({ 'Start Date': '2024-01-31' }, 2026, '02'),
    ).toBe('2026-02-28');
  });

  it('falls back to 1st when neither field present', () => {
    expect(resolveDueDate({}, 2026, '05')).toBe('2026-05-01');
  });

  it('ignores Due Day above 28 and uses Start Date', () => {
    expect(
      resolveDueDate({ 'Due Day': 30, 'Start Date': '2024-03-10' }, 2026, '05'),
    ).toBe('2026-05-10');
  });

  it('ignores Due Day below 1 and uses Start Date', () => {
    expect(
      resolveDueDate({ 'Due Day': 0, 'Start Date': '2024-03-10' }, 2026, '05'),
    ).toBe('2026-05-10');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -- due-date`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `charge-generator/src/due-date.ts`**

Lift the function from current `charge-generator/src/index.ts:64-82`:

```ts
// charge-generator/src/due-date.ts
export function resolveDueDate(
  fields: { 'Due Day'?: number; 'Start Date'?: string },
  year:   number,
  month:  string,
): string {
  const overrideDay = fields['Due Day'];
  if (overrideDay && overrideDay >= 1 && overrideDay <= 28) {
    return `${year}-${month}-${String(overrideDay).padStart(2, '0')}`;
  }
  const startDate = fields['Start Date'];
  if (startDate) {
    const day = new Date(startDate).getUTCDate();
    const safeDay = Math.min(day, 28);
    return `${year}-${month}-${String(safeDay).padStart(2, '0')}`;
  }
  return `${year}-${month}-01`;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -- due-date`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add charge-generator/src/due-date.ts charge-generator/test/due-date.test.ts charge-generator/vitest.config.ts vitest.workspace.ts
git commit -m "feat(charge-generator): extract resolveDueDate with unit tests"
```

### Task 3.3: Extract `discord.ts` (test-first)

**Files:**
- Create: `charge-generator/test/discord.test.ts`
- Create: `charge-generator/src/discord.ts`

- [ ] **Step 1: Write the failing test**

```ts
// charge-generator/test/discord.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notifyDiscord } from '../src/discord';

beforeEach(() => vi.restoreAllMocks());

describe('notifyDiscord', () => {
  it('returns true on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 204 })));
    const ok = await notifyDiscord('http://x', '2026-05', ['A'], [], []);
    expect(ok).toBe(true);
  });

  it('uses red color when there are errors', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await notifyDiscord('http://x', '2026-05', [], [], ['boom']);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0xFF4444);
  });

  it('uses green when only created and no errors', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await notifyDiscord('http://x', '2026-05', ['A'], [], []);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0x00C851);
  });

  it('uses yellow when nothing created and no errors', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await notifyDiscord('http://x', '2026-05', [], ['A'], []);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0xFFBB33);
  });

  it('returns false on non-2xx (does not throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    const ok = await notifyDiscord('http://x', '2026-05', ['A'], [], []);
    expect(ok).toBe(false);
  });

  it('returns false on network error (does not throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    const ok = await notifyDiscord('http://x', '2026-05', ['A'], [], []);
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- discord`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `charge-generator/src/discord.ts`**

Lift the function from `charge-generator/src/index.ts:84-134`. Identical body, exported:

```ts
// charge-generator/src/discord.ts
export async function notifyDiscord(
  webhookUrl: string,
  period:     string,
  created:    string[],
  skipped:    string[],
  errors:     string[],
): Promise<boolean> {
  const colour = errors.length > 0 ? 0xFF4444
               : created.length > 0 ? 0x00C851
               : 0xFFBB33;

  const embed = {
    title:     `🏠 Rent Charges — ${period}`,
    color:     colour,
    timestamp: new Date().toISOString(),
    fields: [
      { name: `✅ Created (${created.length})`,        value: created.length ? created.join('\n') : '—', inline: false },
      { name: `⏭ Already existed (${skipped.length})`, value: skipped.length ? skipped.join('\n') : '—', inline: false },
      ...(errors.length ? [{
        name: `❌ Errors (${errors.length})`,
        value: errors.join('\n'),
        inline: false,
      }] : []),
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[Discord] webhook failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[Discord] webhook threw: ${(e as Error).message}`);
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- discord`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add charge-generator/src/discord.ts charge-generator/test/discord.test.ts
git commit -m "feat(charge-generator): extract notifyDiscord with unit tests"
```

### Task 3.4: Extract `auth.ts` for `/run` bearer (test-first)

**Files:**
- Create: `charge-generator/test/auth.test.ts`
- Create: `charge-generator/src/auth.ts`

- [ ] **Step 1: Write the failing test**

```ts
// charge-generator/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { requireBearer } from '../src/auth';

describe('requireBearer', () => {
  it('returns null when header matches', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(requireBearer(req, 'secret')).toBeNull();
  });

  it('returns 401 when header missing', () => {
    const req = new Request('https://x/run');
    const res = requireBearer(req, 'secret');
    expect(res?.status).toBe(401);
  });

  it('returns 401 when scheme is wrong', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: 'Basic c2VjcmV0' },
    });
    expect(requireBearer(req, 'secret')?.status).toBe(401);
  });

  it('returns 401 when token does not match', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(requireBearer(req, 'secret')?.status).toBe(401);
  });

  it('returns 401 when expected secret is empty', () => {
    const req = new Request('https://x/run', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(requireBearer(req, '')?.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- auth`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `charge-generator/src/auth.ts`**

```ts
// charge-generator/src/auth.ts
export function requireBearer(request: Request, expected: string): Response | null {
  if (!expected || expected.length < 16) {
    // Refuse to authenticate against a missing/short secret — fail closed.
    return new Response('Unauthorized', { status: 401 });
  }
  const auth = request.headers.get('Authorization') ?? '';
  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) return new Response('Unauthorized', { status: 401 });
  const token = auth.slice(prefix.length);
  if (token.length !== expected.length || token !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}
```

Note: the empty-secret test passes because `expected.length < 16` short-circuits. The "min length 16" guard is intentional — if the operator forgets to set `RUN_TOKEN`, we fail closed instead of accepting `Bearer ` (empty) as valid. Adjust the test for this guard if needed.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- auth`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add charge-generator/src/auth.ts charge-generator/test/auth.test.ts
git commit -m "feat(charge-generator): add requireBearer with unit tests"
```

### Task 3.5: Extract `charges.ts` and migrate to `@rent/airtable-client`

**Files:**
- Create: `charge-generator/src/charges.ts`
- Modify: `charge-generator/src/index.ts`
- Delete: `charge-generator/src/helper.ts`

- [ ] **Step 1: Create `charge-generator/src/charges.ts`**

```ts
// charge-generator/src/charges.ts
import {
  AirtableClient, TABLES,
  TenancySchema, ChargeSchema,
  type Tenancy, type Charge,
  type AirtableRecord,
} from '@rent/airtable-client';
import { resolveDueDate } from './due-date';
import { notifyDiscord }  from './discord';

export interface ChargesEnv {
  AIRTABLE_TOKEN:      string;
  AIRTABLE_BASE_ID:    string;
  DISCORD_WEBHOOK_URL: string;
}

export async function generateCharges(env: ChargesEnv): Promise<void> {
  const client = new AirtableClient(env);

  const now    = new Date();
  const next   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const year   = next.getUTCFullYear();
  const month  = String(next.getUTCMonth() + 1).padStart(2, '0');
  const period = `${year}-${month}`;

  const tenancies = await client.fetchAll(
    TABLES.TENANCIES,
    TenancySchema,
    {
      fields: ['Label', 'Monthly Rent', 'Start Date', 'End Date', 'Due Day'],
      filterByFormula: 'OR({End Date} = BLANK(), IS_AFTER({End Date}, TODAY()))',
    },
  );

  const existing = await client.fetchAll(
    TABLES.CHARGES,
    ChargeSchema,
    {
      fields: ['Period', 'Tenancy'],
      filterByFormula: `{Period} = "${period}"`,
    },
  );

  const alreadyCovered = new Set<string>();
  for (const charge of existing) {
    for (const id of charge.fields.Tenancy ?? []) alreadyCovered.add(id);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  for (const tenancy of tenancies) {
    const label = tenancy.fields.Label;

    if (alreadyCovered.has(tenancy.id)) {
      skipped.push(label);
      continue;
    }

    const rent    = tenancy.fields['Monthly Rent'] ?? 0;
    const dueDate = resolveDueDate(tenancy.fields, year, month);

    try {
      await client.create(TABLES.CHARGES, ChargeSchema, {
        Label:      `${label} ${period} Rent`,
        Tenancy:    [tenancy.id],
        Type:       'Rent',
        Period:     period,
        'Due Date': dueDate,
        Amount:     rent,
      });
      created.push(`${label} → due ${dueDate}`);
    } catch (e) {
      const msg = `${label}: ${(e as Error).message}`;
      errors.push(msg);
      console.error(`[charge error] ${msg}`);
    }
  }

  const discordOk = await notifyDiscord(
    env.DISCORD_WEBHOOK_URL, period, created, skipped, errors,
  );

  if (errors.length > 0) {
    console.error(`[${period}] ERRORS:\n${errors.join('\n')}`);
  }
  console.log(
    `[${period}] created=${created.length} skipped=${skipped.length} errors=${errors.length} discord=${discordOk}`
  );
}
```

- [ ] **Step 2: Replace `charge-generator/src/index.ts`**

```ts
// charge-generator/src/index.ts
import { generateCharges } from './charges';
import { requireBearer }   from './auth';

export interface Env {
  AIRTABLE_TOKEN:      string;
  AIRTABLE_BASE_ID:    string;
  DISCORD_WEBHOOK_URL: string;
  RUN_TOKEN:           string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(generateCharges(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const denied = requireBearer(request, env.RUN_TOKEN);
      if (denied) return denied;
      await generateCharges(env);
      return new Response('Done — check Discord', { status: 200 });
    }
    return new Response('charge-generator is running', { status: 200 });
  },
};
```

- [ ] **Step 3: Delete the now-unused `helper.ts`**

```bash
git rm charge-generator/src/helper.ts
```

- [ ] **Step 4: Verify build still works**

```bash
cd charge-generator && npx tsc --noEmit && npx wrangler deploy --dry-run --outdir /tmp/cg-build && cd ..
```

Expected: success.

- [ ] **Step 5: Run unit tests to confirm green**

Run: `npm run test -- charge-generator`
Expected: PASS (due-date, discord, auth tests still pass).

- [ ] **Step 6: Commit**

```bash
git add charge-generator/src
git commit -m "feat(charge-generator): migrate to @rent/airtable-client + add /run bearer auth + waitUntil"
```

### Task 3.6: Add Worker integration tests for charge-generator

**Files:**
- Create: `charge-generator/test/integration/scheduled.test.ts`
- Create: `charge-generator/test/integration/fetch.test.ts`
- Create: `charge-generator/vitest.integration.config.ts`
- Modify: `vitest.workspace.ts`

- [ ] **Step 1: Add `@cloudflare/vitest-pool-workers` config**

```ts
// charge-generator/vitest.integration.config.ts
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    include: ['test/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2026-04-26',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            AIRTABLE_TOKEN:      'test-token',
            AIRTABLE_BASE_ID:    'appTEST',
            DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
            RUN_TOKEN:           'a'.repeat(32),
          },
        },
      },
    },
  },
});
```

Update `vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/airtable-client/vitest.config.ts',
  'charge-generator/vitest.config.ts',
  'charge-generator/vitest.integration.config.ts',
]);
```

Update `charge-generator/vitest.config.ts` to exclude the integration directory:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Update wrangler config for the integration runtime**

In `charge-generator/wrangler.jsonc`, change `compatibility_date` to `"2026-04-26"` and add `compatibility_flags`:

```jsonc
{
  "name": "charge-generator",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-26",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": { "crons": ["0 0 15 * *"] },
  "observability": {
    "logs":   { "enabled": true },
    "traces": { "enabled": true }
  }
}
```

- [ ] **Step 3: Write the scheduled-handler integration test**

```ts
// charge-generator/test/integration/scheduled.test.ts
import { env, SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../../src/index';

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
});

const ATBASE = 'https://api.airtable.com';
const TENANCIES = 'tblvVmo12VikITRH6';
const CHARGES   = 'tblNCw6ZxspNxiKCu';

function tenancyRec(id: string, label: string, rent: number, dueDay?: number) {
  const fields: Record<string, unknown> = { Label: label, 'Monthly Rent': rent };
  if (dueDay) fields['Due Day'] = dueDay;
  return { id, fields };
}

describe('scheduled handler', () => {
  it('happy path: creates charges for all active tenancies', async () => {
    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, {
        records: [
          tenancyRec('rec1', 'A', 1000, 5),
          tenancyRec('rec2', 'B', 1500, 10),
        ],
      });

    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });

    let postCount = 0;
    fetchMock.get(ATBASE)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        postCount++;
        return { statusCode: 200, data: { id: `recCharge${postCount}`, fields: { Label: 'X' } } };
      })
      .times(2);

    fetchMock.get('https://discord.test')
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(204, '');

    const ctrl = new (globalThis as any).ScheduledController?.() ?? {};
    await worker.scheduled?.(ctrl as ScheduledEvent, env as any, {
      waitUntil: (p: Promise<unknown>) => p,
    } as any);

    expect(postCount).toBe(2);
  });

  it('idempotency: skips tenancies already covered for the period', async () => {
    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, {
        records: [tenancyRec('rec1', 'A', 1000, 5), tenancyRec('rec2', 'B', 1500, 10)],
      });

    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, {
        records: [{ id: 'recExisting', fields: { Label: 'X', Tenancy: ['rec1'] } }],
      });

    let postCount = 0;
    fetchMock.get(ATBASE)
      .intercept({ path: `/v0/appTEST/${CHARGES}`, method: 'POST' })
      .reply(() => {
        postCount++;
        return { statusCode: 200, data: { id: 'recNew', fields: { Label: 'Y' } } };
      });

    fetchMock.get('https://discord.test')
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(204, '');

    await worker.scheduled?.({} as ScheduledEvent, env as any, {
      waitUntil: (p: Promise<unknown>) => p,
    } as any);

    expect(postCount).toBe(1); // only rec2 created
  });

  it('Discord webhook 502 does not throw', async () => {
    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(200, { records: [] });
    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });
    fetchMock.get('https://discord.test')
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(502, 'bad gateway');

    await expect(
      worker.scheduled?.({} as ScheduledEvent, env as any, {
        waitUntil: (p: Promise<unknown>) => p,
      } as any),
    ).resolves.not.toThrow();
  });

  it('Airtable 503 on read retries and succeeds', async () => {
    let tenAttempts = 0;
    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${TENANCIES}\\?.*`) })
      .reply(() => {
        tenAttempts++;
        if (tenAttempts === 1) return { statusCode: 503, data: 'busy' };
        return { statusCode: 200, data: { records: [] } };
      })
      .times(2);
    fetchMock.get(ATBASE)
      .intercept({ path: new RegExp(`/v0/appTEST/${CHARGES}\\?.*`) })
      .reply(200, { records: [] });
    fetchMock.get('https://discord.test')
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(204, '');

    await worker.scheduled?.({} as ScheduledEvent, env as any, {
      waitUntil: (p: Promise<unknown>) => p,
    } as any);

    expect(tenAttempts).toBe(2);
  });
});
```

Note on `fetchMock` API: `@cloudflare/vitest-pool-workers` exports a [`fetchMock`](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/#mocking-outbound-fetch-requests) bound to `undici.MockAgent`. If the exact `intercept().reply()` chaining differs in your installed version, refer to its README and adjust calls; the *test scenarios* are what matter.

- [ ] **Step 4: Write the fetch-handler integration test**

```ts
// charge-generator/test/integration/fetch.test.ts
import { env, SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.deactivate();
});

describe('fetch handler', () => {
  it('GET / returns banner', async () => {
    const res = await SELF.fetch('https://worker.test/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('charge-generator is running');
  });

  it('GET /run without bearer returns 401', async () => {
    const res = await SELF.fetch('https://worker.test/run');
    expect(res.status).toBe(401);
  });

  it('GET /run with wrong bearer returns 401', async () => {
    const res = await SELF.fetch('https://worker.test/run', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /run with correct bearer triggers generateCharges', async () => {
    fetchMock.get('https://api.airtable.com')
      .intercept({ path: /\/v0\/appTEST\/.*/ })
      .reply(200, { records: [] })
      .times(2);
    fetchMock.get('https://discord.test')
      .intercept({ path: '/webhook', method: 'POST' })
      .reply(204, '');

    const res = await SELF.fetch('https://worker.test/run', {
      headers: { Authorization: `Bearer ${'a'.repeat(32)}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Done — check Discord');
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `npm run test`
Expected: PASS across unit + integration. If `fetchMock` intercept chaining errors, fix per the package README before continuing.

- [ ] **Step 6: Commit**

```bash
git add charge-generator vitest.workspace.ts
git commit -m "test(charge-generator): add scheduled + fetch integration tests"
```

---

## Phase 4 — Migrate `payment-worker`

Goal of phase: extract pure helpers, add webhook secret guard, migrate to `@rent/airtable-client`, write integration tests covering the full wizard happy path and key edge cases.

### Task 4.1: Add `@rent/airtable-client` as a dependency

**Files:**
- Modify: `payment-worker/package.json`

- [ ] **Step 1: Add the dep**

In `payment-worker/package.json`, add to `"dependencies"`:

```json
"dependencies": {
  "@rent/airtable-client": "*",
  "grammy": "^1.31.0",
  "zod":    "^3.23.8"
}
```

- [ ] **Step 2: `npm install` and verify build**

```bash
npm install
cd payment-worker && npx wrangler deploy --dry-run --outdir /tmp/pw-build && cd ..
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add payment-worker/package.json package-lock.json
git commit -m "chore(payment-worker): depend on @rent/airtable-client"
```

### Task 4.2: Extract `format.ts` (test-first)

**Files:**
- Create: `payment-worker/test/format.test.ts`
- Create: `payment-worker/src/format.ts`
- Create: `payment-worker/vitest.config.ts`
- Modify: `vitest.workspace.ts`

- [ ] **Step 1: Add the per-worker vitest config**

```ts
// payment-worker/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
```

Update `vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/airtable-client/vitest.config.ts',
  'charge-generator/vitest.config.ts',
  'charge-generator/vitest.integration.config.ts',
  'payment-worker/vitest.config.ts',
]);
```

- [ ] **Step 2: Write the failing test**

```ts
// payment-worker/test/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatAUD, parseAmount, parseDate, todayISO, yesterdayISO } from '../src/format';

describe('formatAUD', () => {
  it('formats with $ and 2 dp', () => {
    expect(formatAUD(1650)).toBe('$1,650.00');
  });
  it('groups thousands', () => {
    expect(formatAUD(1234567.5)).toBe('$1,234,567.50');
  });
});

describe('parseAmount', () => {
  it.each([
    ['1650', 1650],
    ['1650.00', 1650],
    ['$1,650', 1650],
    ['$1,650.50', 1650.5],
  ])('parses %s as %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['abc', '', '-5', '0', 'NaN'])(
    'rejects %s',
    (input) => expect(parseAmount(input)).toBeNull(),
  );
});

describe('parseDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(parseDate('2026-04-25')).toBe('2026-04-25');
  });
  it('converts DD/MM/YYYY', () => {
    expect(parseDate('25/04/2026')).toBe('2026-04-25');
  });
  it('rejects garbage', () => {
    expect(parseDate('abc')).toBeNull();
  });
  it('rejects 2026-13-40', () => {
    expect(parseDate('2026-13-40')).toBeNull();
  });
});

describe('todayISO / yesterdayISO', () => {
  it('todayISO matches YYYY-MM-DD shape', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('yesterdayISO is one day before today', () => {
    const t = new Date(todayISO() + 'T00:00:00Z');
    const y = new Date(yesterdayISO() + 'T00:00:00Z');
    expect((t.getTime() - y.getTime()) / 86400000).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- format`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `format.ts`**

```ts
// payment-worker/src/format.ts
export const formatAUD = (n: number): string =>
  `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

export function parseDate(input: string): string | null {
  let candidate: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    candidate = input;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [d, m, y] = input.split('/');
    candidate = `${y}-${m}-${d}`;
  }
  if (!candidate) return null;
  const t = Date.parse(candidate + 'T00:00:00Z');
  if (isNaN(t)) return null;
  // Round-trip verify (rejects 2026-02-31 type values)
  const round = new Date(t).toISOString().slice(0, 10);
  return round === candidate ? candidate : null;
}

export const todayISO = (): string =>
  new Date().toISOString().slice(0, 10);

export const yesterdayISO = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test -- format`
Expected: PASS, all groups.

- [ ] **Step 6: Commit**

```bash
git add payment-worker/src/format.ts payment-worker/test/format.test.ts payment-worker/vitest.config.ts vitest.workspace.ts
git commit -m "feat(payment-worker): extract formatting + parsing helpers"
```

### Task 4.3: Extract `session.ts` (test-first)

**Files:**
- Create: `payment-worker/test/session.test.ts`
- Create: `payment-worker/src/session.ts`

- [ ] **Step 1: Write the failing test**

```ts
// payment-worker/test/session.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSession, setSession, clearSession } from '../src/session';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get:    vi.fn(async (k: string) => store.get(k) ?? null),
    put:    vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

describe('session', () => {
  let kv: KVNamespace;
  beforeEach(() => { kv = fakeKV(); });

  it('returns idle for unknown user', async () => {
    expect(await getSession(1, kv)).toEqual({ step: 'idle' });
  });

  it('round-trips a session through put/get', async () => {
    await setSession(1, { step: 'enter_amount', tenancyId: 'rec1' }, kv);
    expect(await getSession(1, kv)).toEqual({ step: 'enter_amount', tenancyId: 'rec1' });
  });

  it('clearSession deletes the entry', async () => {
    await setSession(1, { step: 'confirm' }, kv);
    await clearSession(1, kv);
    expect(await getSession(1, kv)).toEqual({ step: 'idle' });
  });

  it('setSession applies 1hr TTL', async () => {
    await setSession(1, { step: 'idle' }, kv);
    expect(kv.put).toHaveBeenCalledWith(
      'session:1',
      expect.any(String),
      { expirationTtl: 3600 },
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- session`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `session.ts` and `types.ts`**

`payment-worker/src/types.ts` is unchanged from current; ensure it exports `WizardSession`. Add a webhook secret to `Env`:

```ts
// payment-worker/src/types.ts
export interface Env {
  TELEGRAM_BOT_TOKEN:      string;
  TELEGRAM_WEBHOOK_SECRET: string;
  AIRTABLE_TOKEN:          string;
  AIRTABLE_BASE_ID:        string;
  AUTHORIZED_USER_ID:      string;
  SESSION_KV:              KVNamespace;
}

export type WizardStep =
  | 'idle' | 'select_charge' | 'enter_amount'
  | 'select_method' | 'select_date' | 'enter_date' | 'confirm';

export interface WizardSession {
  step:           WizardStep;
  tenancyId?:     string;
  tenancyLabel?:  string;
  chargeId?:      string;
  chargeLabel?:   string;
  chargeBalance?: number;
  amount?:        number;
  method?:        string;
  date?:          string;
}

// Removed: AirtableRecord (now imported from @rent/airtable-client)
```

```ts
// payment-worker/src/session.ts
import type { WizardSession } from './types';

export async function getSession(userId: number, kv: KVNamespace): Promise<WizardSession> {
  const raw = await kv.get(`session:${userId}`);
  return raw ? (JSON.parse(raw) as WizardSession) : { step: 'idle' };
}

export async function setSession(
  userId: number,
  s: WizardSession,
  kv: KVNamespace,
): Promise<void> {
  await kv.put(`session:${userId}`, JSON.stringify(s), { expirationTtl: 3600 });
}

export async function clearSession(userId: number, kv: KVNamespace): Promise<void> {
  await kv.delete(`session:${userId}`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add payment-worker/src/session.ts payment-worker/src/types.ts payment-worker/test/session.test.ts
git commit -m "feat(payment-worker): extract session helpers + add TELEGRAM_WEBHOOK_SECRET"
```

### Task 4.4: Extract `auth.ts` for webhook secret + user-ID guard (test-first)

**Files:**
- Create: `payment-worker/test/auth.test.ts`
- Create: `payment-worker/src/auth.ts`

- [ ] **Step 1: Write the failing test**

```ts
// payment-worker/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { requireWebhookSecret } from '../src/auth';

describe('requireWebhookSecret', () => {
  const SECRET = 'a'.repeat(32);

  it('returns null when header matches', () => {
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    });
    expect(requireWebhookSecret(req, SECRET)).toBeNull();
  });

  it('returns 401 when header missing', () => {
    const req = new Request('https://x', { method: 'POST' });
    expect(requireWebhookSecret(req, SECRET)?.status).toBe(401);
  });

  it('returns 401 when header wrong', () => {
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
    });
    expect(requireWebhookSecret(req, SECRET)?.status).toBe(401);
  });

  it('returns 401 when expected secret short/empty (fail-closed)', () => {
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': '' },
    });
    expect(requireWebhookSecret(req, '')?.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- auth`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// payment-worker/src/auth.ts
export function requireWebhookSecret(
  request: Request,
  expected: string,
): Response | null {
  if (!expected || expected.length < 16) {
    return new Response('Unauthorized', { status: 401 });
  }
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (got.length !== expected.length || got !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- payment-worker.*auth`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add payment-worker/src/auth.ts payment-worker/test/auth.test.ts
git commit -m "feat(payment-worker): add webhook secret guard"
```

### Task 4.5: Migrate `bot.ts` to use `@rent/airtable-client` and split

**Files:**
- Modify: `payment-worker/src/bot.ts`
- Delete: `payment-worker/src/airtable.ts`
- Modify: `payment-worker/src/index.ts`

- [ ] **Step 1: Update `bot.ts` to use the new helpers**

Replace `payment-worker/src/bot.ts` imports section and all `fetchAllRecords` / `createRecord` calls. Top of file:

```ts
import { Bot, InlineKeyboard } from 'grammy';
import {
  AirtableClient, TABLES,
  TenancySchema, ChargeSchema, PaymentSchema,
} from '@rent/airtable-client';
import type { Env, WizardSession } from './types';
import { getSession, setSession, clearSession } from './session';
import { formatAUD, parseAmount, parseDate, todayISO, yesterdayISO } from './format';
```

Within `createBot(env)`, instantiate the client at the top:

```ts
const airtable = new AirtableClient(env);
```

Replace each `fetchAllRecords(TABLE, params, env)` call with the schema-typed equivalent. Examples:

```ts
// Before:
const tenancies = await fetchAllRecords(TENANCIES_TABLE, {...}, env);
// After:
const tenancies = await airtable.fetchAll(TABLES.TENANCIES, TenancySchema, {...});

// Before:
const allCharges = await fetchAllRecords(CHARGES_TABLE, {...}, env);
// After:
const allCharges = await airtable.fetchAll(TABLES.CHARGES, ChargeSchema, {...});

// Before:
const tenancyRec = await fetchAllRecords(TENANCIES_TABLE, {filterByFormula: `RECORD_ID()="${tenancyId}"`}, env);
// After:
const tenancyRec = await airtable.fetchAll(TABLES.TENANCIES, TenancySchema, {
  fields: ['Label'],
  filterByFormula: `RECORD_ID() = "${tenancyId}"`,
});

// Before (createRecord):
const record = await createRecord(PAYMENTS_TABLE, {...}, env);
// After:
const record = await airtable.create(TABLES.PAYMENTS, PaymentSchema, {...});
```

Update the field accesses to use the typed forms:

```ts
// Before:
const balance = (t.fields['Balance'] as number) ?? 0;
// After:
const balance = t.fields.Balance ?? 0;
```

Replace text-input handlers `parseFloat(text.replace(...))` with `parseAmount(text)`, and the manual-date branch with `parseDate(text)`. Replace `todayISO()` and `yesterdayISO()` calls — already match imported names. Replace `parse_mode: 'Markdown'` calls unchanged.

The label-name extraction `session.tenancyLabel?.split(' ').slice(1).join(' ')` stays as-is.

- [ ] **Step 2: Replace `payment-worker/src/index.ts`**

```ts
// payment-worker/src/index.ts
import { webhookCallback } from 'grammy';
import { createBot }       from './bot';
import { requireWebhookSecret } from './auth';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('payment-bot is running', { status: 200 });
    }
    const denied = requireWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET);
    if (denied) return denied;

    const bot     = createBot(env);
    const handler = webhookCallback(bot, 'cloudflare-mod');
    return handler(request);
  },
};
```

- [ ] **Step 3: Delete `airtable.ts`**

```bash
git rm payment-worker/src/airtable.ts
```

- [ ] **Step 4: Update `wrangler.toml`**

```toml
name               = "payment-bot"
main               = "src/index.ts"
compatibility_date = "2026-04-26"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[vars]
AIRTABLE_BASE_ID = "app6He8xRaUzNBTDl"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "220ffe76ec364d6eaf8726ed01e6495b"
```

- [ ] **Step 5: Verify build + unit tests**

```bash
cd payment-worker && npx tsc --noEmit && npx wrangler deploy --dry-run --outdir /tmp/pw-build && cd ..
npm run test
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add payment-worker
git commit -m "feat(payment-worker): migrate to @rent/airtable-client + add webhook secret guard"
```

### Task 4.6: Add Worker integration tests for payment-worker

**Files:**
- Create: `payment-worker/test/integration/webhook.test.ts`
- Create: `payment-worker/test/integration/wizard.test.ts`
- Create: `payment-worker/vitest.integration.config.ts`
- Modify: `vitest.workspace.ts`

- [ ] **Step 1: Add the integration vitest config**

```ts
// payment-worker/vitest.integration.config.ts
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    include: ['test/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2026-04-26',
          compatibilityFlags: ['nodejs_compat'],
          kvNamespaces: ['SESSION_KV'],
          bindings: {
            TELEGRAM_BOT_TOKEN:      'test:bot:token',
            TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
            AIRTABLE_TOKEN:          'test-token',
            AIRTABLE_BASE_ID:        'appTEST',
            AUTHORIZED_USER_ID:      '1234',
          },
        },
      },
    },
  },
});
```

Update `vitest.workspace.ts` to append:

```ts
'payment-worker/vitest.integration.config.ts',
```

- [ ] **Step 2: Write the webhook-secret test**

```ts
// payment-worker/test/integration/webhook.test.ts
import { SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(()  => { fetchMock.deactivate(); });

const SECRET = 'a'.repeat(32);

describe('webhook auth', () => {
  it('rejects POST without secret header', async () => {
    const res = await SELF.fetch('https://w/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST with wrong secret', async () => {
    const res = await SELF.fetch('https://w/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('GET / returns banner without auth', async () => {
    const res = await SELF.fetch('https://w/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('payment-bot is running');
  });
});
```

- [ ] **Step 3: Write the happy-path wizard test**

```ts
// payment-worker/test/integration/wizard.test.ts
import { SELF, env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(()  => { fetchMock.deactivate(); });

const SECRET = 'a'.repeat(32);
const USER_ID = 1234;

function tgUpdate(body: object) {
  return SELF.fetch('https://w/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': SECRET,
    },
    body: JSON.stringify(body),
  });
}

// Stub Telegram Bot API responses (grammy hits api.telegram.org)
function stubTelegram() {
  fetchMock.get('https://api.telegram.org')
    .intercept({ path: /.*/ })
    .reply(200, { ok: true, result: {} })
    .persist();
}

describe('wizard happy path', () => {
  it('rejects updates from non-authorized user', async () => {
    stubTelegram();
    const res = await tgUpdate({
      update_id: 1,
      message: {
        message_id: 1, date: 0,
        chat: { id: 999, type: 'private' },
        from: { id: 999, is_bot: false, first_name: 'X' },
        text: '/pay',
      },
    });
    expect(res.status).toBe(200); // bot replies "Unauthorised", returns 200 to TG
  });

  it('runs the full 6-step wizard and creates a Payment record', async () => {
    stubTelegram();

    fetchMock.get('https://api.airtable.com')
      .intercept({ path: /\/v0\/appTEST\/tblvVmo12VikITRH6\?.*/ })
      .reply(200, {
        records: [{ id: 'recT1', fields: { Label: '6B Sun Peng', Balance: 1650 } }],
      })
      .persist();

    fetchMock.get('https://api.airtable.com')
      .intercept({ path: /\/v0\/appTEST\/tblNCw6ZxspNxiKCu\?.*/ })
      .reply(200, {
        records: [{
          id: 'recC1',
          fields: { Label: '6B Sun Peng 2026-05 Rent', Balance: 1650, Status: 'Unpaid', 'Due Date': '2026-05-01', Tenancy: ['recT1'] },
        }],
      })
      .persist();

    let createBody: unknown = null;
    fetchMock.get('https://api.airtable.com')
      .intercept({ path: '/v0/appTEST/tbl8Zl9C9fzBDPllu', method: 'POST' })
      .reply((opts) => {
        createBody = JSON.parse(opts.body as string);
        return { statusCode: 200, data: { id: 'recPNew', fields: { Label: 'X' } } };
      });

    // 1. /pay
    await tgUpdate({
      update_id: 1,
      message: {
        message_id: 1, date: 0,
        chat: { id: USER_ID, type: 'private' },
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        text: '/pay',
      },
    });

    // 2. tap tenant
    await tgUpdate({
      update_id: 2,
      callback_query: {
        id: 'cq1', chat_instance: 'ci',
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 0, chat: { id: USER_ID, type: 'private' } },
        data: 'tenancy:recT1',
      },
    });

    // 3. tap charge
    await tgUpdate({
      update_id: 3,
      callback_query: {
        id: 'cq2', chat_instance: 'ci',
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        message: { message_id: 1, date: 0, chat: { id: USER_ID, type: 'private' } },
        data: 'charge:recC1',
      },
    });

    // 4. enter amount
    await tgUpdate({
      update_id: 4,
      message: {
        message_id: 2, date: 0,
        chat: { id: USER_ID, type: 'private' },
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        text: '1650',
      },
    });

    // 5. select method
    await tgUpdate({
      update_id: 5,
      callback_query: {
        id: 'cq3', chat_instance: 'ci',
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        message: { message_id: 2, date: 0, chat: { id: USER_ID, type: 'private' } },
        data: 'method:Cash',
      },
    });

    // 6. select date — Today
    const today = new Date().toISOString().slice(0, 10);
    await tgUpdate({
      update_id: 6,
      callback_query: {
        id: 'cq4', chat_instance: 'ci',
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        message: { message_id: 2, date: 0, chat: { id: USER_ID, type: 'private' } },
        data: `date:${today}`,
      },
    });

    // 7. confirm
    await tgUpdate({
      update_id: 7,
      callback_query: {
        id: 'cq5', chat_instance: 'ci',
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        message: { message_id: 3, date: 0, chat: { id: USER_ID, type: 'private' } },
        data: 'confirm:yes',
      },
    });

    expect(createBody).not.toBeNull();
    const body = createBody as { fields: { Charge: string[]; Amount: number; Method: string; 'Paid Date': string } };
    expect(body.fields.Charge).toEqual(['recC1']);
    expect(body.fields.Amount).toBe(1650);
    expect(body.fields.Method).toBe('Cash');
    expect(body.fields['Paid Date']).toBe(today);

    // Session cleared
    const sess = await env.SESSION_KV.get(`session:${USER_ID}`);
    expect(sess).toBeNull();
  });

  it('rejects invalid amount and keeps session unchanged', async () => {
    stubTelegram();

    fetchMock.get('https://api.airtable.com')
      .intercept({ path: /.*/ })
      .reply(200, { records: [] })
      .persist();

    // Seed a session at enter_amount step
    await env.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify({
      step: 'enter_amount',
      tenancyId: 'recT1',
      tenancyLabel: '6B Sun Peng',
      chargeId: 'recC1',
      chargeLabel: '6B Sun Peng 2026-05 Rent',
      chargeBalance: 1650,
    }), { expirationTtl: 3600 });

    await tgUpdate({
      update_id: 100,
      message: {
        message_id: 99, date: 0,
        chat: { id: USER_ID, type: 'private' },
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        text: 'abc',
      },
    });

    const sess = JSON.parse((await env.SESSION_KV.get(`session:${USER_ID}`)) ?? '{}');
    expect(sess.step).toBe('enter_amount'); // unchanged
  });

  it('clears session on /cancel', async () => {
    stubTelegram();
    await env.SESSION_KV.put(`session:${USER_ID}`, JSON.stringify({ step: 'confirm' }), { expirationTtl: 3600 });
    await tgUpdate({
      update_id: 200,
      message: {
        message_id: 200, date: 0,
        chat: { id: USER_ID, type: 'private' },
        from: { id: USER_ID, is_bot: false, first_name: 'O' },
        text: '/cancel',
      },
    });
    expect(await env.SESSION_KV.get(`session:${USER_ID}`)).toBeNull();
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: PASS. The grammy framework's behavior under `fetchMock` for outbound Bot API calls may need a tweak in `stubTelegram()` if your grammy version uses a different host or path; refer to the grammy webhook docs and the error output for the exact path.

- [ ] **Step 5: Commit**

```bash
git add payment-worker vitest.workspace.ts
git commit -m "test(payment-worker): add webhook auth + wizard happy-path integration tests"
```

---

## Phase 5 — Schema-drift script + CI workflows

### Task 5.1: Schema-drift script

**Files:**
- Create: `scripts/check-airtable-schema.ts`
- Create: `scripts/tsconfig.json`

- [ ] **Step 1: Create the tsconfig**

```json
// scripts/tsconfig.json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 2: Create the script**

```ts
// scripts/check-airtable-schema.ts
import { TABLES } from '../packages/airtable-client/src/tables';

interface AirtableField {
  id:   string;
  name: string;
  type: string;
}
interface AirtableTable {
  id:     string;
  name:   string;
  fields: AirtableField[];
}

const REQUIRED_FIELDS: Record<string, Record<string, string[]>> = {
  [TABLES.TENANCIES]: {
    Label:           ['singleLineText', 'formula'],
    'Monthly Rent':  ['number', 'currency'],
    'Start Date':    ['date'],
    'End Date':      ['date'],
    'Due Day':       ['number'],
    Balance:         ['number', 'currency', 'rollup', 'formula'],
  },
  [TABLES.CHARGES]: {
    Label:           ['singleLineText', 'formula'],
    Period:          ['singleLineText'],
    'Due Date':      ['date'],
    Amount:          ['number', 'currency'],
    Balance:         ['number', 'currency', 'formula', 'rollup'],
    Status:          ['singleSelect', 'formula'],
    Type:            ['singleSelect', 'singleLineText'],
    Tenancy:         ['multipleRecordLinks'],
  },
  [TABLES.PAYMENTS]: {
    Label:           ['singleLineText', 'formula'],
    Charge:          ['multipleRecordLinks'],
    Amount:          ['number', 'currency'],
    'Paid Date':     ['date'],
    Method:          ['singleSelect'],
    Notes:           ['multilineText', 'singleLineText'],
  },
};

async function main() {
  const token  = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) {
    console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID');
    process.exit(2);
  }

  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`Schema fetch failed: ${res.status} ${await res.text()}`);
    process.exit(2);
  }
  const data = await res.json() as { tables: AirtableTable[] };
  const tablesById = new Map(data.tables.map(t => [t.id, t]));

  const problems: string[] = [];
  for (const [tableId, requiredFields] of Object.entries(REQUIRED_FIELDS)) {
    const table = tablesById.get(tableId);
    if (!table) {
      problems.push(`Table missing: ${tableId}`);
      continue;
    }
    const fieldsByName = new Map(table.fields.map(f => [f.name, f]));
    for (const [name, allowedTypes] of Object.entries(requiredFields)) {
      const field = fieldsByName.get(name);
      if (!field) {
        problems.push(`[${table.name}] field missing: ${name}`);
        continue;
      }
      if (!allowedTypes.includes(field.type)) {
        problems.push(
          `[${table.name}] field "${name}" is type "${field.type}", expected one of: ${allowedTypes.join(', ')}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error('Schema drift detected:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('Airtable schema OK');
}

void main();
```

- [ ] **Step 3: Verify it typechecks**

```bash
npx tsc --noEmit -p scripts/tsconfig.json
```

Expected: success.

- [ ] **Step 4: Smoke-run locally (optional, requires real creds)**

If you have a real `AIRTABLE_TOKEN` in the environment, run:

```bash
AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=app6He8xRaUzNBTDl npm run check:schema
```

Expected: `Airtable schema OK`. If something has drifted, the diff will tell you what to update — fix `REQUIRED_FIELDS` or update the schemas in `packages/airtable-client`.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-airtable-schema.ts scripts/tsconfig.json
git commit -m "feat(scripts): add Airtable schema-drift check"
```

### Task 5.2: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint --if-present
      - run: npm run test
      - run: npm run build
```

- [ ] **Step 2: Push to a branch and verify CI green**

```bash
git checkout -b ci-bringup
git add .github
git commit -m "ci: add typecheck + test + build workflow"
git push -u origin ci-bringup
```

Open the PR, confirm the workflow runs and passes. Once green, merge.

- [ ] **Step 3: Back on main**

```bash
git checkout main && git pull
```

### Task 5.3: GitHub Actions schema-drift workflow

**Files:**
- Create: `.github/workflows/schema-check.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/schema-check.yml
name: schema-check
on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - id: check
        env:
          AIRTABLE_TOKEN:   ${{ secrets.AIRTABLE_TOKEN }}
          AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
        run: |
          set +e
          npm run check:schema 2>&1 | tee /tmp/schema-output.txt
          echo "exit_code=$?" >> $GITHUB_OUTPUT
      - name: Notify Discord on drift
        if: steps.check.outputs.exit_code != '0'
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
        run: |
          BODY=$(cat /tmp/schema-output.txt | tail -c 1500)
          jq -n --arg c "🔴 **Airtable schema drift detected**\n\n\`\`\`\n$BODY\n\`\`\`" \
            '{content: $c}' | \
            curl -X POST -H "Content-Type: application/json" -d @- "$DISCORD_WEBHOOK_URL"
          exit 1
```

- [ ] **Step 2: Add the GitHub repo secrets**

In GitHub UI: **Settings → Secrets → Actions** → add:
- `AIRTABLE_TOKEN` (read-only PAT recommended)
- `AIRTABLE_BASE_ID` = `app6He8xRaUzNBTDl`
- `DISCORD_WEBHOOK_URL` = same one charge-generator uses

- [ ] **Step 3: Trigger manually to verify**

In GitHub UI: **Actions → schema-check → Run workflow**
Expected: green run, log shows `Airtable schema OK`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/schema-check.yml
git commit -m "ci: add nightly Airtable schema-drift check with Discord alert"
```

---

## Phase 6 — Documentation sweep

### Task 6.1: Update root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the entire README**

```markdown
# rent-workers

npm-workspaces monorepo: two Cloudflare Workers + a shared Airtable client. Together they automate rent management for the New Haven property.

## Layout

| Path | What it is |
|---|---|
| [`packages/airtable-client/`](./packages/airtable-client/) | Shared Airtable REST client — Zod-validated, retried, timed-out |
| [`charge-generator/`](./charge-generator/) | Monthly cron Worker — creates charge records + Discord notification |
| [`payment-worker/`](./payment-worker/) | Telegram-webhook Worker — wizard for recording tenant payments |
| [`scripts/check-airtable-schema.ts`](./scripts/check-airtable-schema.ts) | Schema-drift detector run nightly in CI |

## Shared Airtable base

Both workers operate on `app6He8xRaUzNBTDl`:

```
Tenancies ──┬── read by charge-generator
            └── read by payment-bot

Charges ────┬── written by charge-generator
            └── read + written by payment-bot

Payments ───── written by payment-bot
```

## Development

```bash
npm install                # workspaces — installs everything
npm run typecheck
npm run test               # all unit + integration tests across workspaces
npm run build              # wrangler dry-run for both workers
npm run check:schema       # local Airtable schema-drift check (needs creds)
```

Per-worker dev:

```bash
cd charge-generator && npm run dev
cd payment-worker   && npm run dev
```

## Production setup

After merging this work, the operator must do these one-time steps:

1. `cd charge-generator && npx wrangler secret put RUN_TOKEN` — value: `openssl rand -hex 32`
2. `cd payment-worker && npx wrangler secret put TELEGRAM_WEBHOOK_SECRET` — value: `openssl rand -hex 32`
3. Re-register Telegram webhook with the secret:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://payment-bot.<sub>.workers.dev" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
4. GitHub repo secrets for the nightly schema check:
   - `AIRTABLE_TOKEN` (read-only PAT recommended)
   - `AIRTABLE_BASE_ID`
   - `DISCORD_WEBHOOK_URL`
5. Update saved `/run` invocations to send the bearer:
   ```bash
   curl -H "Authorization: Bearer $RUN_TOKEN" https://charge-generator.<sub>.workers.dev/run
   ```

## CI

- `.github/workflows/ci.yml` — typecheck + lint + test + build on every push and PR.
- `.github/workflows/schema-check.yml` — nightly 02:00 UTC, alerts Discord on drift.

Deploy is manual: `npm run deploy` from each worker dir.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite root README for monorepo layout + production setup"
```

### Task 6.2: Update `charge-generator/README.md`

**Files:**
- Modify: `charge-generator/README.md`

- [ ] **Step 1: Update env var table to add `RUN_TOKEN`**

In `charge-generator/README.md`, find the "Environment variables / secrets" section and replace its table with:

```markdown
| Name | How to set | Description |
|---|---|---|
| `AIRTABLE_TOKEN` | `wrangler secret put AIRTABLE_TOKEN` | PAT with `data.records:read` + `data.records:write` |
| `AIRTABLE_BASE_ID` | `wrangler secret put AIRTABLE_BASE_ID` | Airtable base ID (e.g. `app6He8xRaUzNBTDl`) |
| `DISCORD_WEBHOOK_URL` | `wrangler secret put DISCORD_WEBHOOK_URL` | Discord channel webhook URL |
| `RUN_TOKEN` | `wrangler secret put RUN_TOKEN` | High-entropy bearer token (≥16 chars; use `openssl rand -hex 32`) for `/run` |
```

- [ ] **Step 2: Update the "Manual trigger" section**

Replace its body with:

```markdown
Send a GET request to `/run` with the bearer token:

```bash
curl -H "Authorization: Bearer $RUN_TOKEN" \
  https://charge-generator.<your-subdomain>.workers.dev/run
```

Returns `Done — check Discord` on success, `401` if the bearer is wrong or missing.
```

- [ ] **Step 3: Add a "Testing" section after "Manual trigger"**

```markdown
## Testing

```bash
npm run test                     # from repo root — runs all unit + integration tests
npm run test -- charge-generator # this worker's tests only
```

Unit tests (`test/*.test.ts`) cover pure helpers (`due-date`, `discord`, `auth`).

Integration tests (`test/integration/*.test.ts`) run inside `@cloudflare/vitest-pool-workers` and exercise both the cron handler and the `/run` endpoint with mocked Airtable + Discord HTTP.
```

- [ ] **Step 4: Commit**

```bash
git add charge-generator/README.md
git commit -m "docs(charge-generator): document RUN_TOKEN + bearer auth + testing"
```

### Task 6.3: Update `payment-worker/README.md`

**Files:**
- Modify: `payment-worker/README.md`

- [ ] **Step 1: Update the secrets table**

In the "Secrets" section, replace the table with:

```markdown
| Name | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | High-entropy secret (≥16 chars; use `openssl rand -hex 32`) — Telegram echoes this on every webhook POST |
| `AIRTABLE_TOKEN` | PAT with `data.records:read` + `data.records:write` |
| `AUTHORIZED_USER_ID` | Your Telegram numeric user ID (get from @userinfobot) |
```

- [ ] **Step 2: Update the "Register Telegram webhook" step**

Replace step 4 of "Setup" with:

```markdown
### 4 — Register Telegram webhook (with secret)

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://payment-bot.<your-subdomain>.workers.dev" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Telegram returns `{"ok":true,"result":true,"description":"Webhook was set"}`. Telegram now sends `X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>` on every webhook POST; the Worker rejects POSTs without this header.
```

- [ ] **Step 3: Add a "Testing" section**

After "Development commands", add:

```markdown
## Testing

```bash
npm run test                  # all tests across workspaces
npm run test -- payment-worker
```

Unit tests cover pure modules (`format`, `session`, `auth`). Integration tests run the full Worker (webhook → grammy → Airtable) inside `@cloudflare/vitest-pool-workers` with all outbound HTTP mocked. The wizard test simulates all six wizard steps and asserts the final Payment record payload.
```

- [ ] **Step 4: Commit**

```bash
git add payment-worker/README.md
git commit -m "docs(payment-worker): document TELEGRAM_WEBHOOK_SECRET + testing"
```

### Task 6.4: Add `packages/airtable-client/README.md`

**Files:**
- Create: `packages/airtable-client/README.md`

- [ ] **Step 1: Create**

```markdown
# @rent/airtable-client

Shared Airtable REST client used by `charge-generator` and `payment-worker`.

## API

```ts
import {
  AirtableClient, TABLES,
  TenancySchema, ChargeSchema, PaymentSchema,
} from '@rent/airtable-client';

const client = new AirtableClient({
  AIRTABLE_TOKEN:   env.AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID: env.AIRTABLE_BASE_ID,
});

const tenancies = await client.fetchAll(
  TABLES.TENANCIES, TenancySchema,
  { fields: ['Label', 'Monthly Rent'] },
);

const payment = await client.create(
  TABLES.PAYMENTS, PaymentSchema,
  { Label: '...', Charge: ['rec123'], Amount: 1650 },
);
```

## Behaviour

- **Schema-validated:** every record's fields are parsed with the supplied Zod schema. Drift fails the read with a field-path error.
- **Pagination:** `fetchAll` follows `offset` until exhausted.
- **Timeouts:** every request wrapped in `AbortSignal.timeout(10_000)`.
- **Retries:** 5xx and network errors retry up to twice (backoff 200ms, 800ms). 4xx fails immediately.

## Adding a new table

1. Add the table ID to `src/tables.ts`.
2. Add a Zod schema to `src/schemas.ts` (and a `z.infer<>` type alias).
3. Add tests to `test/schemas.test.ts`.
4. Add the table + required fields to `scripts/check-airtable-schema.ts` so drift is caught nightly.
```

- [ ] **Step 2: Commit**

```bash
git add packages/airtable-client/README.md
git commit -m "docs(airtable-client): add package README"
```

### Task 6.5: Add `docs/runbook.md`

**Files:**
- Create: `docs/runbook.md`

- [ ] **Step 1: Create**

```markdown
# Runbook

Short, concrete procedures for common operational issues.

## charge-generator did not run on the 15th

1. Check Cloudflare dashboard → charge-generator → Logs. If there's no entry for the run, the cron didn't fire — check `wrangler triggers list` and the `triggers.crons` array in `wrangler.jsonc`.
2. If the cron fired but errored, the error is in the log line `[YYYY-MM] ERRORS:`.
3. To rerun manually:
   ```bash
   curl -H "Authorization: Bearer $RUN_TOKEN" \
     https://charge-generator.<sub>.workers.dev/run
   ```
   It is idempotent — already-created charges are skipped.

## All charges errored

Common cause: Airtable PAT was rotated or revoked. Check the error message in CF logs:

- `HTTP 401`: token issue. `wrangler secret put AIRTABLE_TOKEN` with a fresh PAT.
- `HTTP 422`: schema drift. Run `npm run check:schema` locally to identify the bad field.

## Schema drift detected (Discord red alert)

1. The Discord message contains the diff. Most common drift: a renamed field.
2. Update `packages/airtable-client/src/schemas.ts` to match the new shape.
3. Update `scripts/check-airtable-schema.ts` `REQUIRED_FIELDS` block to match.
4. Update any code that referenced the old field name.
5. Push, CI green → merge.

## Telegram bot stops responding

1. Check `getWebhookInfo`:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
   ```
   Look at `last_error_date` / `last_error_message`. A `401` here means the webhook secret is wrong.
2. If the secret is rotated, re-register:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://payment-bot.<sub>.workers.dev" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
3. Check Cloudflare → payment-bot → Logs for any 401 spam — that's evidence of someone scanning the URL.

## Nightly schema-check failed in GitHub Actions

Same as "Schema drift detected" above — see the workflow run output for the diff.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook.md
git commit -m "docs: add operational runbook"
```

### Task 6.6: Update `charge-generator/AGENTS.md`

**Files:**
- Modify: `charge-generator/AGENTS.md`

- [ ] **Step 1: Open the file and check for stale references**

Look for any of:
- `helper.ts` (now deleted)
- duplication notes about `buildQS` / `fetchAllRecords` (now in shared package)
- file paths that no longer exist

- [ ] **Step 2: Update accordingly**

Replace stale references with the new module paths (`due-date.ts`, `discord.ts`, `charges.ts`, `auth.ts`) and a one-line note that Airtable I/O lives in `@rent/airtable-client`.

- [ ] **Step 3: Commit**

```bash
git add charge-generator/AGENTS.md
git commit -m "docs(charge-generator): refresh AGENTS.md after refactor"
```

---

## Phase 7 — Final verification

### Task 7.1: Full green run

- [ ] **Step 1: Clean install and full test**

```bash
rm -rf node_modules
npm ci
npm run typecheck
npm run lint --if-present
npm run test
npm run build
```

All five must exit 0.

- [ ] **Step 2: Smoke-test schema check (with real creds)**

```bash
AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=app6He8xRaUzNBTDl npm run check:schema
```

Expected: `Airtable schema OK`.

- [ ] **Step 3: Confirm both workers deploy-dry-run cleanly**

```bash
cd charge-generator && npx wrangler deploy --dry-run --outdir /tmp/cg-build && cd ..
cd payment-worker   && npx wrangler deploy --dry-run --outdir /tmp/pw-build && cd ..
```

- [ ] **Step 4: Operator deploys both workers and runs the manual setup steps from root README's "Production setup" section.**

The four post-deploy items are:
1. `RUN_TOKEN` secret on charge-generator.
2. `TELEGRAM_WEBHOOK_SECRET` secret on payment-worker.
3. Re-register Telegram webhook with `secret_token`.
4. GitHub Actions secrets for the nightly schema check.

After this step, the system is fully productionized and CI-protected.

---

## Self-review

Verified the plan against the spec:

| Spec section | Implementing tasks |
|---|---|
| §2 Repo structure (workspaces, files) | 1.1, 1.2, 1.3, 2.1, 3.5, 4.5 |
| §3 Shared client — schemas, retries, timeouts | 2.1–2.9 |
| §4 Security — bearer + webhook secret | 3.4, 3.5, 4.4, 4.5 |
| §5 Test layers — unit, integration, schema-drift | 2.2, 2.4, 2.5, 2.7, 2.8, 2.9, 3.2, 3.3, 3.4, 3.6, 4.2, 4.3, 4.4, 4.6, 5.1 |
| §6 CI workflows | 5.2, 5.3 |
| §7 Implementation sequencing — interleave refactor + tests | reflected in phase ordering |
| §7 step 7 — align `compatibility_date` | 3.6, 4.5 |
| §8 Documentation updates | 6.1–6.6 |
| §9 Manual operator steps | documented in 6.1 (root README) and 7.1 step 4 |
| §10 Out of scope | enforced by absence — none of these tasks add staging, Cloudflare Access, sandbox base, auto-deploy, multi-user, table-IDs-in-env, top-level CLAUDE.md, or extra alerting |

No placeholders. Type/method names consistent across tasks. Every step has either runnable code or a runnable command.
