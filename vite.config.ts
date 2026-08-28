import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: resolve(process.cwd(), 'src/app.html'),
      // `file://` cannot reliably execute native ES modules. Build the single
      // entry as an IIFE; the postprocessor only changes its opening tag.
      output: {
        format: 'iife',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
});
