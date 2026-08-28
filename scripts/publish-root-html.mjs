import fs from 'node:fs';
import { findSingleBuiltHtml } from './built-html.mjs';

const source = findSingleBuiltHtml();
const target = 'ORDERS_AUTO.html';

fs.copyFileSync(source, target);
console.log(`Published ${target} from ${source}`);
