import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- production validator is intentionally plain Node.js
import { validateOfflinePackage } from '../../scripts/assert-offline-package.mjs';

describe('offline production package contract', () => {
  function fixture(html: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-auto-package-'));
    fs.mkdirSync(path.join(directory, 'assets'));
    fs.writeFileSync(path.join(directory, 'assets/app.js'), 'window.APP_STARTED = true;');
    fs.writeFileSync(path.join(directory, 'assets/app.css'), 'body { color: black; }');
    fs.writeFileSync(path.join(directory, 'index.html'), html);
    return directory;
  }

  it('PACK-01..06 accepts portable external classic JS and CSS', () => {
    const directory = fixture(`<!doctype html><html lang="ru"><head>
      <link rel="stylesheet" href="./assets/app.css">
      <script defer src="./assets/app.js"></script>
      </head><body><div id="root"></div></body></html>`);

    expect(() => validateOfflinePackage(directory)).not.toThrow();
  });

  it('rejects inline/module JavaScript and missing or escaping resources', () => {
    const inline = fixture('<div id="root"></div><script type="module">alert(1)</script>');
    expect(() => validateOfflinePackage(inline)).toThrow(/module scripts/);

    const missing = fixture('<div id="root"></div><script defer src="./assets/missing.js"></script>');
    expect(() => validateOfflinePackage(missing)).toThrow(/does not exist/);

    const escaping = fixture('<div id="root"></div><script defer src="./../outside.js"></script>');
    expect(() => validateOfflinePackage(escaping)).toThrow(/leaves/);
  });

  it('does not keep a generated root launcher', () => {
    expect(fs.existsSync('ORDERS_AUTO.html')).toBe(false);
  });
});
