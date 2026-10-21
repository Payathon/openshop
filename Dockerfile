# The OpenShop server: API, /mcp, shop pages and the merchant workbench. Built from the repo root because the server
# imports the workspace packages (core, client) as TypeScript source.
#
# It runs the sources with tsx instead of a compiled build: the workspace packages export .ts
# files and the shop pages are .tsx, so a build would have to bundle all of them for no gain at
# this size. Startup costs about a second.

FROM node:26-slim AS deps
WORKDIR /app
# Node 26 no longer ships corepack.
RUN npm install -g pnpm@11.10.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/client/package.json packages/client/
# Only the server and the packages it depends on; dev dependencies include tsx and PGlite.
RUN pnpm install --frozen-lockfile --filter @openshop/server...

# The merchant workbench (apps/web), built to static files the server serves under /admin.
FROM node:26-slim AS web
WORKDIR /app
RUN npm install -g pnpm@11.10.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @openshop/web
COPY apps/web apps/web
RUN pnpm --filter @openshop/web build

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY --from=web /app/apps/web/dist apps/web/dist
COPY packages/core packages/core
COPY packages/client packages/client
COPY apps/server apps/server
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
WORKDIR /app/apps/server
ENV PORT=8788 UPLOADS_DIR=/data/uploads
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# node itself is PID 1's child (compose sets init: true) and handles SIGTERM in main.ts.
CMD ["node", "--import", "tsx", "src/main.ts"]
