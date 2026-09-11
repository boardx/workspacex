# Build from repository root. Public API origin is fixed in the release build.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/workspacex
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN --mount=type=cache,id=workspacex-cloud-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter web...
ARG NEXT_PUBLIC_API_URL
RUN --network=none pnpm --filter @repo/contracts typecheck \
 && NODE_OPTIONS=--max-old-space-size=3072 NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" pnpm --filter web build \
 && chown -R node:node /opt/workspacex/apps/web/.next
ARG SOURCE_REVISION
RUN test "${#SOURCE_REVISION}" = 40
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
WORKDIR /opt/workspacex/apps/web
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
