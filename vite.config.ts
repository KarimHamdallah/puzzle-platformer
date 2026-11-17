import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths so the build runs from a zip, itch.io or GitHub Pages
  build: {
    chunkSizeWarningLimit: 1800, // Phaser alone is ~1.2 MB minified
  },
  server: {
    port: 5173,
    open: false,
  },
});
