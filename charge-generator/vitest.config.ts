import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'charge-generator-unit',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
  },
});
