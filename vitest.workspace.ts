import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'schema-check', include: ['scripts/test/**/*.test.ts'] } },
  'packages/airtable-client/vitest.config.ts',
  'packages/tenancy/vitest.config.ts',
  'charge-generator/vitest.config.ts',
  'charge-generator/vitest.integration.config.ts',
  'payment-worker/vitest.config.ts',
  'payment-worker/vitest.integration.config.ts',
]);
