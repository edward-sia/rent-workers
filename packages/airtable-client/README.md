# @rent/airtable-client

Shared Airtable REST client used by `charge-generator` and `payment-worker`.

## API

```ts
import {
  AirtableClient,
  ChargeSchema,
  PaymentSchema,
  TABLES,
  TenancySchema,
} from '@rent/airtable-client';

const client = new AirtableClient({
  AIRTABLE_TOKEN:   env.AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID: env.AIRTABLE_BASE_ID,
});

const tenancies = await client.fetchAll(
  TABLES.TENANCIES,
  TenancySchema,
  { fields: ['Label', 'Monthly Rent'] },
);

const charge = await client.create(
  TABLES.CHARGES,
  ChargeSchema,
  { Label: 'Example 2026-05 Rent', Tenancy: ['rec123'], Amount: 1650 },
);

const payment = await client.create(
  TABLES.PAYMENTS,
  PaymentSchema,
  { Label: 'Example 2026-05-01 $1,650.00', Charge: [charge.id], Amount: 1650 },
);
```

## Behavior

- Follows Airtable pagination until `offset` is exhausted.
- Serializes `fields[]` query params in Airtable's expected bracket notation.
- Parses every returned record with the supplied Zod schema.
- Includes field-path details in schema mismatch errors.
- Applies a 10 second request timeout by default.
- Retries network errors and 5xx responses up to two times.
- Fails fast on 4xx responses.

## Schema Drift

The repo includes `scripts/check-airtable-schema.ts`, which compares required Airtable fields against the live base. Run it locally only with real credentials:

```bash
AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=app6He8xRaUzNBTDl npm run check:schema
```

The GitHub `schema-check` workflow runs the same check nightly and alerts Discord when fields drift.

## Adding Tables or Fields

1. Add table IDs to `src/tables.ts`.
2. Add or update schemas in `src/schemas.ts`.
3. Add schema tests under `test/`.
4. Update any worker README that depends on the new fields.
5. Update the required-field list in `scripts/check-airtable-schema.ts`.
