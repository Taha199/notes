import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite does not run Vercel /api handlers. Proxy them to production (or VERCEL_DEV)
// so local `npm run dev` does not receive HTML 404 for /api/*.
const apiProxyTarget = process.env.VITE_API_PROXY || 'https://tahanote.com'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
