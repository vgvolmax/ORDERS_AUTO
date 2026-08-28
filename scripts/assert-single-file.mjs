import fs from 'node:fs';

const files = fs.readdirSync('dist');
if (files.length !== 1 || files[0] !== 'index.html') {
  throw new Error(`Expected only dist/index.html, got: ${files.join(', ')}`);
}

const html = fs.readFileSync('dist/index.html', 'utf8');
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet/i.test(html)) {
  throw new Error('Build is not self-contained');
}

if (/<script[^>]+type=["']module["']/i.test(html)) {
  throw new Error(
    'Build still contains an ES module script and will not start reliably via file://',
  );
}

// The root may intentionally contain a static startup fallback. Verify the
// actual opening root element rather than requiring an empty <div>.
const rootMatch = html.match(/<div\s+id=["']root["'][^>]*>/i);
const rootIndex = rootMatch?.index ?? -1;
const scriptIndex = html.lastIndexOf('<script>');
if (rootIndex === -1 || scriptIndex === -1 || scriptIndex < rootIndex) {
  throw new Error(
    'Offline script must be inlined after #root so classic execution can start safely',
  );
}

console.log('Single-file offline artifact verified');
