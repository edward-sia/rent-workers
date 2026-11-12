# @rent/airtable-client

Shared Airtable REST client used by `charge-generator` and `payment-worker`.

## API

```ts
import {
  AirtableClient,
  ChargeSchema,
  PaymentSchema,
  RoomSchema,
  TABLES,
  TenancySchema,
  TenantSchema,
  formulaString,
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

// PATCH one record; only the given fields change.
const room = await client.update(
  TABLES.ROOMS,
  RoomSchema,
  'rec123',
  { Status: 'Occupied' },
);

// Build a filterByFormula value from user text (escapes `\` and `"`).
const tenants = await client.fetchAll(TABLES.TENANTS, TenantSchema, {
  filterByFormula: `{Name} = ${formulaString('Sun Peng')}`,
});
```

Tables: `TENANCIES`, `CHARGES`, `PAYMENTS`, `TENANTS`, `ROOMS`.
`RoomSchema` has `Code`, `Default Rent` and `Status`. `TenantSchema` has `Name` and `Notes`.
`TenancySchema` also has the `Room` and `Tenant` links and `Frequency`.

## Behavior

- Follows Airtable pagination until `offset` is exhausted.
- Serializes `fields[]` query params in Airtable's expected bracket notation.
- Parses every returned record with the supplied Zod schema.
- Includes field-path details in schema mismatch errors.
- Accepts current Charge status values used by the Workers, including `Due`, `Unpaid`, `Partial`, `Paid`, and `Overdue`.
- Applies a 10 second request timeout by default.
- `update` sends a PATCH to one record and parses the returned fields with the schema.
- Retries GET and PATCH requests up to two times after a network error, a timeout or a 5xx response. GET and PATCH are safe to send again.
- Sends a POST (`create`) once. A POST that gets a 5xx, a timeout or a network error throws straight away. Airtable may still have created the record, so check before creating it again.
- Fails fast on 4xx responses.

## Schema Drift

The repo includes `scripts/check-airtable-schema.ts`, which compares required Airtable fields against the live base. Run it locally only with real credentials:

```bash
AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=app6He8xRaUzNBTDl npm run check:schema
```

The nightly GitHub workflow logs a short summary and sends it to Discord on failure. The summary includes the HTTP status when Airtable responds. Run the command locally for field-level drift details.

The check also confirms that Rooms `Status` has the options `Occupied` and `Vacant`, and that Tenancies `Frequency` has `Monthly`.

## Adding Tables or Fields

1. Add table IDs to `src/tables.ts`.
2. Add or update schemas in `src/schemas.ts`.
3. Add schema tests under `test/`.
4. Update any worker README that depends on the new fields.
5. Update the required-field list in `scripts/check-airtable-schema.ts`.
