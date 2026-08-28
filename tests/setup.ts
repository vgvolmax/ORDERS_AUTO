import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Browsers expose Blob.arrayBuffer(), but the jsdom Blob/File implementation
// used by Vitest may not. The import workflow intentionally uses the browser
// API, so tests provide the missing platform capability instead of weakening
// production code with a test-only fallback.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(reader.result);
            return;
          }

          reject(new Error('Expected FileReader to return an ArrayBuffer.'));
        };

        reader.onerror = () => {
          reject(reader.error ?? new Error('Failed to read test Blob.'));
        };

        reader.readAsArrayBuffer(this);
      });
    },
  });
}
