import fs from 'node:fs';

const path = 'dist/index.html';
const html = fs.readFileSync(path, 'utf8');

// Do not extract or move the inline JavaScript body.
//
// SheetJS legitimately contains HTML-looking text such as </script> and
// </body> inside its parser/export implementation. A previous postprocessor
// matched the whole script with a regex and then searched the remaining HTML
// for </body>; those strings made it split the JavaScript bundle and produced
// an invalid regular expression in Chrome.
//
// Vite already places the inlined entry after #root. For file:// startup we
// only need to make that one inline entry a classic script. Replacing the
// opening tag is intentionally bounded to the tag itself, so bundle bytes are
// left untouched.
const moduleScriptOpenPattern = /<script\b[^>]*\btype=["']module["'][^>]*>/i;
const match = html.match(moduleScriptOpenPattern);

if (!match) {
  throw new Error('Expected one inlined module script before file:// post-processing');
}

const offlineHtml = html.replace(moduleScriptOpenPattern, '<script>');
fs.writeFileSync(path, offlineHtml, 'utf8');

console.log('Converted inline module tag to a classic script without rewriting bundle contents');
