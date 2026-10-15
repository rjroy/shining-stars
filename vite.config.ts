import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/shining-stars/' : '/',
  test: {
    clearMocks: true,
    restoreMocks: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
