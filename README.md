# LP Fee Leaderboard (实时榜单)

A dark-mode real-time LP fee leaderboard for hunting high-fee liquidity pools across chains.

**Requires Node.js >= 22** (vitest/jsdom need it).

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_BSC_RPC` | `https://bsc-dataseed1.binance.org` | BSC RPC endpoint (used for on-chain V3 fee reads) |
| `VITE_ROBINHOOD_RPC` | `https://rpc.mainnet.chain.robinhood.com` | Robinhood Chain RPC endpoint |

Copy `.env.example` to `.env` and customize if needed. RPC endpoints are used both for on-chain fee-tier reads (V3/CL pools) and as public fallbacks.

## Supported Chains

### BSC (Chain ID: 56)
- **PancakeSwap** V2, V3
- **Uniswap** V2, V3, V4

### Robinhood Chain (Chain ID: 4663)
- **UP33** V2 (Solidly fork), CL (Slipstream/concentrated liquidity)
- **Uniswap** V2, V3, V4

## Data Sources

### Pool Discovery
Pool data is sourced from **DexScreener API** using three complementary strategies:
1. **Token-based** (`/latest/dex/tokens/{addr}`): discovers pools by known native/stablecoin tokens per chain — BSC: WBNB, USDT, USDC; Robinhood: WETH, USDG, VIRTUAL, UP
2. **Search-based** (`/latest/dex/search?q=...`): keyword queries for major pairs to surface additional V3/V4 pools
3. **Seed pools** (`/latest/dex/pairs/{chain}/{addr,...}`): known high-liquidity V3 pool addresses fetched directly to guarantee minimum V3 coverage
- Results are deduplicated by pair address and merged across all strategies
- Returns 24h volume, TVL (liquidity), transaction counts, and price data
- Sequential requests with 200ms throttle + retry with exponential backoff on 429/5xx

### Version Detection
Pool version (V2/V3/V4) is detected from DexScreener's `labels` array (e.g. `["v2"]`, `["v3"]`, `["CL"]`, `["CLMM"]`), with fallback to `dexId` string heuristics. This ensures concentrated liquidity pools are correctly tagged as V3 for on-chain fee enrichment.

### Seed V3 Pool Addresses
BSC:
- PancakeSwap V3 USDT/WBNB: `0x36696169C63e42cd08ce11f5deeBbCeBae652050`
- Uniswap V3 USDT/WBNB: `0x6fe9E9de56356F7eDBfcBB29FAB7cd69471a4869`

Robinhood:
- Uniswap V3 WETH/USDG: `0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a`
- Uniswap V3 WETH/PONS: `0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA`

### Fee Rate Sources
- **V2 pools**: Fixed fee rate from dexId (PancakeSwap 0.25%, Uniswap/others 0.30%, BiSwap 0.10%)
- **V3 pools**: On-chain `fee()` call via RPC multicall (Uniswap V3 returns fee in hundredths of bip, e.g. 3000 = 0.30%)
- **UP33 CL (Slipstream)**: On-chain `tickSpacing()` on pool + `tickSpacingToFee(ts)` on factory via RPC
- **V4 pools**: On-chain `extsload` on PoolManager reads `lpFee` from pool slot0. Static-fee pools show numeric rate; dynamic-fee hook pools (flag >= 0x800000) show ⚡ with tooltip. Falls back to "—" when poolId doesn't match pairAddress or RPC fails.
- Fallback: "—" when RPC is unreachable or fee cannot be determined

### Fee Estimation Formula
```
Fee (24h) = 24h Volume x (Fee Rate / 100)
```
This is an **estimate** — actual collected fees may differ due to MEV, concentrated liquidity tick ranges, and protocol fee switches. Labeled as "Fee (24h)*" in the UI with a tooltip.

### Fee/TVL Ratio
```
Fee/TVL = (Fee USD / TVL) x 100  (as percentage)
```

## Error Handling
- **Retry with backoff**: 429 and 5xx responses retry up to 3 times (1s, 2s, 4s delay)
- **Stale-while-revalidate**: Auto-refresh failures preserve the previous good data; only manual refresh clears stale data
- **Partial success**: If some token fetches fail, surviving results are shown with a warning
- **Total failure**: Error bar with retry button; empty state distinguishes "fetch failed" from "zero pools on chain"

### Known Gaps
- **V4 fee reads**: V4 pool fees are read from PoolManager via `extsload` using the pairAddress as poolId (best-effort). This works when DexScreener's pairAddress matches the actual V4 poolId. Pools with dynamic-fee hooks (fee flag >= 0x800000) show a lightning bolt icon with tooltip "V4 dynamic hook fee". V4 pools where the fee can't be determined show "—".
- V4 pools appear only when DexScreener returns them with `labels: ["v4"]`; DexScreener V4 indexing coverage varies by chain
- UP33 pools on Robinhood are matched from DexScreener dexIds `up`, `up_*`, `up33`, `aerodrome`, and `velodrome`
- On-chain fee reads fail silently if RPC is down — those pools show "—" for fee rate and estimated fee
- Trade count is buys + sells from DexScreener 24h window
- Data auto-refreshes every 30 seconds

