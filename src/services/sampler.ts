interface Sample {
  t: number;
  volM5: number;
}

export interface Estimate15m {
  value: number | null;
  bucketsFilled: number;
}

const FIVE_MIN = 5 * 60 * 1000;
const MAX_POOLS = 200;
const MAX_SAMPLES = 30;
const SESSION_KEY = 'lp-sampler-v1';

export class VolumeSampler {
  private buffers = new Map<string, Sample[]>();

  constructor() {
    this.restore();
  }

  record(pairAddress: string, chainId: number, volM5: number): void {
    if (volM5 <= 0) return;
    const key = `${chainId}:${pairAddress}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      if (this.buffers.size >= MAX_POOLS) {
        const oldest = this.buffers.keys().next().value;
        if (oldest !== undefined) this.buffers.delete(oldest);
      }
      buf = [];
      this.buffers.set(key, buf);
    }
    const now = Date.now();
    if (buf.length > 0 && now - buf[buf.length - 1].t < 20_000) return;
    buf.push({ t: now, volM5 });
    if (buf.length > MAX_SAMPLES) buf.shift();
  }

  estimate15m(pairAddress: string, chainId: number): Estimate15m {
    const key = `${chainId}:${pairAddress}`;
    const buf = this.buffers.get(key);
    if (!buf || buf.length === 0) return { value: null, bucketsFilled: 0 };

    const now = Date.now();
    const buckets = [
      { start: now - 3 * FIVE_MIN, end: now - 2 * FIVE_MIN },
      { start: now - 2 * FIVE_MIN, end: now - FIVE_MIN },
      { start: now - FIVE_MIN, end: now + 60_000 },
    ];

    let sum = 0;
    let filled = 0;

    for (const bucket of buckets) {
      let best: Sample | null = null;
      for (const s of buf) {
        if (s.t >= bucket.start && s.t < bucket.end) {
          if (!best || s.t > best.t) best = s;
        }
      }
      if (best) {
        sum += best.volM5;
        filled++;
      }
    }

    if (filled === 0) return { value: null, bucketsFilled: 0 };
    if (filled < 3) {
      return { value: (sum / filled) * 3, bucketsFilled: filled };
    }
    return { value: sum, bucketsFilled: filled };
  }

  recordBatch(pools: Array<{ pairAddress: string; chainId: number; volM5: number }>): void {
    for (const p of pools) {
      this.record(p.pairAddress, p.chainId, p.volM5);
    }
    this.persist();
  }

  clearChain(chainId: number): void {
    for (const key of [...this.buffers.keys()]) {
      if (key.startsWith(`${chainId}:`)) {
        this.buffers.delete(key);
      }
    }
  }

  private persist(): void {
    try {
      const data: Record<string, Sample[]> = {};
      for (const [k, v] of this.buffers) {
        data[k] = v;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      // quota exceeded or unavailable
    }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, Sample[]>;
      const cutoff = Date.now() - 20 * 60 * 1000;
      for (const [k, samples] of Object.entries(data)) {
        const valid = samples.filter((s) => s.t > cutoff);
        if (valid.length > 0) this.buffers.set(k, valid);
      }
    } catch {
      // corrupted or unavailable
    }
  }
}
