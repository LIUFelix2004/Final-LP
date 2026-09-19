# LP Fee Leaderboard (实时榜单)

A dark-mode real-time LP fee leaderboard for hunting high-fee liquidity pools across chains.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_BSC_RPC` | `https://bsc-dataseed1.binance.org` | BSC RPC endpoint |
| `VITE_ROBINHOOD_RPC` | `https://rpc.robinhoodchain.com` | Robinhood Chain RPC endpoint |

Copy `.env.example` to `.env` and customize if needed.

## Supported Chains

### BSC (Chain ID: 56)
- **PancakeSwap** V2, V3
- **Uniswap** V2, V3, V4

### Robinhood Chain (Chain ID: 4663)
- **UP33** V2 (Solidly fork), CL (Slipstream/concentrated liquidity)
- **Uniswap** V2, V3, V4

## Data Sources

Pool data is sourced from **DexScreener API** (`api.dexscreener.com`):
- Token-based discovery using known stablecoins and native tokens per chain
- 24h volume, liquidity (TVL), transaction counts, and price data

### Fee Estimation
- **V2 pools**: Fee = Volume x fee rate (PancakeSwap 0.25%, Uniswap/others 0.30%)
- **V3/CL pools**: Fee rate shows "—" because V3 has variable fee tiers that DexScreener doesn't expose directly; Fee USD is therefore also "—"
- **Fee/TVL ratio**: computed as `(Fee USD / TVL) x 100`

### Known Gaps
- V3 fee tier per-pool is not available from DexScreener — would need on-chain `fee()` calls to each pool contract
- V4 pools may not appear if DexScreener hasn't indexed them yet
- UP33 pools on Robinhood may show as generic dex name if DexScreener uses a different `dexId`
- Trade count is buys + sells from DexScreener 24h window
- Data auto-refreshes every 30 seconds

## Columns

| Column | Description |
|---|---|
| # | Rank (gold/silver/bronze for top 3) |
| 交易对 | DEX tag + version (V2/V3/V4) + pair symbol |
| 价格 | USD price (many decimals for meme tokens) |
| 费率 | Pool fee rate % |
| Fee (24h) | Estimated 24h fees in USD |
| TVL | Total value locked |
| Fee/TVL | Fee-to-TVL ratio % |
| Volume (24h) | 24h trading volume |
| 交易数 | Trade count in 24h |
| 操作 | Copy address, open block explorer |

## Features
- Chain switcher (BSC / Robinhood)
- Sort by any numeric column (default: Fee descending)
- Hide low-TVL pools (<$1K toggle)
- Auto-refresh every 30s + manual refresh button
- Last update timestamp display
- Copy pool address to clipboard
- Block explorer links

## Scripts

```bash
npm run dev      # Dev server
npm run build    # Production build
npm run preview  # Preview production build
npm test         # Run tests
```

## Tech Stack
- Vite + React + TypeScript
- DexScreener REST API for pool data
- No wallet connection required (read-only leaderboard)

## Contract Addresses (Reference)

BSC:
- PancakeSwap V2 Factory: `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`
- PancakeSwap V3 Factory: `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`
- Uniswap V3 Factory: `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7`
- Uniswap V4 PoolManager: `0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF`

Robinhood:
- UP33 V2 Factory: `0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28`
- UP33 CL Factory: `0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3`
- Uniswap V3 Factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- Uniswap V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
