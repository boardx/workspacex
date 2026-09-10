# 阿里云新服务器 provision 交接清单（人类给 agent 的东西）

> 面向：要在一台新的阿里云 ECS 上把 WorkspaceX 一次跑起来的**人类**。
> 本文只回答一个问题：**你要准备/交给 agent 哪些资源和配置，才能一次 provision 成功**。
> 「怎么做、怎么验」不在这里复述 —— 看 `new-environment-bringup.md`（执行书）与
> `deployment-verification-standard.md`（判据）。端口归属看
> `project/PROJECT.md`；deploy.env 的键与默认值以 `.harness/scripts/vm/provision.sh`
> 为唯一事实源，本文只点名「哪些键必须由人填」，不抄它们的值。

---

## A. 机器与网络（阿里云控制台侧，agent 不能代办）

| 项 | 要求（照抄，不要替代方案） | 为什么是这个数 |
|---|---|---|
| ECS 实例 | x86_64，**8 vCPU / 16 GB 内存**（如 `ecs.c7.2xlarge`）。**不要 ARM** | 20 人并发的稳态推算约 7–9 GB；`deploy.sh` 在同一台机器上构建 Next.js，`--max-old-space-size` 默认 4096 MB，构建峰值再叠 4 GB。8 GB 的机器在有人用的时候部署会撞车 |
| 系统盘 | **200 GB ESSD PL1** | 每轮部署 `docker compose --build` 重建镜像 + pnpm store + Next 产物；PL1 是 IOPS 够 Postgres 用的最低档 |
| 操作系统 | **Ubuntu 24.04 LTS**（Server 版，公共镜像） | `provision.sh` 用 `apt-get`、NodeSource、Caddy 的 Debian 源，非 deb 系跑不通。不用 22.04：它的标准支持 2027-04 结束，对一台新开的生产机太近 |
| 公网 | **绑定 EIP**，带宽 **10 Mbps**（按固定带宽计费） | Caddy 申请 TLS 证书要求域名解析到本机且 80/443 可达；EIP 让机器重建后 IP 不变，DNS 不用跟着改 |
| 安全组入方向 | **只开 22（限来源 IP）、80、443** | 55433/59010/56380/2025 等全部只绑 `127.0.0.1`，不要往安全组里加 |
| 安全组出方向 | **全放通** | 要拉 GitHub、Docker Hub、NodeSource、Caddy 源、模型 API |
| 快照 | **开自动快照策略，每日一次，保留 7 天** | Postgres 数据在 docker volume 里（不是 tmpfs），这台机器上没有第二份 |

⚠ **域名必须已完成 ICP 备案**（默认按中国大陆地域走）。没备案的话 80/443 会被拦，
Caddy 的 ACME 挑战直接失败，provision 走不完。域名暂时备不了案的情况**先来找我谈**——
那要改地域，是另一套决策（国内访问延迟会变），不在本清单的默认路径里。

⚠ **Docker 镜像加速器要先配**：大陆地域拉 Docker Hub 会超时。在 `provision.sh` 装完
Docker 之后、跑 `deploy.sh` 之前，往 `/etc/docker/daemon.json` 写阿里云容器镜像服务
给你的专属加速地址（控制台「容器镜像服务 → 镜像工具 → 镜像加速器」），然后
`systemctl restart docker`。

## B. 域名与 DNS

- 一个域名（如 `devapp.example.com`）**A 记录已指向该机公网 IP**，且已生效
  （`dig +short <域名>` 能返回该 IP）。
- 这个值就是 `PUBLIC_DOMAIN`：provision 用它写 Caddyfile、写 `NEXT_PUBLIC_API_URL`。
  **写错要重跑 provision 并重建 deploy.env**，不是改一行的事。

## C. 访问凭据（给 agent 的东西）

| # | 交给谁/放哪 | 内容 | 备注 |
|---|---|---|---|
| C1 | agent 的 SSH 通道 | 该机 **root 用户**的 SSH 私钥 + 登录方式 | provision 全程要 root：装包、建用户、写 systemd/Caddy/sudoers |
| C2 | 放在机器上，路径传给 agent（`DEPLOY_KEY_PATH`） | GitHub **只读 deploy key 的私钥**（`boardx/workspacex` 仓库设置里添加对应公钥） | 不要复用装 runner 的管理员钥匙；agent 只需路径，不需要看到内容 |
| C3 | GitHub 仓库设置 | 一个 **self-hosted runner** 注册到本机，标签必须是 `self-hosted, linux, x64, workspacex` | `backend-gates.yml` 的 deploy job 钉死这组标签 |
| C4 | 告知 agent | 该 runner 的**系统用户名**（默认 `ghrunner`，即 `RUNNER_USER`） | 写错 → sudoers 配给不存在的用户，部署时 `sudo: ... I can't do that` |

