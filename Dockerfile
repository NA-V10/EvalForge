# Single image: API + built web UI served from the same origin.
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @rel/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app ./
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY data ./data
EXPOSE 4000
# Migrations run automatically on startup. Seed demo data once with: docker compose run --rm app pnpm seed
CMD ["pnpm", "--filter", "@rel/api", "start"]
