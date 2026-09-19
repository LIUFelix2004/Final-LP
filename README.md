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
- **V4 pools**: Fee rate shown when DexScreener indexes them and on-chain read succeeds; otherwise "—"
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
- V4 pools appear only when DexScreener returns them with `labels: ["v4"]`; as of Sep 2026 DexScreener may not index V4 pools on BSC or Robinhood yet
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
| 费率 | Pool fee rate %. V2: fixed. V3/CL: from on-chain RPC. |
| Fee (24h)* | **Estimated** 24h fees = Volume x fee rate |
| TVL | Total value locked (from DexScreener) |
| Fee/TVL | Estimated Fee / TVL ratio % |
| Volume (24h) | 24h trading volume (from DexScreener) |
| 交易数 | Trade count in 24h |
| 操作 | Copy pool address, open block explorer |

## Features
- Chain switcher (BSC / Robinhood)
- Sort by any numeric column (default: Fee descending)
- Hide low-TVL pools (<$1K toggle)
- Auto-refresh every 30s + manual refresh button
- Stale-while-revalidate (failed refresh keeps previous data)
- Error/retry bar on fetch failure
- Last update timestamp display
- Copy pool address to clipboard
- Block explorer links
- On-chain V3 fee tier enrichment via RPC

## Scripts

```bash
npm run dev      # Dev server
npm run build    # Production build
npm run preview  # Preview production build
npm test         # Run tests (74 tests)
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
