import fs from 'node:fs';
import { findSingleBuiltHtml, listBuiltFiles } from './built-html.mjs';

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

const rootArtifact = fs.readFileSync('ORDERS_AUTO.html', 'utf8');
if (rootArtifact !== html) {
  throw new Error('ORDERS_AUTO.html does not match the freshly built standalone artifact');
}

console.log('Single root-launchable offline artifact verified');
