import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tenancy',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
