import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // next-auth statically imports `next/server`. Next.js's package.json has
    // no `exports` map, so Vite's ESM resolver can't infer the `.js`
    // extension the way Next's own bundler does. Point it at the real file.
    alias: { 'next/server': 'next/server.js' },
  },
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    server: {
      // Force these through Vite's own resolver (where the alias above
      // applies) instead of Node's native ESM loader, which can't resolve
      // `next/server`'s missing extension the way Next's bundler does.
      deps: { inline: [/next-auth/, /@auth\/core/] },
    },
  },
})
