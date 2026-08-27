import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// GitHub Pages serves a project site from /<repo>/. Set BASE_PATH in CI to
// '/<repo>/', or leave it unset when using a custom domain or a user site.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [svelte()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // maplibre's worker is an ES module and imports its shared chunk. Emitting it
  // as an IIFE would break those imports; see the note in src/main.js.
  worker: { format: 'es' },
})
