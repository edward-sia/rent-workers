import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'payment-worker-unit',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
