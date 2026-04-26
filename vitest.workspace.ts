import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Worker-runtime tests will be added per-package as they appear:
  //   'packages/airtable-client/vitest.config.ts',
  //   'charge-generator/vitest.config.ts',
  //   'payment-worker/vitest.config.ts',
]);
