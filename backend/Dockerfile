# Minimal, self-contained image so the backend can be built & deployed on its own
# — one of the things that keeps it extractable into a separate repo/service later.
# Fleshed out (multi-stage prune, migrations) as the backend grows.
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# NOTE: while this lives in the monorepo, `docker build` must run from the repo
# root with `-f backend/Dockerfile .` so the workspace and packages/shared are in
# context. After the repo is split, this builds standalone from the backend root.
COPY . .
RUN pnpm install --frozen-lockfile --filter @notifications/backend...
RUN pnpm --filter @notifications/backend build

EXPOSE 3000
CMD ["node", "backend/dist/index.js"]
