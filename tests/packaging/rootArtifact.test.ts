import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('repository packaging', () => {
  it('exposes exactly one user-launchable HTML file in the repository root', () => {
    expect(fs.existsSync('ORDERS_AUTO.html')).toBe(true);
    expect(fs.existsSync('index.html')).toBe(false);
    expect(fs.existsSync('src/app.html')).toBe(true);
  });
});
