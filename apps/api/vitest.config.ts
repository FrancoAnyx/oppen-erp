import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['test/**', 'node_modules/**', 'dist/**'],
    globals: false,
    reporters: ['default'],
  },
});
