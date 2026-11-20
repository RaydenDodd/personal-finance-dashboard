import { ADP_COMPANION_ID } from '@bt/shared/types/adp-companion';

export type AdpPayrollRecord = Record<string, unknown> & { statementId: string };
type Message = Record<string, unknown>;
interface EventHook<T> {
  addListener(listener: (value: T) => void): void;
}
interface CompanionPort {
  onMessage: EventHook<Message>;
  onDisconnect: EventHook<void>;
  postMessage(message: Message): void;
  disconnect(): void;
}
interface CompanionRuntime {
  connect(id: string, options: { name: string }): CompanionPort;
  lastError?: unknown;
}
export class AdpCompanionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Uses the browser's pinned extension channel; no localhost listener, public API exception or ADP tokens. */
export function startAdpCompanion(status: (phase: string) => void) {
  const runtime = (window as Window & { chrome?: { runtime?: CompanionRuntime } }).chrome?.runtime;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) => v.toString(16).padStart(2, '0')).join('');
  let port: CompanionPort | undefined,
    settled = false,
    rejectJob: (error: Error) => void = () => {},
    timer: ReturnType<typeof setTimeout>;
  const result = new Promise<AdpPayrollRecord[]>((resolve, reject) => {
    rejectJob = reject;
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port?.disconnect();
      reject(new AdpCompanionError(code));
    };
    if (!runtime) {
      fail('setup-required');
      return;
    }
    let chunks: Uint8Array[] = [],
      parts = 0,
      bytes = 0,
      count = 0;
    timer = setTimeout(() => fail('timeout'), 900_000);
    try {
      port = runtime.connect(ADP_COMPANION_ID, { name: 'moneymatter-adp-sync' });
      port.onDisconnect.addListener(() => {
        void runtime.lastError;
        fail('helper-unavailable');
      });
      port.onMessage.addListener((message) => {
        if (settled) return;
        if (message.type === 'error') {
          fail(typeof message.code === 'string' ? message.code : 'export-failed');
          return;
        }
        if (message.nonce !== nonce) {
          fail('invalid-response');
          return;
        }
        if (message.type === 'status') {
          if (message.phase === 'sign-in' || message.phase === 'collecting') status(message.phase);
          return;
        }
        if (message.type === 'begin') {
          if (
            parts ||
            !Number.isInteger(message.parts) ||
            Number(message.parts) < 1 ||
            Number(message.parts) > 64 ||
            !Number.isInteger(message.bytes) ||
            Number(message.bytes) > 8_000_000 ||
            Number(message.bytes) < 2 ||
            !Number.isInteger(message.count) ||
            Number(message.count) < 1 ||
            Number(message.count) > 500
          ) {
            fail('invalid-response');
            return;
          }
          parts = Number(message.parts);
          bytes = Number(message.bytes);
          count = Number(message.count);
          return;
        }
        if (message.type === 'chunk') {
          if (
            !parts ||
            message.index !== chunks.length ||
            chunks.length >= parts ||
            typeof message.data !== 'string' ||
            message.data.length > 262144 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)
          ) {
            fail('invalid-response');
            return;
          }
          try {
            chunks.push(Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0)));
          } catch {
            fail('invalid-response');
          }
          return;
        }
        if (message.type === 'complete') {
          if (chunks.length !== parts || chunks.reduce((n, v) => n + v.length, 0) !== bytes) {
            fail('invalid-response');
            return;
          }
          try {
            const buffer = new Uint8Array(bytes);
            let offset = 0;
            for (const chunk of chunks) {
              buffer.set(chunk, offset);
              offset += chunk.length;
            }
            const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
            if (
              !Array.isArray(payload.payStatements) ||
              payload.payStatements.length !== count ||
              payload.expectedStatements !== count ||
              payload.downloadedStatements !== count ||
              !Array.isArray(payload.failures) ||
              payload.failures.length ||
              payload.payStatements.some((row: Message) => typeof row.statementId !== 'string')
            )
              throw Error();
            settled = true;
            clearTimeout(timer);
            port?.disconnect();
            chunks = [];
            resolve(payload.payStatements);
          } catch {
            fail('invalid-response');
          }
        }
      });
      port.postMessage({ type: 'start', nonce });
    } catch {
      fail('setup-required');
    }
  });
  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port?.disconnect();
      rejectJob(new AdpCompanionError('cancelled'));
    },
  };
}
