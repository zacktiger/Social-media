# The API image. Not used by render.yaml, which builds with Render's native
# Node runtime - this is here so the same service runs on Fly, Railway, or
# your own box without rewriting the deploy.
#
# Build from the REPO ROOT, not from this directory, because npm workspaces
# need the root package-lock.json:
#
#   docker build -f apps/api/Dockerfile -t pulse-api .

FROM node:22-slim

# Prisma's query engine and the sharp binaries both link against OpenSSL 3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first so a source-only change reuses the cached install layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
# The web app is not built here, but npm ci checks the lockfile against every
# declared workspace, so its manifest has to exist.
COPY apps/web/package.json ./apps/web/

# --include=dev because the build needs tsc and the Prisma CLI. They are kept
# in the final image rather than pruned, so `prisma migrate deploy` can run
# from this same image as a release step. Costs image size, buys one artifact
# instead of two.
RUN npm ci --include=dev --workspace @pulse/api --include-workspace-root

COPY apps/api ./apps/api

RUN npm run db:generate -w @pulse/api \
 && npm run build -w @pulse/api

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node

# The worker is the same image with a different command:
#   docker run pulse-api node apps/api/dist/worker.js
CMD ["node", "apps/api/dist/index.js"]
