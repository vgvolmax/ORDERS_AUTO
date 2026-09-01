import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DEFAULT_PACKAGE_DIRECTORY = path.resolve('dist/ORDERS_AUTO');
const resourceSelectors = [
  ['script[src]', 'src'],
  ['link[href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['audio[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['object[data]', 'data'],
];

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function assertPortableResource(reference, entryDirectory, packageDirectory) {
  if (!reference.startsWith('./')) {
    throw new Error(`Runtime resource must use a portable ./ path: ${reference}`);
  }
  if (/^(?:https?:)?\/\//i.test(reference)) {
    throw new Error(`Remote runtime resource is forbidden: ${reference}`);
  }

  const withoutSuffix = reference.split(/[?#]/, 1)[0];
  const resolved = path.resolve(entryDirectory, decodeURIComponent(withoutSuffix));
  const relative = path.relative(packageDirectory, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Runtime resource leaves the production package: ${reference}`);
  }
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Referenced runtime resource does not exist: ${reference}`);
  }
  if (/\.tsx?(?:[?#]|$)/i.test(reference)) {
    throw new Error(`Production package references TypeScript source: ${reference}`);
  }

  return resolved;
}

export function validateOfflinePackage(packageDirectory = DEFAULT_PACKAGE_DIRECTORY) {
  const root = path.resolve(packageDirectory);
  const entry = path.join(root, 'index.html');
  if (!fs.statSync(entry, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Offline entry is missing: ${entry}`);
  }

  const html = fs.readFileSync(entry, 'utf8');
  const document = new JSDOM(html).window.document;
  if (!document.querySelector('#root')) throw new Error('Offline entry is missing #root');
  if (document.querySelector('script[type="module"]')) {
    throw new Error('Offline entry must not use native ES module scripts');
  }
  if ([...document.scripts].some((script) => !script.src && script.textContent?.trim())) {
    throw new Error('Application JavaScript must be external, not inline');
  }
  if (/\b(?:https?:)?\/\//i.test(html)) {
    throw new Error('Offline entry contains an HTTP/HTTPS or protocol-relative URL');
  }

  const referenced = new Set();
  for (const [selector, attribute] of resourceSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      const reference = element.getAttribute(attribute);
      if (reference) referenced.add(assertPortableResource(reference, path.dirname(entry), root));
    }
  }

  const scripts = [...document.querySelectorAll('script[src]')];
  if (scripts.length === 0 || !scripts.some((script) => script.getAttribute('src')?.match(/\.js(?:[?#]|$)/i))) {
    throw new Error('Offline entry must reference at least one local JavaScript file');
  }
  if (!scripts.every((script) => script.hasAttribute('defer'))) {
    throw new Error('Classic production scripts must be deferred');
  }

  const cssFiles = walkFiles(root).filter((file) => file.endsWith('.css'));
  for (const cssFile of cssFiles) {
    if (/\b(?:https?:)?\/\//i.test(fs.readFileSync(cssFile, 'utf8'))) {
      throw new Error(`Stylesheet contains a remote URL: ${path.relative(root, cssFile)}`);
    }
  }

  const jsFiles = walkFiles(root).filter((file) => file.endsWith('.js'));
  if (jsFiles.length === 0 || !jsFiles.some((file) => referenced.has(file))) {
    throw new Error('Production package has no referenced external JavaScript bundle');
  }

  return { entry, files: walkFiles(root) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateOfflinePackage();
  console.log(`Offline package verified (${result.files.length} files): ${path.dirname(result.entry)}`);
}
