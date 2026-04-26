import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/airtable-client/vitest.config.ts',
  'charge-generator/vitest.config.ts',
  'charge-generator/vitest.integration.config.ts',
]);
