import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
let connect;
const natives = [];
function port(sender, name = 'moneymatter-adp-sync') {
  const messages = [],
    hooks = {};
  return {
    sender,
    name,
    messages,
    hooks,
    onMessage: { addListener: (fn) => (hooks.message = fn) },
    onDisconnect: { addListener: (fn) => (hooks.disconnect = fn) },
    postMessage: (value) => messages.push(value),
    disconnect: () => hooks.disconnect?.(),
  };
}
globalThis.chrome = {
  runtime: {
    onConnectExternal: { addListener: (fn) => (connect = fn) },
    connectNative: (name) => {
      const native = port();
      natives.push({ name, native });
      return native;
    },
  },
};
const { trustedSender } = await import('./background.js');
const sender = { url: 'https://raydenfinance.duckdns.org/income', tab: { id: 4 }, frameId: 0 };
test('only the pinned owner origin and top-level frame can start native messaging', async () => {
  assert.ok(trustedSender(sender));
  for (const value of [
    { ...sender, url: 'https://evil.example' },
    { ...sender, url: 'https://raydenfinance.duckdns.org.evil.example' },
    { ...sender, frameId: 1 },
    { ...sender, tab: undefined },
  ])
    assert.ok(!trustedSender(value));
  const manifest = JSON.parse(await fs.readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['nativeMessaging']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.externally_connectable.matches, ['https://raydenfinance.duckdns.org/*']);
});
test('a simultaneous start is rejected, payroll packets are forwarded, and disconnect cancels the host', () => {
  const a = port(sender),
    b = port(sender);
  connect(a);
  connect(b);
  a.hooks.message({ type: 'start', nonce: 'a'.repeat(32) });
  b.hooks.message({ type: 'start', nonce: 'b'.repeat(32) });
  assert.equal(natives.length, 1);
  assert.deepEqual(b.messages, [{ type: 'error', code: 'busy' }]);
  const native = natives[0].native;
  assert.equal(natives[0].name, 'com.moneymatter.adp_companion');
  native.hooks.message({ type: 'complete', nonce: 'a'.repeat(32) });
  assert.equal(a.messages[0].type, 'complete');
  let cancelled = false;
  native.disconnect = () => {
    cancelled = true;
  };
  a.disconnect();
  assert.ok(cancelled);
  const c = port(sender);
  connect(c);
  c.hooks.message({ type: 'start', nonce: 'c'.repeat(32) });
  assert.equal(natives.length, 2);
  c.disconnect();
});
