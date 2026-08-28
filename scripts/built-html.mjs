import fs from 'node:fs';
import path from 'node:path';

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

export function listBuiltFiles() {
  if (!fs.existsSync('dist')) return [];
  return walkFiles('dist');
}

export function findSingleBuiltHtml() {
  const htmlFiles = listBuiltFiles().filter((file) => file.toLowerCase().endsWith('.html'));
  if (htmlFiles.length !== 1) {
    throw new Error(`Expected exactly one built HTML file, got: ${htmlFiles.join(', ') || 'none'}`);
  }
  return htmlFiles[0];
}
