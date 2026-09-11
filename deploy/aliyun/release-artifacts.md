# 不可变发布制品与镜像预热

五分钟 provision 的前置条件包括：六个发布镜像已经构建、推送，manifest 已经审查，目标 ECS 已经完成镜像预热。构建和下载不进入 provision 计时。当前代码实现 manifest 校验和 Docker 本地缓存检查；尚未证明完整发布镜像可以启动，也没有真实云端耗时证据。

发布 manifest 的唯一结构定义是 `packages/cloud-deploy/src/release.ts` 中的 `releaseManifestSchema`：

- `schemaVersion: 1`、`release`、完整 40 位 `sourceRevision`；
- `platform` 为 `linux/amd64` 或 `linux/arm64`，必须与目标主机一致；
- `images` 包含 `web`、`api`、`agent`、`sandbox`、`postgres`、`redis`，每项仅包含 `image`；
- `image` 必须使用 `registry/repository@sha256:<64 位小写十六进制>`，禁止 tag；
- 四个应用镜像必须携带 OCI label `org.opencontainers.image.revision`，与 manifest 完整 SHA 一致。数据库镜像由上游构建，不要求应用 SHA。

从仓库根目录执行：

```sh
node --import tsx packages/cloud-deploy/src/release-cli.ts validate /secure/release.json starter
node --import tsx packages/cloud-deploy/src/release-cli.ts prewarm /secure/release.json starter
node --import tsx packages/cloud-deploy/src/release-cli.ts verify /secure/release.json starter
```

生产环境将最后一个参数改为 `production`；仅预热四个应用镜像，RDS 和托管 Redis 在前置工作中准备。登录私有镜像仓库由运维通过 Docker credential helper 或 `docker login --password-stdin` 完成，不将口令放入 manifest 或命令行参数。

`prewarm` 显式执行逐个 `docker pull --platform … image@digest`，然后重新运行 `docker image inspect`；仅下载命令成功不足以通过。`verify` 绝不 pull/build，验证本地镜像的 RepoDigests、操作系统/架构，以及应用镜像 revision。错误仅输出服务名称与错误码，不转发可能含凭据的 Docker stderr。验证返回 `cloudVerified:false`，避免把镜像缓存检查误当云端验收。

这些检查证明所检查 Docker daemon 的镜像缓存状态。部署启动必须继续使用相同 digest、`--pull never`，并核对正在运行容器的镜像 ID；缓存检查本身不证明容器或业务健康。签名、可信来源和发布审批仍由发布流程负责，manifest 自报 SHA 不是供应链签名。

现有 `apps/deep-agent-service/Dockerfile` 仍使用 `langgraph dev`；本切片新增 API/Web 云发布 Dockerfile 和独立 Agent 官方构建配置，但实际镜像验证单独记录。不能将本切片标成整个 CP-02 验收通过；后续必须构建并运行真实应用镜像，完成运行体版本和用户可见冒烟验收。

## 构建入口（构建验证尚未完成）

新增 `deploy/aliyun/images/api.Dockerfile` 和 `web.Dockerfile`，以仓库根目录为 context；专用 dockerignore 排除环境文件、密钥文件及本地依赖。使用 `--build-arg NODE_IMAGE=node@sha256:<审核后的digest>` 和 `--build-arg SOURCE_REVISION=<完整SHA>`。云 Web 镜像固定相对 `/api`，浏览器使用当前域名；服务端通过 `API_INTERNAL_URL=http://api:3200` 直连 API。无需针对不同域名重新构建。API 默认 3200，Web 3000。进程以 node 用户启动；API 执行 Node + tsx，Web 执行 next start。部署前仍必须实际构建、运行并验证，不将 Dockerfile 存在视为镜像可用。

Agent 使用官方 Agent Server 构建入口，与旧开发 Dockerfile 隔离。先从现有图配置生成 release config（目标文件放在 deep-agent-service 目录，保持相对图路径），再使用锁定依赖中的 CLI：

```sh
node --import tsx packages/cloud-deploy/src/agent-release-cli.ts apps/deep-agent-service/langgraph.json apps/deep-agent-service/langgraph.release.json langchain/langgraph-server@sha256:<审核后的digest> <完整SHA>
cd apps/deep-agent-service
uv run --frozen --no-dev langgraph dockerfile -c langgraph.release.json Dockerfile.release
```

