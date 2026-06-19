import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import snaptrade from './vite-plugin-snaptrade.js'

// Simple Vite + React setup. Run with `npm run dev`.
export default defineConfig(({ mode }) => {
  // Load ALL env vars from .env files (empty prefix = no VITE_ filter) and expose the
  // server-side secrets (partner SnapTrade keys + Supabase service role) to the dev
  // backend via process.env. VITE_* vars still reach the browser via import.meta.env.
  const envFile = loadEnv(mode, process.cwd(), '')
  for (const k of ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (envFile[k] && !process.env[k]) process.env[k] = envFile[k]
  }
  return {
    // Relative base so the build works at a domain root AND a GitHub Pages sub-path.
    base: './',
    // snaptrade() adds /api/snaptrade/* (personal) and /api/partner/* (multi-user)
    // to the dev/preview server so everything works with just `npm run dev`.
    plugins: [react(), snaptrade()],
    // Running `npm run dev` serves at http://localhost:5173 (live brokerage works here).
    server: { open: false, port: 5173 },
  }
})
