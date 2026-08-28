import fs from 'node:fs';

const files = fs.readdirSync('dist');
if (files.length !== 1 || files[0] !== 'index.html') {
  throw new Error(`Expected only dist/index.html, got: ${files.join(', ')}`);
}

const html = fs.readFileSync('dist/index.html', 'utf8');
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet/i.test(html)) {
  throw new Error('Build is not self-contained');
}

console.log('Single-file artifact verified');