## Columns

| Column | Description |
|---|---|
| # | Rank (gold/silver/bronze for top 3) |
| 交易对 | DEX tag + version (V2/V3/V4) + pair symbol |
| 价格 | USD price (many decimals for meme tokens) |
| 费率 | Pool fee rate %. V2: fixed. V3/CL: on-chain RPC fee(). V4: PoolManager extsload. ⚡ = dynamic hook fee. |
| Fee (24h)* | **Estimated** 24h fees = Volume x fee rate |
| TVL | Total value locked (from DexScreener) |
| Fee/TVL | Estimated Fee / TVL ratio % |
| Volume (24h) | 24h trading volume (from DexScreener) |
| 交易数 | Trade count in 24h |
| 操作 | Copy pool address, open block explorer |

## Timeframe Windows

The leaderboard supports multiple time windows for volume, fee, and tx metrics:

| Window | Source | Notes |
|---|---|---|
| **5m** | DexScreener `volume.m5`, `txns.m5` | Native rolling 5-minute window |
| **15m≈** | Local sampling | Approximate: sums 3 non-overlapping m5 readings spaced ~5 min apart from a ring buffer. Shows partial/extrapolated estimates when warming up (<15 min of data). Not a DexScreener native window. |
| **1h** | DexScreener `volume.h1`, `txns.h1` | Native rolling 1-hour window |
| **6h** | DexScreener `volume.h6`, `txns.h6` | Native rolling 6-hour window |
| **24h** | DexScreener `volume.h24`, `txns.h24` | Native rolling 24-hour window (default) |

Switching windows recomputes Fee, Fee/TVL, and Volume from already-fetched data — no additional API calls. The 15m sampler collects m5 snapshots on each 30s refresh and persists to `sessionStorage` so a page refresh doesn't always cold-start.

### 15m Sampler Limitations
- Requires ~15 minutes of page-open time for a full estimate; before that, values are extrapolated from fewer buckets
- Accuracy depends on DexScreener's m5 rolling window aligning with the sample timestamps
- Meme token spikes within a single 5m bucket may be under/over-counted depending on timing
- Caps at 200 tracked pools; only pools visible in the current table are sampled

## Features
- Chain switcher (BSC / Robinhood)
- Timeframe switcher (5m / 15m≈ / 1h / 6h / 24h)
- Sort by any numeric column (default: Fee descending for active window)
- Hide low-TVL pools (<$1K toggle)
- Auto-refresh every 30s + manual refresh button
- Stale-while-revalidate (failed refresh keeps previous data)
- Error/retry bar on fetch failure
- Last update timestamp display
- Copy pool address to clipboard
- Block explorer links
- On-chain V3/V4 fee tier enrichment via RPC (V3: pool.fee(), V4: PoolManager.extsload)

## GMGN Mode (Dev Only)

GMGN 土狗 discovery mode requires the Vite dev proxy (`npm run dev`) — it proxies two routes:

- `/api/gmgn` → `openapi.gmgn.ai` (primary, injects `X-APIKEY` header + per-request `client_id` + `timestamp`)
- `/api/gmgnq` → `gmgn.ai/defi/quotation/v1` (fallback with browser-like headers)

Set `GMGN_API_KEY` in `.env` (see `.env.example`). Without it the GMGN toggle is hidden. The proxy is **not** available in production builds — GMGN mode is dev-only.

For users behind a firewall (e.g. Clash/Verge in CN), set `HTTPS_PROXY=http://127.0.0.1:7897` in `.env`. The proxy uses undici `ProxyAgent` to route GMGN requests through the configured HTTP proxy.

## Scripts

```bash
npm run dev      # Dev server
npm run build    # Production build
npm run preview  # Preview production build
npm test         # Run tests (93 tests)
```

## Tech Stack
- Vite + React 19 + TypeScript 6
- [viem](https://viem.sh) for on-chain RPC reads (multicall for V3 fee tiers)
- DexScreener REST API for pool discovery + market data
- No wallet connection required (read-only leaderboard)

## Contract Addresses (Reference)

BSC:
- PancakeSwap V2 Factory: `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`
- PancakeSwap V3 Factory: `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`
- Uniswap V2 Factory: `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`
- Uniswap V3 Factory: `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7`
- Uniswap V4 PoolManager: `0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF`

Robinhood:
- UP33 V2 Factory: `0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28`
- UP33 CL Factory: `0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3`
- Uniswap V2 Factory: `0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f`
- Uniswap V3 Factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- Uniswap V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
