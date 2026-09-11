# Build from repository root. NODE_IMAGE must be a reviewed digest-pinned image.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /opt/workspacex
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN test "${#SOURCE_REVISION}" = 40 \
 && pnpm install --frozen-lockfile --filter @repo/api... \
 && pnpm --filter @repo/contracts typecheck \
 && pnpm --filter @repo/api typecheck
ENV NODE_ENV=production
USER node
WORKDIR /opt/workspacex/apps/api
EXPOSE 3200
CMD ["node", "--import", "tsx", "src/main.ts"]
