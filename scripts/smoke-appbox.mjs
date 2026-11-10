import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';

const input = path.resolve(process.argv[2] || 'dist/ORDERS_AUTO.appbox.zip');
const archive = await JSZip.loadAsync(fs.readFileSync(input), { checkCRC32: true });
const entries = Object.values(archive.files);
const manifestFile = archive.file('appbox.json');
if (!manifestFile) throw new Error('Missing appbox.json');
const manifest = JSON.parse(await manifestFile.async('string'));
if (manifest.formatVersion !== 1 || manifest.mode !== 'stateless' || manifest.entry !== 'index.html') {
  throw new Error('Incompatible AppBox manifest');
}
if (entries.some((file) => file.dir || /\.svg$/i.test(file.name))) {
  throw new Error('Unsupported AppBox ZIP entries');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'volmax-appbox-smoke-'));
let browser;
try {
  for (const entry of entries) {
    if (entry.name.startsWith('/') ||
        entry.name.split('/').some((part) => !part || part === '..' || part.startsWith('.'))) {
      throw new Error('Unsafe archive path: ' + entry.name);
    }
    const dest = path.join(tmp, entry.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async('nodebuffer'));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.setOffline(true);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) errors.push('Remote request: ' + request.url());
  });
  await page.goto(pathToFileURL(path.join(tmp, 'index.html')).href);
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 20_000 });
  const logos = await page.locator('.sidebar .brand img, .workspace-masthead-row img').evaluateAll(
    (images) => images.map((image) => ({ ready: image.complete, width: image.naturalWidth })),
  );
  if (logos.length !== 2 || logos.some((logo) => !logo.ready || !logo.width)) {
    throw new Error('AppBox branding failed to render: ' + JSON.stringify(logos));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('AppBox offline smoke passed: ' + manifest.name + ', ' + entries.length + ' files, logos and app loaded');
} finally {
  if (browser) await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
