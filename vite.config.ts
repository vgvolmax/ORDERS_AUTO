import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/ORDERS_AUTO',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    copyPublicDir: false,
    cssCodeSplit: false,
    // file:// font fetches can be CORS-blocked in Chrome. Ship font bytes in
    // the local stylesheet; application JS remains a separate classic file.
    assetsInlineLimit: (filePath) => filePath.endsWith('.woff2'),
    rollupOptions: {
      input: resolve(process.cwd(), 'src/main.tsx'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith('.css'))
            ? 'assets/app.css'
            : 'assets/[name][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['./tests/**/*.test.{ts,tsx}'],
  },
});
