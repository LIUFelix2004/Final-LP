import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.GMGN_API_KEY || ''

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/gmgn': {
          target: 'https://openapi.gmgn.ai',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/gmgn/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) {
                proxyReq.setHeader('X-APIKEY', apiKey)
              }
              const url = new URL(proxyReq.path, 'https://openapi.gmgn.ai')
              url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)))
              url.searchParams.set('client_id', 'lp-leaderboard')
              proxyReq.path = url.pathname + url.search
            })
          },
        },
        '/api/gmgn-fallback': {
          target: 'https://gmgn.ai',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/gmgn-fallback/, '/defi/quotation/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
              proxyReq.setHeader('Referer', 'https://gmgn.ai/')
              proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
              proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9')
              if (apiKey) {
                proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
              }
            })
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_GMGN_CONFIGURED': JSON.stringify(apiKey ? 'true' : 'false'),
    },
  }
})
