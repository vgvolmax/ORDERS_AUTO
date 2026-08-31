import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { findSingleBuiltHtml, listBuiltFiles } from './built-html.mjs';
import { inspectInlineApplicationScript } from './inline-script.mjs';

const builtFiles = listBuiltFiles();
if (builtFiles.length !== 1) {
  throw new Error(`Expected one production file in dist, got: ${builtFiles.join(', ')}`);
}

const builtHtmlPath = findSingleBuiltHtml();
const html = fs.readFileSync(builtHtmlPath, 'utf8');

if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet/i.test(html)) {
  throw new Error('Build is not self-contained');
}

if (/<script[^>]+type=["']module["']/i.test(html)) {
  throw new Error('Build still contains an ES module script and is unsafe for file://');
}

if (!/<div\s+id=["']root["'][^>]*>/i.test(html)) {
  throw new Error('Offline build is missing #root');
}

if (!/<script>/i.test(html)) {
  throw new Error('Offline build is missing the inlined classic application script');
}

const scriptInspection = inspectInlineApplicationScript(html);
if (scriptInspection.unsafeClosingTags.length > 0) {
  throw new Error('Inline JavaScript contains an HTML-parser-visible </script sequence');
}

const document = new JSDOM(html).window.document;
if (document.scripts.length !== 1 || document.scripts[0]?.textContent !== scriptInspection.payload) {
  throw new Error('Inline application script has invalid HTML parsing boundaries');
}

const bodyText = document.body.textContent ?? '';
if (bodyText.length > 100_000) {
  throw new Error('Parsed body contains an unexpected JavaScript text veil');
}

const rootArtifact = fs.readFileSync('ORDERS_AUTO.html', 'utf8');
if (rootArtifact !== html) {
  throw new Error('ORDERS_AUTO.html does not match the freshly built standalone artifact');
}

console.log('Single root-launchable offline artifact verified');
