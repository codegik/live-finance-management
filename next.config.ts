import type { NextConfig } from 'next'

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '1mb' } },

  // "Collecting build traces" walks the dependency graph to work out which
  // files each server route needs. None of these can be reached from a route —
  // they are test and tooling packages — but they are large, and on a cold
  // cache with few cores that phase is where a build appears to hang.
  outputFileTracingExcludes: {
    '**/*': [
      'node_modules/@testcontainers/**',
      'node_modules/testcontainers/**',
      'node_modules/msw/**',
      'node_modules/vitest/**',
      'node_modules/@vitest/**',
      'node_modules/drizzle-kit/**',
      'node_modules/typescript/**',
      'node_modules/tsx/**',
      'node_modules/esbuild/**',
      'node_modules/@esbuild/**',
      'node_modules/vite-tsconfig-paths/**',
    ],
  },
}

export default config
