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

export async function rpcThrottled<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  // Acquire concurrency slot first (before rate-limit wait)
  while (inFlight >= MAX_CONCURRENCY) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  inFlight++;

  try {
    // Rate limit: reserve a time slot (serialized by design)
    const now = Date.now();
    if (nextAllowedAt > now) {
      await new Promise(r => setTimeout(r, nextAllowedAt - now));
    }
    nextAllowedAt = Math.max(Date.now(), nextAllowedAt) + TOKEN_INTERVAL_MS;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (is429(err) && attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error('rpc retries exhausted');
  } finally {
    inFlight--;
    if (waiters.length > 0) {
      waiters.shift()!();
    }
  }
}
