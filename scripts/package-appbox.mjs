import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';

const MIB = 1024 * 1024;
const ALLOWED = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.txt', '.csv', '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
]);

function filesIn(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return filesIn(full);
    if (!entry.isFile()) throw new Error('Unsupported package entry: ' + full);
    return [full];
  });
}

async function rasterize(svgPath, pngPath, browser) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const viewBox = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  if (!viewBox) throw new Error('SVG has no viewBox: ' + svgPath);
  const dimensions = viewBox[1].trim().split(/[\s,]+/).map(Number);
  const widthInSvg = dimensions[2];
  const heightInSvg = dimensions[3];
  if (dimensions.length !== 4 || !(widthInSvg > 0) || !(heightInSvg > 0)) {
    throw new Error('Invalid SVG viewBox: ' + svgPath);
  }
  const width = Math.min(1600, Math.max(128, Math.round(widthInSvg * 2)));
  const height = Math.round(width * heightInSvg / widthInSvg);
  if (height < 1 || height > 1600) throw new Error('Unsupported SVG dimensions: ' + svgPath);

  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.route(/^https?:\/\//, (route) => route.abort());
    const source = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    await page.setContent(
      '<html><body style="margin:0;background:transparent"><img id="art" src="' +
      source + '" width="' + width + '" height="' + height + '"></body></html>',
    );
    const image = page.locator('#art');
    await image.evaluate(async (element) => {
      await element.decode();
      if (!element.naturalWidth) throw new Error('SVG did not render');
    });
    await image.screenshot({ path: pngPath, omitBackground: true });
  } finally {
    await page.close();
  }
}

function validate(folder) {
  const files = filesIn(folder);
  const names = files.map((name) => path.relative(folder, name).split(path.sep).join('/'));
  const html = names.filter((name) => name.toLowerCase().endsWith('.html'));
  if (html.length !== 1 || html[0] !== 'index.html') {
    throw new Error('AppBox requires exactly one HTML entry at index.html');
  }
  if (names.length > 500) throw new Error('AppBox package exceeds 500 files');
  let total = 0;
  for (let i = 0; i < files.length; i += 1) {
    const name = names[i];
    if (name.startsWith('/') || name.split('/').some((part) =>
      !part || part.startsWith('.') || part === '..' || part.includes('%') || part.includes('\\'))) {
      throw new Error('Forbidden AppBox path: ' + name);
    }
    if (!ALLOWED.has(path.extname(name).toLowerCase())) {
      throw new Error('Unsupported AppBox file extension: ' + name);
    }
    const size = fs.statSync(files[i]).size;
    if (size > 25 * MIB) throw new Error('AppBox file exceeds 25 MiB: ' + name);
    total += size;
  }
  if (total > 50 * MIB) throw new Error('AppBox extraction exceeds 50 MiB');
  if (!names.includes('appbox.json') || !names.includes('assets/app.js') || !names.includes('assets/app.css')) {
    throw new Error('AppBox manifest or required runtime asset is missing');
  }
  if (fs.statSync(path.join(folder, 'appbox.json')).size > 256 * 1024) {
    throw new Error('AppBox manifest exceeds 256 KiB');
  }
  const entry = fs.readFileSync(path.join(folder, 'index.html'), 'utf8');
  if (/(?:https?:)?\/\//i.test(entry)) throw new Error('Remote URL in AppBox HTML entry');
  for (const name of names.filter((name) => /\.(?:html|js|mjs|css)$/i.test(name))) {
    const source = fs.readFileSync(path.join(folder, name), 'utf8');
    if (/\b[\w./-]+\.svg(?:["'?#]|$)/i.test(source)) {
      throw new Error('Unconverted SVG reference: ' + name);
    }
  }
  return names.sort();
}

export async function packageAppBox(
  source = 'dist/ORDERS_AUTO',
  destination = 'dist/ORDERS_AUTO.appbox.zip',
) {
  const original = path.resolve(source);
  const output = path.resolve(destination);
  if (!fs.statSync(path.join(original, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Run the existing npm run build before packaging for AppBox');
  }
  if (!path.relative(original, output).startsWith('..')) {
    throw new Error('AppBox output must not be inside the existing offline package');
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'volmax-appbox-'));
  const copy = path.join(temp, 'package');
  let browser;
  try {
    fs.cpSync(original, copy, { recursive: true });
    const svgs = filesIn(copy).filter((name) => /\.svg$/i.test(name));
    const basenames = svgs.map((name) => path.basename(name).toLowerCase());
    if (new Set(basenames).size !== basenames.length) {
      throw new Error('Duplicate SVG basenames prevent safe reference replacement');
    }
    if (svgs.length) browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const svg of svgs) {
      const png = svg.replace(/\.svg$/i, '.png');
      if (fs.existsSync(png)) throw new Error('Target PNG already exists: ' + png);
      await rasterize(svg, png, browser);
      const oldName = path.basename(svg);
      const newName = path.basename(png);
      let references = 0;
      for (const file of filesIn(copy).filter((name) => /\.(?:html|js|mjs|css)$/i.test(name))) {
        const before = fs.readFileSync(file, 'utf8');
        if (!before.includes(oldName)) continue;
        references += before.split(oldName).length - 1;
        fs.writeFileSync(file, before.replaceAll(oldName, newName));
      }
      if (!references) throw new Error('Unreferenced SVG in production package: ' + oldName);
      fs.unlinkSync(svg);
    }

    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    const shortSha = (process.env.GITHUB_SHA || '').slice(0, 7);
    const manifest = {
      formatVersion: 1,
      slug: process.env.APPBOX_SLUG || 'volmax-boost',
      name: 'Волмакс Буст',
      description: 'Автономная подготовка заказов, проверка счетов и управление перемещениями',
      version: process.env.APPBOX_VERSION || version + (shortSha ? '+' + shortSha : ''),
      entry: 'index.html',
      mode: 'stateless',
    };
    fs.writeFileSync(path.join(copy, 'appbox.json'), JSON.stringify(manifest, null, 2) + '\n');
    const names = validate(copy);
    const zip = new JSZip();
    for (const name of names) {
      zip.file(name, fs.readFileSync(path.join(copy, name)), {
        date: new Date('1980-01-01T00:00:00.000Z'),
        createFolders: false,
        compression: 'DEFLATE',
      });
    }
    const buffer = await zip.generateAsync({
      type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 },
    });
    if (buffer.length > 25 * MIB) throw new Error('AppBox ZIP exceeds 25 MiB');
    const reopened = await JSZip.loadAsync(buffer, { checkCRC32: true });
    if (Object.keys(reopened.files).length !== names.length || !reopened.file('appbox.json')) {
      throw new Error('AppBox ZIP integrity verification failed');
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, buffer);
    console.log('AppBox package verified: ' + names.length + ' files, ' + buffer.length + ' bytes');
    return output;
  } finally {
    if (browser) await browser.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageAppBox(process.argv[2], process.argv[3]);
}
