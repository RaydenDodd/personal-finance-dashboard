import fs from 'node:fs/promises';

import { runInteractiveAdpSync } from '../lib/adp-interactive-sync.mjs';

const config = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8'));
if (process.argv[2] !== `chrome-extension://${config.extensionId}/`) process.exit(1);
delete process.env.DEBUG;
delete process.env.PWDEBUG;
delete process.env.DEBUG_FILE;
const { chromium } = await import('playwright-core');
const controller = new AbortController();
let buffer = Buffer.alloc(0),
  started = false,
  nonce,
  closed = false;
const send = (message) => {
  if (closed || process.stdout.destroyed) return;
  const body = Buffer.from(JSON.stringify({ ...message, nonce })),
    header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
};
const stop = () => {
  closed = true;
  clearTimeout(deadline);
  controller.abort();
  process.stdin.destroy();
};
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.on('error', stop);
process.stdout.on('error', stop);
const deadline = setTimeout(stop, 900_000);
async function sync(message) {
  if (started || message?.type !== 'start' || !/^[a-f0-9]{32}$/.test(message.nonce ?? '')) {
    stop();
    return;
  }
  started = true;
  nonce = message.nonce;
  try {
    const result = await runInteractiveAdpSync({
      chromium,
      signal: controller.signal,
      status: (phase, progress) => send({ type: 'status', phase, ...progress }),
    });
    if (controller.signal.aborted) return;
    // Only payroll JSON crosses the native bridge. No browser session state or files are exported.
    const bytes = Buffer.from(JSON.stringify(result));
    if (bytes.length > 8_000_000) throw new Error('Payload too large');
    const parts = Math.ceil(bytes.length / 196608);
    send({ type: 'begin', parts, bytes: bytes.length, count: result.payStatements.length });
    for (let i = 0; i < parts; i++)
      send({ type: 'chunk', index: i, data: bytes.subarray(i * 196608, (i + 1) * 196608).toString('base64') });
    send({ type: 'complete' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code =
      controller.signal.aborted || message === 'Cancelled'
        ? 'cancelled'
        : /timed out/.test(message)
          ? 'timeout'
          : /^ADP returned HTTP (401|403|429)/.test(message)
            ? 'access-stopped'
            : 'export-failed';
    send({ type: 'error', code });
  } finally {
    clearTimeout(deadline);
    process.stdin.destroy();
  }
}
process.stdin.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (size < 2 || size > 4096) {
      stop();
      process.stdin.pause();
      return;
    }
    if (buffer.length < size + 4) return;
    let value;
    try {
      value = JSON.parse(buffer.subarray(4, size + 4).toString('utf8'));
    } catch {
      stop();
      return;
    }
    buffer = buffer.subarray(size + 4);
    void sync(value);
  }
});
