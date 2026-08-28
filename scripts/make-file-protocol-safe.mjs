import fs from 'node:fs';
import { findSingleBuiltHtml } from './built-html.mjs';

const path = findSingleBuiltHtml();
const html = fs.readFileSync(path, 'utf8');

// Do not extract or move the inline JavaScript body.
// SheetJS legitimately contains HTML-looking text such as </script> and
// </body> inside its parser/export implementation. Touch only the opening tag.
const moduleScriptOpenPattern = /<script\b[^>]*\btype=["']module["'][^>]*>/i;
const match = html.match(moduleScriptOpenPattern);

if (!match) {
  throw new Error('Expected one inlined module script before file:// post-processing');
}

const offlineHtml = html.replace(moduleScriptOpenPattern, '<script>');
fs.writeFileSync(path, offlineHtml, 'utf8');

console.log(`Converted ${path} to a classic inline script for file:// startup`);
