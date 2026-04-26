import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    name: 'charge-generator-integration',
    include: ['test/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        main: './src/index.ts',
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2026-04-26',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            AIRTABLE_TOKEN: 'test-token',
            AIRTABLE_BASE_ID: 'appTEST',
            DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
            RUN_TOKEN: 'a'.repeat(32),
          },
          durableObjects: {
            CHARGE_GENERATION_LOCK: {
              className: 'ChargeGenerationLock',
              useSQLite: true,
            },
          },
        },
      },
    },
  },
});
