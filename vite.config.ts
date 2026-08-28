import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