## D. 必须由人填进 `/opt/workspacex/deploy.env` 的值（0600）

provision 会**自动生成**数据库/对象存储口令、native session 的 socket 与两把内部
key，这些不用你准备。**下面这些没有默认值，缺了部署当场红退**：

| 键 | 是什么 | 缺了会怎样 |
|---|---|---|
| `KERNEL_MODEL_PROVIDER` | provider 名，与下面 base url 指向的服务一致 | `deploy.sh` 4b-i 步红退；配一半的话设计协作画布/线程命名/追问建议/反馈整理/异常摘要**静默退回固定文案** |
| `KERNEL_MODEL_BASE_URL` | 单次补全用的 **OpenAI 兼容** base url（阿里云百炼 DashScope compatible-mode 可用） | 同上 |
| `KERNEL_MODEL_API_KEY` | 该服务的 key | 同上 |
| `KERNEL_DEEP_AGENT_MODEL_ID` | 「通用助手」内核用的模型 ID，**每环境显式填**，无默认 | `deploy.sh` 4h 步红退 |
| `MODEL_CREDENTIAL_KEY` | 存量模型凭据的加密主密钥 | API 启动崩溃循环（#620）；⚠ **轮换会让所有存量加密凭据失效** |
| `EMAIL_VERIFICATION_SECRET` | ≥ 32 字节 | API 启动崩溃循环 |
| `PLATFORM_SUPERUSER_EMAILS` | 平台超管邮箱（逗号分隔） | 没人能进后台管理 |

**按需**（不填则对应能力不可用，但不阻塞部署）：

- 邮件外发：`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_EMAIL_API_TOKEN` /
  `CLOUDFLARE_EMAIL_SENDING_DOMAIN`（懒加载，缺了不崩启动，首次发信才报错）。
- 语音转写：`KERNEL_ASR_PROVIDER` / `KERNEL_ASR_BASE_URL` / `KERNEL_ASR_API_KEY` /
  `KERNEL_ASR_MODEL`。
- 追踪：`LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT`（三行都填才生效）。
- `COPILOTKIT_V2_AGENT_ID`：**留空**。服务端按请求所属 org 动态解析默认 agent，填了反而容易填错（2026-08-25 devapp 实测：填成版本 id 会让未选 agent 的首屏发消息整条轨道挂掉）。

## E. 真实模型 e2e 取证凭据

`/opt/workspacex/real-model-e2e.env`（0600）：`REAL_MODEL_E2E_EMAIL` +
`REAL_MODEL_E2E_PASSWORD` —— 一个**专用测试账号**，别用真人账号。
没有它，就绪核对的第三条探针（`real-model-chat-evidence.yml`）跑不了 —— 也就没办法
证明「真实模型链路能走通」，这台机器就只能算装好了、不算能用。

## F. 交给 agent 的一句话（把上面的值代进去）

```bash
PUBLIC_DOMAIN=<你的域名> \
DEPLOY_KEY_PATH=<C2 私钥在机器上的路径> \
RUNNER_USER=<C4 的 runner 用户名> \
  /opt/workspacex/app/.harness/scripts/vm/provision.sh
```

## G. 一次成功的判据（不是「脚本没报错」）

按 `new-environment-bringup.md` 第 4 节跑三条探针：`devapp-probe.yml`、
`devapp-sandbox-cjk-pdf-probe.yml`（都不需要凭据）、`real-model-chat-evidence.yml`
（需要 E）。**它们绿了才叫服务器动起来了**，部署日志绿不算。

---

## H. 逐组件资源预算（这台机器上到底跑着什么）

⚠ **下面的内存数是按各组件配置推算的，不是压测实测值**——本仓目前没有任何负载测试
证据。按本项目自己的规矩（"没有证据 = 没有完成"），上线后要用真实并发量核一次
`docker stats` 与 `systemd-cgtop`，再回来修正这张表。

