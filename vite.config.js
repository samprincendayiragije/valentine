import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from https://<user>.github.io/valentine/ on GitHub Pages.
// Override with VITE_BASE=/ for a custom domain or local preview at the root.
const base = process.env.VITE_BASE ?? '/valentine/'

// index.html carries the strict production CSP. The dev server needs inline styles and a
// websocket for hot reload, so only in `npm run dev` swap in a relaxed policy.
const devCsp = {
  name: 'dev-relaxed-csp',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
      `$1default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https://archive.org https://*.archive.org; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.facebook.com; connect-src 'self' ws: http: https://*.supabase.co wss://*.supabase.co$2`),
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), devCsp],
})
