import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // El proyecto usa jsx: preserve (Next.js). Vitest necesita transformar el
  // JSX para poder renderizar componentes en los tests.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
