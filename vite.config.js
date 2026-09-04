import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// GitHub Pages serves a project site from /<repo>/. Set BASE_PATH in CI to
// '/<repo>/', or leave it unset when using a custom domain or a user site.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [svelte()],
  // BUILD_DIR moves the output off this drive. The project lives inside a
  // Dropbox folder, and Dropbox keeps handles open on the tree it is indexing:
  // vite empties the out dir before every build, and a held directory fails that
  // with EPERM or "device or resource busy" — repeatedly, and not always on the
  // same path. Pausing sync does not release handles Dropbox already holds.
  build: { outDir: process.env.BUILD_DIR || 'dist', target: 'es2022', chunkSizeWarningLimit: 1200 },
  // maplibre's worker is an ES module and imports its shared chunk. Emitting it
  // as an IIFE would break those imports; see the note in src/main.js.
  worker: { format: 'es' },
})
