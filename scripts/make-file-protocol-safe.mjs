import fs from 'node:fs';

const path = 'dist/index.html';
const html = fs.readFileSync(path, 'utf8');

const moduleScriptPattern = /<script\s+type=["']module["'](?:\s+crossorigin)?\s*>/i;
if (!moduleScriptPattern.test(html)) {
  throw new Error('Expected one inlined module script before file:// post-processing');
}

const offlineHtml = html.replace(moduleScriptPattern, '<script>');
fs.writeFileSync(path, offlineHtml, 'utf8');

console.log('Converted inlined bundle to a classic script for file:// startup');