| 进程/容器 | 怎么起的 | CPU | 内存 | 上限在哪声明 |
|---|---|---|---|---|
| `workspacex-api`（NestJS） | systemd，宿主进程 | 1 核（**单进程，无 cluster**） | ~1 GB | 无上限 |
| `workspacex-web`（Next.js） | systemd，宿主进程 | 0.5 核 | 0.5–1 GB | 无上限 |
| `postgres`（pgvector:pg16） | compose | 1–2 核 | 1–2 GB | 无上限，默认配置未调优 |
| `minio` + `redis` | compose | 0.5 核 | ~0.8 GB | 无上限 |
| `skill-sandbox` | compose | `SKILL_SANDBOX_CPUS`（默认 1.0） | `SKILL_SANDBOX_MEM_LIMIT`（默认 1g） | `docker-compose.deploy.yml` |
| `skill-sandbox-sessions` | compose | 同上（**各一份，不是共享**） | 同上 | 同上 |
| `workspacex-deep-agent` | `deploy.sh` 第 4h 步 `docker run` | 无限制 | 1–1.5 GB，**无限制** | 无 |
| Caddy + dockerd + OS | 系统 | 0.5 核 | ~1 GB | 无 |
| **稳态合计** | | **~6 核** | **~7–9 GB** | |
| 部署时 Next 构建峰值 | `deploy.sh` 第 5b 步 | 吃满可用核 | **+4 GB**（`WEB_BUILD_HEAP_MB`） | `deploy.sh` |

两件从这张表里读出来的事：

1. **构建和业务在同一台机器上**。选 16 GB 不是为了稳态，是为了"有人在用的时候部署"
   不撞车。这也是为什么扩到 50 人以上时，架构上第一步是把构建挪出生产机，而不是换更大的机器。
2. **`deep-agent` 是唯一没有资源上限的容器**。其它都封了顶，它没有。本项目 2026-08-08
   有过实测事故（孤儿容器堆积 → load 66 → Docker daemon 崩溃），记录在
   `agent-resource-cleanup-sop.md`。给它补上限是一条独立的待办，不在本清单范围内。

### 磁盘怎么用掉 200 GB

| 用途 | 量级 | 位置 |
|---|---|---|
| Docker 镜像（每轮部署 `--build` 重建，旧层留着） | 20–40 GB | `/var/lib/docker` |
| Postgres 数据 | 随业务长 | docker volume `workspacex_pgdata` |
| MinIO 对象 | 随业务长 | docker volume `workspacex_miniodata` |
| 用户上传的文件/头像 | 随业务长 | `/opt/workspacex/objects`（`WORKSPACEX_OBJECT_ROOT`） |
| pnpm store + `node_modules` + Next 产物 | 5–10 GB | `/opt/workspacex/app` |
| 容器日志 | **不限，会撑爆盘** | `/var/lib/docker/containers` —— 见 I.2 |

## I. 系统层配置（provision.sh 不做，要人手动做）

`provision.sh` 只搭台子（用户、clone、deploy.env、systemd、Caddy、特权脚本副本），
下面这些它不碰，但 20 人的量级下都要做：

**I.1 Docker 镜像加速器**（必做，否则大陆地域拉不动镜像）
写 `/etc/docker/daemon.json` 的 `registry-mirrors`，然后 `systemctl restart docker`。

