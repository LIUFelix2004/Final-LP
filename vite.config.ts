import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function gmgnProxyPlugin(apiKey: string): Plugin {
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
          const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
          let fetchFn: typeof globalThis.fetch = globalThis.fetch
          let fetchInit: RequestInit & { dispatcher?: unknown } = { headers }

          if (proxyEnv) {
            const undici = await import('undici')
            const dispatcher = new undici.ProxyAgent(proxyEnv)
            fetchFn = undici.fetch as unknown as typeof globalThis.fetch
            fetchInit = { headers, dispatcher } as unknown as RequestInit
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
        } catch (err) {
          console.error(`[gmgn-proxy] ${upstream}:`, err)
          res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'proxy_error', message: String(err) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.GMGN_API_KEY || ''

  return {
    plugins: [react(), gmgnProxyPlugin(apiKey)],
    define: {
      'import.meta.env.VITE_GMGN_CONFIGURED': JSON.stringify(apiKey ? 'true' : 'false'),
    },
  }
})
