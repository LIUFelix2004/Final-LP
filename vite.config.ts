import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/gmgn': {
          target: 'https://gmgn.ai',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/gmgn/, '/defi/quotation/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const key = env.GMGN_API_KEY
              if (key) {
                proxyReq.setHeader('Authorization', `Bearer ${key}`)
              }
            })
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_GMGN_CONFIGURED': JSON.stringify(env.GMGN_API_KEY ? 'true' : 'false'),
    },
  }
})
