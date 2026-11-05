import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeNetworthSheet } from './lib/networth-sheet.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/normalize-networth-sheet.mjs INPUT_CELL_DATA.json private/networth-history.json');
const data = normalizeNetworthSheet(JSON.parse(await readFile(inputPath, 'utf8')));
await mkdir(dirname(resolve(outputPath)), {recursive: true});
await writeFile(outputPath, JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
console.log(JSON.stringify({accounts: data.accounts.length, balances: data.records.length,
  dates: new Set(data.records.map(r => r.date)).size, warnings: data.warnings}));
