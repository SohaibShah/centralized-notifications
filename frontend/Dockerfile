# Minimal, self-contained image so the frontend can be built & deployed on its own
# — part of what keeps it extractable into a separate repo later. Real deploys will
# serve the built assets behind a static server / CDN; this is a build-time stub.
FROM node:22-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# NOTE: while this lives in the monorepo, `docker build` must run from the repo
# root with `-f frontend/Dockerfile .` so packages/shared is in context. After the
# repo is split, this builds standalone from the frontend root.
COPY . .
RUN pnpm install --frozen-lockfile --filter @notifications/frontend...
RUN pnpm --filter @notifications/frontend build

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
