import fs from 'node:fs';
import path from 'node:path';

const packageDirectory = path.resolve('dist/ORDERS_AUTO');
const source = path.resolve('src/production.html');
const target = path.join(packageDirectory, 'index.html');

if (!fs.existsSync(packageDirectory)) {
  throw new Error('Vite output directory is missing');
}

fs.copyFileSync(source, target);
console.log(`Assembled offline entry: ${path.relative(process.cwd(), target)}`);
