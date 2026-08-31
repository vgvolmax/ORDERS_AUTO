import fs from 'node:fs';
import { findSingleBuiltHtml } from './built-html.mjs';
import { makeInlineApplicationScriptSafe } from './inline-script.mjs';

const path = findSingleBuiltHtml();
const html = fs.readFileSync(path, 'utf8');

// SheetJS legitimately carries HTML closing tags as JavaScript string values.
// Escape those values inside the payload, while retaining the real HTML tag.
const offlineHtml = makeInlineApplicationScriptSafe(html);
fs.writeFileSync(path, offlineHtml, 'utf8');

console.log(`Converted ${path} to a classic inline script for file:// startup`);
