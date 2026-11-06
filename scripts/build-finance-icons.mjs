import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/frontend/public');
const source = await fs.readFile(path.join(directory, 'my-finances-icon.svg'));
for (const size of [180, 192, 512]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(directory, `my-finances-${size}.png`));
}
console.log('My Finances Home Screen icons generated.');
