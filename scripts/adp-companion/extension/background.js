import { config } from './config.js';

export function trustedSender(sender) {
  try {
    return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && new URL(sender.url).origin === config.webOrigin;
  } catch {
    return false;
  }
}

let running = false;
chrome.runtime.onConnectExternal.addListener((port) => {
  if (!trustedSender(port.sender)) return port.disconnect();
  if (port.name === 'moneymatter-adp-probe') {
    port.postMessage({ type: 'ready', version: 1 });
    port.disconnect();
    return;
  }
  if (port.name !== 'moneymatter-adp-sync' || running) {
    port.postMessage({ type: 'error', code: 'busy' });
    port.disconnect();
    return;
  }
  let native,
    started = false,
    completed = false,
    ownsJob = false;
  const close = () => {
    const active = native;
    native = undefined;
    if (ownsJob) {
      running = false;
      ownsJob = false;
    }
    active?.disconnect();
  };
  port.onDisconnect.addListener(close);
  port.onMessage.addListener((message) => {
    if (started || message?.type !== 'start' || !/^[a-f0-9]{32}$/.test(message.nonce ?? '')) {
      close();
      port.disconnect();
      return;
    }
    if (running) {
      port.postMessage({ type: 'error', code: 'busy' });
      port.disconnect();
      return;
    }
    started = running = ownsJob = true;
    try {
      native = chrome.runtime.connectNative(config.hostName);
    } catch {
      port.postMessage({ type: 'error', code: 'helper-unavailable' });
      close();
      port.disconnect();
      return;
    }
    native.onMessage.addListener((value) => {
      if (value.type === 'complete') completed = true;
      try {
        port.postMessage(value);
      } catch {
        close();
      }
    });
    native.onDisconnect.addListener(() => {
      // Reading lastError prevents Chrome's unhandled-error log. Never forward native diagnostics or payloads.
      const failed = !!chrome.runtime.lastError;
      try {
        if (failed && !completed) port.postMessage({ type: 'error', code: 'helper-unavailable' });
        port.disconnect();
      } catch {
        /* App tab closed. */
      }
      close();
    });
    native.postMessage({ type: 'start', nonce: message.nonce });
  });
});
