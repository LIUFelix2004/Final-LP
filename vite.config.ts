import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

async function proxyFetch(
  upstream: string,
  proxyUrl: string,
  headers: Record<string, string>,
  res: ServerResponse,
  method: string = 'GET',
  body?: string,
): Promise<void> {
  const proxyEnv = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  let fetchFn: typeof globalThis.fetch = globalThis.fetch
  let fetchInit: RequestInit & { dispatcher?: unknown } = { method, headers, signal: AbortSignal.timeout(10_000) }
  if (body) fetchInit.body = body

  if (proxyEnv) {
    const undici = await import('undici')
    const dispatcher = new undici.ProxyAgent(proxyEnv)
    fetchFn = undici.fetch as unknown as typeof globalThis.fetch
    fetchInit = { ...fetchInit, dispatcher } as unknown as RequestInit
  }

  const upstream_resp = await fetchFn(upstream, fetchInit)

  res.writeHead(upstream_resp.status, {
    'content-type': upstream_resp.headers.get('content-type') || 'application/json',
    'access-control-allow-origin': '*',
  })

  if (upstream_resp.body) {
    const reader = upstream_resp.body.getReader()
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read()
      if (done) { res.end(); return }
      res.write(value)
      return pump()
    }
    await pump()
  } else {
    const text = await upstream_resp.text()
    res.end(text)
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function gmgnProxyPlugin(apiKey: string, proxyUrl: string): Plugin {
  return {
    name: 'gmgn-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        let target: string | undefined
        let rewrittenPath: string | undefined
        let headers: Record<string, string> = {}

        if (url.startsWith('/api/gmgnq')) {
          target = 'https://gmgn.ai'
          rewrittenPath = url.replace(/^\/api\/gmgnq/, '/defi/quotation/v1')
          headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://gmgn.ai/',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
          }
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        } else if (url.startsWith('/api/gmgn')) {
          target = 'https://openapi.gmgn.ai'
          const parsed = new URL(url.replace(/^\/api\/gmgn/, ''), 'https://openapi.gmgn.ai')
          parsed.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)))
          parsed.searchParams.set('client_id', crypto.randomUUID())
          rewrittenPath = parsed.pathname + parsed.search
          if (apiKey) headers['X-APIKEY'] = apiKey
        }

        if (!target || !rewrittenPath) return next()

        const upstream = `${target}${rewrittenPath}`

        try {
          await proxyFetch(upstream, proxyUrl, headers, res)
        } catch (err) {
          console.error(`[gmgn-proxy] ${upstream}:`, err)
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' })
          }
          res.end(JSON.stringify({ error: 'proxy_error', message: String(err) }))
        }
      })
    },
  }
}

const CEX_ROUTES: Record<string, { primary: string; fallback?: string }> = {
  binance: { primary: 'https://fapi.binance.com', fallback: 'https://www.binance.com' },
  okx: { primary: 'https://www.okx.com' },
  gate: { primary: 'https://api.gateio.ws' },
  bybit: { primary: 'https://api.bybit.com', fallback: 'https://api.bytick.com' },
}

const CEX_PATH_WHITELIST: Record<string, RegExp> = {
  binance: /^\/fapi\/v1\/(exchangeInfo|premiumIndex|ticker\/24hr|fundingInfo|fundingRate|klines)/,
  okx: /^\/api\/v5\/(public|market)\//,
  gate: /^\/api\/v4\/futures\/usdt\/(contracts|tickers|funding_rate)/,
  bybit: /^\/v5\/market\//,
}

const responseCache = new Map<string, { data: string; contentType: string; time: number }>()
const CACHE_SHORT_MS = 4_000
const CACHE_LONG_PATTERNS = [/exchangeInfo/, /contracts$/, /instruments-info/]

