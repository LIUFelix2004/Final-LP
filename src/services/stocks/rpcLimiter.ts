export const MAX_CONCURRENCY = 4;
export const BASE_RATE_PER_SECOND = 5;
const DEGRADED_RATE_PER_SECOND = 3;
const DEGRADED_DURATION_MS = 30_000;

let tokenIntervalMs = 1000 / BASE_RATE_PER_SECOND; // 200ms
let inFlight = 0;
const waiters: Array<() => void> = [];

let nextAllowedAt = 0;
let degradedUntil = 0;

export function is429(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('429') || msg.includes('Too Many') || msg.includes('Failed to fetch') || msg.includes('CORS');
}

function onThrottle(): void {
  const now = Date.now();
  nextAllowedAt = Math.max(nextAllowedAt, now + 1000);
  degradedUntil = now + DEGRADED_DURATION_MS;
  tokenIntervalMs = 1000 / DEGRADED_RATE_PER_SECOND;
}

function checkRecovery(): void {
  if (degradedUntil > 0 && Date.now() >= degradedUntil) {
    degradedUntil = 0;
    tokenIntervalMs = 1000 / BASE_RATE_PER_SECOND;
  }
}

async function acquireSlot(): Promise<void> {
  while (inFlight >= MAX_CONCURRENCY) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  inFlight++;

  checkRecovery();
  const now = Date.now();
  const slot = Math.max(now, nextAllowedAt);
  nextAllowedAt = slot + tokenIntervalMs;
  const waitMs = slot - now;
  if (waitMs > 0) {
    await new Promise(r => setTimeout(r, waitMs));
  }
}

function releaseSlot(): void {
  inFlight--;
  if (waiters.length > 0) {
    waiters.shift()!();
  }
}

export function _resetForTest(): void {
  tokenIntervalMs = 1000 / BASE_RATE_PER_SECOND;
  inFlight = 0;
  waiters.length = 0;
  nextAllowedAt = 0;
  degradedUntil = 0;
}

export async function rpcThrottled<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquireSlot();
    try {
      const result = await fn();
      releaseSlot();
      return result;
    } catch (err) {
      releaseSlot();
      if (is429(err)) {
        onThrottle();
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
      }
      throw err;
    }
  }
  throw new Error('rpc retries exhausted');
}
