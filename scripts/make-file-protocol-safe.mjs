import fs from 'node:fs';

const path = 'dist/index.html';
const html = fs.readFileSync(path, 'utf8');

const moduleScriptPattern = /<script\s+type=["']module["'](?:\s+crossorigin)?\s*>([\s\S]*?)<\/script>/i;
const match = html.match(moduleScriptPattern);
if (!match) {
  throw new Error('Expected one inlined module script before file:// post-processing');
}

const scriptBody = match[1];
const withoutModuleScript = html.replace(moduleScriptPattern, '');
if (!/<\/body>/i.test(withoutModuleScript)) {
  throw new Error('Cannot place offline script because </body> was not found');
}

// Module scripts are deferred automatically; classic inline scripts are not.
// Move the bundle to the end of <body> so React sees #root before startup.
const offlineHtml = withoutModuleScript.replace(
  /<\/body>/i,
  `<script>${scriptBody}</script>\n  </body>`,
);

fs.writeFileSync(path, offlineHtml, 'utf8');

console.log('Converted bundle to a classic script placed after #root for file:// startup');
