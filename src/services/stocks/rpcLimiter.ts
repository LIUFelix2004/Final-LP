const MAX_CONCURRENCY = 4;
const MAX_PER_SECOND = 8;
const TOKEN_INTERVAL_MS = 1000 / MAX_PER_SECOND; // 125ms between calls

let inFlight = 0;
const waiters: Array<() => void> = [];

let nextAllowedAt = 0;

function is429(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('429') || msg.includes('Too Many') || msg.includes('Failed to fetch') || msg.includes('CORS');
}

async function acquireSlot(): Promise<void> {
  while (inFlight >= MAX_CONCURRENCY) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  inFlight++;

  const now = Date.now();
  const slot = Math.max(now, nextAllowedAt);
  nextAllowedAt = slot + TOKEN_INTERVAL_MS;
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

export async function rpcThrottled<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquireSlot();
    try {
      const result = await fn();
      releaseSlot();
      return result;
    } catch (err) {
      releaseSlot();
      if (is429(err) && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('rpc retries exhausted');
}