**I.2 容器日志轮转**（必做，否则日志会撑爆系统盘）
Docker 默认 `json-file` driver **不限大小**，长跑的容器日志会一直涨到把盘写满，
而盘一满 Postgres 会先坏。在同一个 `/etc/docker/daemon.json` 里加：

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "100m", "max-file": "3" }
}
```

⚠ 这个设置**只对之后新建的容器生效**，已经在跑的要重建一次（下一轮 `deploy.sh` 会
`up -d --build`，自然带上）。

**I.3 Swap**（做）
开 4 GB swapfile。理由是 Next 构建那 4 GB 峰值：有 swap 的话最坏是变慢，没有的话是
OOM killer 挑一个进程杀掉——它挑中的往往是 Postgres。
⚠ 两个沙箱容器不受影响：它们 `mem_limit == memswap_limit`，等于对容器内禁用了 swap，
这是刻意的（沙箱要的是硬边界，不是"慢下来"）。

**I.4 时区与时间同步**（做）
`timedatectl set-timezone Asia/Shanghai`，确认 `systemd-timesyncd` 在跑。日志时间戳与
业务时间对不上会让排障多花一倍时间。

**I.5 专机专用**（纪律，不是命令）
这台机器上不要再装别的服务。端口分配已登记在 `project/PROJECT.md`，55433 / 59010 /
56380 / 2025 / 3100 / 3200 都被占了，装第二套东西撞端口的症状是"whichever starts
second fails to bind"，而如果输的那个是业务栈，你会在最坏的时候才发现。

### 已经可配 vs 要改代码才能配

| 想调的东西 | 现在能不能在 deploy.env 里调 |
|---|---|
| 并发 session 数、沙箱 CPU/内存/进程数 | ✅ 能（`SKILL_SANDBOX_*`，本次改动加的） |
| Next 构建堆上限 | ✅ 能（`WEB_BUILD_HEAP_MB`） |
| Postgres/MinIO/Redis 端口 | ✅ 能（`PGPORT` / `MINIO_PORT` / `REDIS_PORT`） |
| API/Web 的 systemd 资源限制、文件描述符上限 | ❌ 不能，unit 文件由 `provision.sh` 生成，要改脚本 |
| Postgres 的 `shared_buffers` 等调优参数 | ❌ 不能，用的是镜像默认配置 |
| `deep-agent` 容器的内存/CPU 上限 | ❌ 不能，`deploy.sh` 的 `docker run` 里没有这两个参数 |

后三行不是遗漏，是本次没动的范围。真到了要调的时候，各自是一条独立改动，别在 deploy.env
里找它们找到怀疑人生。

## J. 20 人并发的具体取值

填进 `/opt/workspacex/deploy.env`（这四个键都是可选的，不填走默认；默认是给单人开发机的）：

```
SKILL_SANDBOX_MAX_SESSIONS=32
SKILL_SANDBOX_MEM_LIMIT=4g
SKILL_SANDBOX_CPUS=2.0
SKILL_SANDBOX_PIDS_LIMIT=512
```

为什么是 32 而不是 20：一个用户在一次任务里可能同时持有多个 session（主任务 +
子任务），按人头 1:1 配会在正常使用下就撞顶。32 是留了一倍余量的档。

⚠ **这四项要一起调**。只调 `MAX_SESSIONS`，超出的并发不再是一个干净的 `SESSION_LIMIT`
拒绝，而是容器 OOM——把一个说得清的拒绝换成一场说不清的崩溃。
默认值本身只声明在两处、各管一段：session 数在 `packages/contracts/src/sandbox-session.ts`，
背后的资源在 `docker-compose.deploy.yml`。这份文件不复述它们的值。

还有两个上限不在服务器上，20 人的量级下大概率比服务器先到：

- **模型侧并发/QPS 配额**（百炼的 key 级限流）。20 人同时发消息，卡住的多半是这里。
  要提额找阿里云，不是加机器能解决的。
- **API 是单个 Node 进程**（systemd 里就是 `pnpm --filter api run start`，没有 cluster）。
  语音转写 WS、agent-run 事件 WS、SSE 流式全挂在这一个进程上。这些基本是 I/O 密集
  （在等模型），20 个连接不成问题；但任何 CPU 密集的同步逻辑会阻塞所有人。

## 一页速查：你要给我的东西

1. **ECS 8 vCPU / 16 GB / 200 GB ESSD PL1 / Ubuntu 24.04 LTS / 绑 EIP 10 Mbps**，
   安全组只开 22 / 80 / 443，自动快照已开；
2. 已 ICP 备案的域名，A 记录解析到该机 → `PUBLIC_DOMAIN`；
3. root 的 SSH 私钥与登录方式；
4. GitHub 只读 deploy key 私钥（已放到机器上，把路径给我）；
5. self-hosted runner 已注册（标签 `self-hosted linux x64 workspacex`）+ 它的系统用户名；
6. D 表七个必填值：模型三件套 + `KERNEL_DEEP_AGENT_MODEL_ID` + `MODEL_CREDENTIAL_KEY`
   + `EMAIL_VERIFICATION_SECRET` + `PLATFORM_SUPERUSER_EMAILS`；
7. 一个专用 e2e 测试账号的邮箱与口令。

这七项齐了，provision → deploy → 三条探针可以一路跑到底，中途不需要再问你。
I 节那几条系统层配置（镜像加速器、日志轮转、swap、时区）我可以在同一次连上去时一起做，
不需要你额外准备什么。
