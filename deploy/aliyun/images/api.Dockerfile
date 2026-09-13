# Build from repository root. NODE_IMAGE must be a reviewed digest-pinned image.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /opt/workspacex
RUN corepack enable && npm_config_registry="$NPM_REGISTRY" corepack prepare pnpm@9.15.0 --activate
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps/api ./apps/api
COPY --chown=node:node apps/skill-sandbox ./apps/skill-sandbox
COPY --chown=node:node apps/deep-agent-service/langgraph.json ./apps/api/config/agent-graphs.json
COPY --chown=node:node deploy/aliyun/images/api.tsconfig.json ./apps/api/tsconfig.release.json
RUN --mount=type=cache,id=workspacex-cloud-pnpm,target=/root/.local/share/pnpm/store npm_config_registry="$NPM_REGISTRY" pnpm install --frozen-lockfile --filter @repo/api...
RUN --network=none pnpm --filter @repo/contracts typecheck \
 && pnpm --filter @repo/api exec tsc -p tsconfig.release.json
ARG SOURCE_REVISION
RUN test "${#SOURCE_REVISION}" = 40
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
ENV NODE_ENV=production
USER node
WORKDIR /opt/workspacex/apps/api
RUN set -eu; for entry in \
  src/main.ts \
  src/infrastructure/db/migrate-cli.ts \
  scripts/prepare-starter-roles.ts \
  scripts/provision-admin.ts \
  scripts/data-readiness.ts \
  scripts/cloud-service-readiness.ts \
  scripts/backup-target-readiness.ts \
  scripts/verify-oss-storage.ts \
  scripts/cloud-business-probe.ts; \
  do test -r "$entry"; done; \
  test -r ../../packages/contracts/package.json; \
  test -n "$(find migrations -maxdepth 1 -type f -print -quit)"; \
  node --import tsx --input-type=module -e "await import('zod')"
EXPOSE 3200
CMD ["node", "--import", "tsx", "src/main.ts"]
