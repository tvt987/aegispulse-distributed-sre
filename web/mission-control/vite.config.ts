import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide-icons';
          }
          if (id.includes('/src/data/empiricalBenchmarks')) {
            return 'benchmarks-data';
          }
          if (id.includes('/src/engine/localHybridRag')) {
            return 'rag-engine';
          }
          if (
            id.includes('/src/engines/chaosEngine') ||
            id.includes('/src/engines/loadProfilerEngine') ||
            id.includes('/src/engines/runbookEngine') ||
            id.includes('/src/engine/localKernel')
          ) {
            return 'sre-sim-engines';
          }
          return undefined;
        },
      },
    },
  },
});
