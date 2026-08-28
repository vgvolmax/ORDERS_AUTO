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
  throw new Error('Build still contains an ES module script and will not start reliably via file://');
}

if (!/<script(?:\s[^>]*)?>[\s\S]+<\/script>/i.test(html)) {
  throw new Error('Build does not contain an inlined executable script');
}

console.log('Single-file offline artifact verified');
