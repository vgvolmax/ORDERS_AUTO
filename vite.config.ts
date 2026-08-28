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
      // `file://` cannot reliably execute native ES modules. Build the single
      // entry as an IIFE so the final inlined script can run as a classic script.
      output: {
        format: 'iife',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
