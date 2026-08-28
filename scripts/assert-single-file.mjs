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

// The root may intentionally contain a static startup fallback.
if (!/<div\s+id=["']root["'][^>]*>/i.test(html)) {
  throw new Error('Offline build is missing #root');
}

// The file-safe postprocessor only changes the opening module tag. The classic
// script may remain in <head>; main.tsx explicitly waits for DOMContentLoaded
// before mounting, so script ordering is no longer part of the build contract.
if (!/<script>/i.test(html)) {
  throw new Error('Offline build is missing the inlined classic application script');
}

console.log('Single-file offline artifact verified');
