const CEX_PATH_WHITELIST: Record<string, RegExp> = {
  binance: /^\/fapi\/v1\/(exchangeInfo|premiumIndex|ticker\/24hr|fundingInfo|fundingRate|klines)(\?|$)/,
  okx: /^\/api\/v5\/(public|market)\/[a-zA-Z-]+(\?|$)/,
  gate: /^\/api\/v4\/futures\/usdt\/(contracts|tickers|funding_rate)(\?|$)/,
  bybit: /^\/v5\/market\/[a-zA-Z-]+(\?|$)/,
};

export function isAllowedCexPath(exchange: string, rawPath: string): boolean | 'traversal' {
  if (rawPath.includes('..') || rawPath.includes('%2e') || rawPath.includes('%2E') || rawPath.includes('\\')) {
    return 'traversal';
  }
  const path = new URL(rawPath, 'http://localhost').pathname
    + (rawPath.includes('?') ? '?' + rawPath.split('?').slice(1).join('?') : '');
  const whitelist = CEX_PATH_WHITELIST[exchange];
  if (whitelist && !whitelist.test(path)) return false;
  return true;
}