function cexProxyPlugin(proxyUrl: string): Plugin {
  return {
    name: 'cex-proxy',
    configureServer(server) {
      const hlCache = new Map<string, { data: string; time: number }>()
      const HL_CACHE_MS = 4_000

      server.middlewares.use('/api/cex/hl', async (req, res, _next) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        try {
          const body = await readBody(req)
          const cached = hlCache.get(body)
          if (cached && Date.now() - cached.time < HL_CACHE_MS) {
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
            res.end(cached.data)
            return
          }

          const doFetch = async (): Promise<string> => {
            const proxyEnv = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
            let fetchFn: typeof globalThis.fetch = globalThis.fetch
            let fetchInit: RequestInit & { dispatcher?: unknown } = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) }
            if (proxyEnv) {
              const undici = await import('undici')
              const dispatcher = new undici.ProxyAgent(proxyEnv)
              fetchFn = undici.fetch as unknown as typeof globalThis.fetch
              fetchInit = { ...fetchInit, dispatcher } as unknown as RequestInit
            }
            const r = await fetchFn('https://api.hyperliquid.xyz/info', fetchInit)
            if (r.status === 429) {
              if (cached) return cached.data
              throw new Error('429 Too Many Requests')
            }
            if (!r.ok) throw new Error(`${r.status}`)
            return r.text()
          }

          const text = await doFetch()
          hlCache.set(body, { data: text, time: Date.now() })
          res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
          res.end(text)
        } catch (err) {
          console.error('[cex-proxy] hyperliquid:', err)
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'proxy_error', exchange: 'hyperliquid', message: String(err) }))
        }
      })

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = req.url ?? ''
        const match = url.match(/^\/api\/cex\/(\w+)(\/.+)$/)
        if (!match) return next()

        const [, exchange, rawPath] = match
        const route = CEX_ROUTES[exchange]
        if (!route) return next()

        if (rawPath.includes('..') || rawPath.includes('%2e') || rawPath.includes('%2E')) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'path_traversal_rejected' }))
          return
        }
        const path = new URL(rawPath, 'http://localhost').pathname + (rawPath.includes('?') ? '?' + rawPath.split('?').slice(1).join('?') : '')

        const whitelist = CEX_PATH_WHITELIST[exchange]
        if (whitelist && !whitelist.test(path)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'path_not_allowed' }))
          return
        }

        const cacheKey = `${exchange}:${path}`
        const cached = responseCache.get(cacheKey)
        const isLongCache = CACHE_LONG_PATTERNS.some(p => p.test(path))
        const cacheTtl = isLongCache ? 3600_000 : CACHE_SHORT_MS
        if (cached && Date.now() - cached.time < cacheTtl) {
          res.writeHead(200, { 'content-type': cached.contentType, 'access-control-allow-origin': '*' })
          res.end(cached.data)
          return
        }

        const tryUpstream = async (base: string): Promise<Response> => {
          const proxyEnv = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
          let fetchFn: typeof globalThis.fetch = globalThis.fetch
          let fetchInit: RequestInit & { dispatcher?: unknown } = { signal: AbortSignal.timeout(10_000) }
          if (proxyEnv) {
            const undici = await import('undici')
            const dispatcher = new undici.ProxyAgent(proxyEnv)
            fetchFn = undici.fetch as unknown as typeof globalThis.fetch
            fetchInit = { ...fetchInit, dispatcher } as unknown as RequestInit
          }
          return fetchFn(`${base}${path}`, fetchInit)
        }

        try {
          let upstream_resp = await tryUpstream(route.primary)
          if ((upstream_resp.status === 451 || upstream_resp.status === 403) && route.fallback) {
            upstream_resp = await tryUpstream(route.fallback)
          }

          const text = await upstream_resp.text()
          const contentType = upstream_resp.headers.get('content-type') || 'application/json'

          if (upstream_resp.ok) {
            responseCache.set(cacheKey, { data: text, contentType, time: Date.now() })
          }

          res.writeHead(upstream_resp.status, {
            'content-type': contentType,
            'access-control-allow-origin': '*',
          })
          res.end(text)
        } catch (err) {
          console.error(`[cex-proxy] ${exchange} ${path}:`, err)
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'proxy_error', exchange, message: String(err) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.GMGN_API_KEY || ''
  const proxyUrl =
    env.HTTPS_PROXY || env.HTTP_PROXY ||
    process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
    process.env.https_proxy || process.env.http_proxy ||
    ''

  return {
    plugins: [react(), gmgnProxyPlugin(apiKey, proxyUrl), cexProxyPlugin(proxyUrl)],
    define: {
      'import.meta.env.VITE_GMGN_CONFIGURED': JSON.stringify(apiKey ? 'true' : 'false'),
    },
  }
})
