# syntax=docker/dockerfile:1

FROM node:24-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
RUN pnpm --filter @tagteam/server build

# Runtime payload: bundle, migrations, and the one native dependency built for this platform.
WORKDIR /out
RUN cp -r /repo/apps/server/dist /repo/apps/server/drizzle . \
	&& rm -f dist/*.map \
	&& node -e "const v = require('/repo/apps/server/node_modules/better-sqlite3/package.json').version; require('node:fs').writeFileSync('package.json', JSON.stringify({ private: true, type: 'module', dependencies: { 'better-sqlite3': v } }))" \
	&& npm install --omit=dev --no-audit --no-fund \
	&& rm -rf node_modules/better-sqlite3/deps \
	&& find node_modules/better-sqlite3/prebuilds -type f ! -name "linux-$(node -p process.arch).node" -delete

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_PATH=/data/tagteam.db \
	MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
