import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Simple Vite + React setup. Run with `npm run dev`.
export default defineConfig({
  // Relative base so the build works at a domain root (Netlify/Electron) AND at a
  // GitHub Pages sub-path (https://user.github.io/repo/).
  base: './',
  plugins: [react()],
  // open:false — the desktop launcher opens its own app window (see launch.cmd).
  // Running `npm run dev` manually still serves at http://localhost:5173.
  server: { open: false, port: 5173 },
})
