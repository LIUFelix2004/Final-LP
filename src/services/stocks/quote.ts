import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, type Address } from 'viem';
import type { StockPool } from '../../types/stocks';
import { USDG_ADDRESS, USDG_DECIMALS, V3_QUOTER_V2, ROBINHOOD_CHAIN_ID } from '../../config/stocks';
import { CHAINS } from '../../config/chains';

const STOCK_TOKEN_DECIMALS = 18;

const V3_QUOTE_ABI = [
  {
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ]}],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const robinhoodChain = {
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl || 'https://rpc.mainnet.chain.robinhood.com'] },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const },
  },
} as const;

function getClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl),
  });
}

export interface AmountQuoteResult {
  pool: StockPool;
  direction: 'buy' | 'sell';
  amountIn: bigint;
  amountOut: bigint;
  effectivePrice: number;
  priceImpact: number;
}

function feeToUint24(feeRate: number): number {
  return Math.round(feeRate * 10000);
}

export async function quoteV3Pool(
  pool: StockPool,
  amountUsdg: number,
  direction: 'buy' | 'sell',
): Promise<AmountQuoteResult | null> {
  if (pool.version !== 'V3' || pool.feeRate === null) return null;

  const client = getClient();
  const fee = feeToUint24(pool.feeRate);
  const tokenAddr = pool.tokenAddress as Address;
  const usdgAddr = USDG_ADDRESS as Address;

  let tokenIn: Address;
  let tokenOut: Address;
  let amountIn: bigint;

  if (direction === 'buy') {
    tokenIn = usdgAddr;
    tokenOut = tokenAddr;
    amountIn = BigInt(Math.round(amountUsdg * 10 ** USDG_DECIMALS));
  } else {
    if (pool.priceNative === null || pool.priceNative === 0) return null;
    const tokenAmount = amountUsdg / pool.priceNative;
    tokenIn = tokenAddr;
    tokenOut = usdgAddr;
    amountIn = BigInt(Math.round(tokenAmount * 10 ** STOCK_TOKEN_DECIMALS));
  }

  try {
    const data = encodeFunctionData({
      abi: V3_QUOTE_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });

    const result = await client.call({
      to: V3_QUOTER_V2 as Address,
      data,
    });

    if (!result.data) return null;

    const decoded = decodeFunctionResult({
      abi: V3_QUOTE_ABI,
      functionName: 'quoteExactInputSingle',
      data: result.data,
    });

    const amountOut = decoded[0];
    let effectivePrice: number;

    if (direction === 'buy') {
      const tokensOut = Number(amountOut) / 10 ** STOCK_TOKEN_DECIMALS;
      effectivePrice = amountUsdg / tokensOut;
    } else {
      const usdgOut = Number(amountOut) / 10 ** USDG_DECIMALS;
      effectivePrice = usdgOut / (Number(amountIn) / 10 ** STOCK_TOKEN_DECIMALS);
    }

    const midPrice = pool.priceNative ?? effectivePrice;
    const priceImpact = midPrice > 0 ? (effectivePrice - midPrice) / midPrice : 0;

    return {
      pool,
      direction,
      amountIn,
      amountOut,
      effectivePrice,
      priceImpact: direction === 'buy' ? priceImpact : -priceImpact,
    };
  } catch {
    return null;
  }
}

export async function quoteBestPool(
  pools: StockPool[],
  amountUsdg: number,
  direction: 'buy' | 'sell',
): Promise<AmountQuoteResult | null> {
  const v3Pools = pools.filter(p => p.version === 'V3' && p.feeRate !== null);
  if (v3Pools.length === 0) return null;

  const results = await Promise.all(
    v3Pools.map(p => quoteV3Pool(p, amountUsdg, direction)),
  );

  const valid = results.filter((r): r is AmountQuoteResult => r !== null);
  if (valid.length === 0) return null;

  if (direction === 'buy') {
    return valid.reduce((best, r) => r.effectivePrice < best.effectivePrice ? r : best);
  } else {
    return valid.reduce((best, r) => r.effectivePrice > best.effectivePrice ? r : best);
  }
}

export interface AmountAnalysis {
  buyResult: AmountQuoteResult | null;
  sellResult: AmountQuoteResult | null;
  buyPremium: number | null;
  sellPremium: number | null;
  midPrice: number | null;
}

export async function analyzeAmount(
  pools: StockPool[],
  amountUsdg: number,
  fairPrice: number | null,
): Promise<AmountAnalysis> {
  const [buyResult, sellResult] = await Promise.all([
    quoteBestPool(pools, amountUsdg, 'buy'),
    quoteBestPool(pools, amountUsdg, 'sell'),
  ]);

  const midPrice = fairPrice;

  const buyPremium = buyResult && midPrice
    ? (buyResult.effectivePrice - midPrice) / midPrice
    : null;

  const sellPremium = sellResult && midPrice
    ? (midPrice - sellResult.effectivePrice) / midPrice
    : null;

  return { buyResult, sellResult, buyPremium, sellPremium, midPrice };
}