生成器保留图和 HTTP 路由、移除开发 `.env` 加载、固定基础镜像 digest 并写入 revision label。生成输出拒绝覆盖已有文件。生成的 Dockerfile 必须再次审查其依赖锁定和镜像上下文，然后构建；当前尚无该镜像构建或启动证据。

生产 Agent Server 还需通过环境文件注入 `DATABASE_URI`（专用数据库）、`REDIS_URI`（专用 Redis DB）、`LANGGRAPH_CLOUD_LICENSE_KEY`，并按供应商要求配置 LangSmith 凭据/出网。不得将许可值写入 manifest、命令行或仓库。`validateAgentServerEnvironment` 仅校验这些参数存在与协议，不宣称许可证有效。

依据：[官方 standalone prerequisites](https://docs.langchain.com/langsmith/deploy-standalone-server)、[官方 CLI](https://docs.langchain.com/langsmith/cli)。文档说明生产许可验证以及推荐 Kubernetes 的运维差距；当前 ECS 单副本方案必须自行验证停机排空、持久化和升级。许可选择等待用户决策，开发服务器不能算生产验收。

## 两档 Compose 生成

`createCloudCompose(config, manifest, {projectName, runtimeDirectory})` 返回 Docker Compose 可直接读取的 JSON 对象。所有服务固定 manifest digest、`pull_policy: never`、无 build。启动时继续传 `--pull never --no-build`。Starter 另起 PostgreSQL/Redis；生产使用外部服务。Starter 数据 bind 在 `dataVolumePath/postgres` 与 `/redis`，删除容器不会删除宿主数据；PostgreSQL 镜像必须具备 API migrations 所需的 vector 扩展，需真实数据库验证，不能凭镜像名称判定。

前置准备 runtimeDirectory 下的 `api.env`、`agent.env`、`web.env`（Starter 另需 `postgres.env` 和含持久化/认证设置的 `redis.conf`）。全部 env_file 使用 `format: raw`，要求 Compose >=2.30。密码不出现在生成 JSON。还需建立 `sandbox`、`sessions` 目录并赋予 UID/GID 1000 写权限，建立 `certs` 目录并按需放入只读 `ca.pem`，安装 `docker-seccomp.json` 和 `workspacex-native-sessions` AppArmor profile。bind 禁止自动创建缺失目录。

API 容器 3200，Web 3000，仅映射宿主回环供 TLS 反代；Agent 8000 仅容器网络可见。API 调用 `http://agent:8000`。两个沙箱服务分别共享 `/run/sandbox/skill-sandbox.sock` 和 `/run/sessions/skill-sandbox.sock`，均禁网、只读根文件系统、移除 capabilities、限制 CPU/内存/PID。Native sessions 额外启用已有 seccomp/AppArmor 策略。API 只读挂载 `/run/certs`。数据库迁移/初始化容器须由编排器采用同样 CA 挂载。

可独立运行 `node --import tsx packages/cloud-deploy/scripts/verify-compose.ts`，通过真实 Docker Compose 解析两档配置，检验 raw 密码保留、服务闭包、安全限制及无效策略被拒绝；不拉取镜像、不启动服务，也不宣称服务业务验收。

`verifyRunningRelease(manifest, profile, containerIds, executor)` 用启动后获得的容器 ID 查询运行体，核对实际 Image ID、启动使用的 digest、Compose service label，以及 running/restarting/OOM 状态；包含两个沙箱容器。检查只请求不含环境变量的 inspect 字段。通过仍返回 `businessVerified:false`，业务探针独立执行。

运行体门控还可执行 `node --import tsx packages/cloud-deploy/scripts/verify-running-release.ts docker.io/library/node@sha256:<已缓存digest>`：启动五个禁网、资源受限的 Node fixture，验证实际容器身份，主动停止其中一个确保门控失败，最后清理全部 fixture。这证明门控的 Docker 接口与反证有效，不能替代真实应用健康或业务验收。

云 Web 同源前提：TLS 反代必须将 `/api` 转发到 API 的对应根路径，并支持 WebSocket Upgrade；Web 自身 `/api/copilotkit` 如需由 Next route handler 消费，应设置更具体的路由，优先于通用 API 前缀。`web.env` 设置 `API_INTERNAL_URL=http://api:3200`，不设置旧的 `APP_API_PORT` 回环参数；`NEXT_PUBLIC_API_PATH_PREFIX` 保持空值，避免重复 `/api`。浏览器 HTTP/WS、SSR/Copilot 与旧绝对 API 地址分别有回归测试。
