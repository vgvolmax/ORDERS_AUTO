import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('repository packaging', () => {
  it('exposes exactly one user-launchable HTML file in the repository root', () => {
    const rootHtmlFiles = fs
      .readdirSync('.', { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
      .map((entry) => entry.name)
      .sort();

    expect(rootHtmlFiles).toEqual(['ORDERS_AUTO.html']);
    expect(fs.existsSync('src/app.html')).toBe(true);
  });
});
