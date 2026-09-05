# One image, two entry points. The web machine uses the default CMD
# (`node server.js`); the daily reconcile machine overrides it with
# `node reconcile-job.mjs`. Migrations run separately as the Fly deploy
# release_command (`node migrate.mjs`). See fly/RUNBOOK.md.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# The one-shot entry points are TypeScript, and tsx is a devDependency that
# does not belong in the runtime image. Bundle them to plain ESM instead.
# Dependencies are inlined rather than left external: the standalone output
# only contains packages Next traced from a route, and the migrator is not
# reachable from one, so resolving against it at runtime would be a gamble.
RUN pnpm exec esbuild reconcile-job.ts migrate.ts \
      --bundle --platform=node --format=esm \
      --outdir=.next/standalone --out-extension:.js=.mjs

# --- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app

# server.js sits at the root of the standalone output.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# The migration SQL is data, not code, so it is not part of any bundle.
COPY --from=build --chown=app:app /app/drizzle ./drizzle

USER app
EXPOSE 3000
CMD ["node", "server.js"]
