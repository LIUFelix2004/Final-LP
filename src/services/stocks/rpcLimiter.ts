const MAX_CONCURRENCY = 4;
const MAX_PER_SECOND = 8;
const TOKEN_BUCKET_REFILL_INTERVAL = 1000 / MAX_PER_SECOND; // 125ms per token

let inFlight = 0;
const waiters: Array<() => void> = [];

let tokens = MAX_CONCURRENCY;
let lastRefill = Date.now();

function refillTokens(): void {
  const now = Date.now();
  const elapsed = now - lastRefill;
  const newTokens = elapsed / TOKEN_BUCKET_REFILL_INTERVAL;
  tokens = Math.min(MAX_PER_SECOND, tokens + newTokens);
  lastRefill = now;
}

function is429(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('429') || msg.includes('Too Many') || msg.includes('Failed to fetch') || msg.includes('CORS');
}

export async function rpcThrottled<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  while (inFlight >= MAX_CONCURRENCY) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }

  refillTokens();
  if (tokens < 1) {
    const waitMs = (1 - tokens) * TOKEN_BUCKET_REFILL_INTERVAL;
    await new Promise(r => setTimeout(r, waitMs));
    tokens = 0;
    lastRefill = Date.now();
  } else {
    tokens -= 1;
  }

  inFlight++;
  try {
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
