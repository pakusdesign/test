import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001';
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: clientPort,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  css: {
    preprocessorOptions: {
      scss: { quietDeps: true },
    },
  },
  build: isSsrBuild
    ? {
        outDir: 'dist/server',
        emptyOutDir: true,
        target: 'node22',
        sourcemap: true,
        rollupOptions: { input: 'src/server/index.ts' },
      }
    : {
        outDir: 'dist/client',
        emptyOutDir: true,
        sourcemap: true,
        chunkSizeWarningLimit: 1200,
      },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20000,
        },
      },
    ],
  },
}));
