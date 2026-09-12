# Build from repository root. NODE_IMAGE must be a reviewed digest-pinned image.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /opt/workspacex
RUN corepack enable && npm_config_registry="$NPM_REGISTRY" corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/skill-sandbox ./apps/skill-sandbox
COPY apps/deep-agent-service/langgraph.json ./apps/api/config/agent-graphs.json
COPY deploy/aliyun/images/api.tsconfig.json ./apps/api/tsconfig.release.json
RUN --mount=type=cache,id=workspacex-cloud-pnpm,target=/root/.local/share/pnpm/store npm_config_registry="$NPM_REGISTRY" pnpm install --frozen-lockfile --filter @repo/api...
RUN --network=none pnpm --filter @repo/contracts typecheck \
 && pnpm --filter @repo/api exec tsc -p tsconfig.release.json
ARG SOURCE_REVISION
RUN test "${#SOURCE_REVISION}" = 40
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
ENV NODE_ENV=production
USER node
WORKDIR /opt/workspacex/apps/api
EXPOSE 3200
CMD ["node", "--import", "tsx", "src/main.ts"]
