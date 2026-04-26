import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    name: 'payment-worker-integration',
    include: ['test/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        main: './src/index.ts',
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2026-04-26',
          compatibilityFlags: ['nodejs_compat'],
          kvNamespaces: ['SESSION_KV'],
          bindings: {
            TELEGRAM_BOT_TOKEN: 'test:bot:token',
            TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
            AIRTABLE_TOKEN: 'test-token',
            AIRTABLE_BASE_ID: 'appTEST',
            AUTHORIZED_USER_ID: '1234',
          },
        },
      },
    },
  },
});
