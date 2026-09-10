# 阿里云新服务器 provision 交接清单（人类给 agent 的东西）

> 面向：要在一台新的阿里云 ECS 上把 WorkspaceX 一次跑起来的**人类**。
> 本文只回答一个问题：**你要准备/交给 agent 哪些资源和配置，才能一次 provision 成功**。
> 「怎么做、怎么验」不在这里复述 —— 看 `new-environment-bringup.md`（执行书）与
> `deployment-verification-standard.md`（判据）。端口归属看
> `project/PROJECT.md`；deploy.env 的键与默认值以 `.harness/scripts/vm/provision.sh`
> 为唯一事实源，本文只点名「哪些键必须由人填」，不抄它们的值。

---

## A. 机器与网络（阿里云控制台侧，agent 不能代办）

| 项 | 要求 | 为什么是这个数 |
|---|---|---|
| ECS 实例 | x86_64（**不要 ARM**），≥ 4 vCPU / **8 GB 内存** | `deploy.sh` 构建 Next.js 时 `--max-old-space-size` 默认 4096 MB（可用 `WEB_BUILD_HEAP_MB` 覆盖）；同机还跑 postgres/minio/redis/两个沙箱容器 |
| 系统盘 | ≥ 100 GB ESSD | 每轮部署 `docker compose --build` 重建镜像 + pnpm store + Next 产物 |
| 操作系统 | **Ubuntu 22.04 / 24.04 LTS** | `provision.sh` 用 `apt-get`、NodeSource、Caddy 的 Debian 源；非 deb 系发行版跑不通 |
| 公网 | 固定公网 IP 或 EIP，带宽 ≥ 5 Mbps | Caddy 申请 TLS 证书要求域名解析到本机且 80/443 可达 |
| 安全组入方向 | 22（限来源 IP）、80、443 | **只开这三个**；55433/59010/56380/2025 等全部只绑 `127.0.0.1`，不要往安全组里加 |
| 出方向 | 全放通（至少 443） | 要拉 GitHub、Docker Hub、NodeSource、Caddy 源、模型 API |
| 磁盘快照/备份策略 | 建议开自动快照 | postgres 数据在 docker volume 里，不是 tmpfs |

⚠ **中国大陆地域**：域名必须已完成 **ICP 备案**，否则 80/443 被拦，Caddy 的 ACME
挑战直接失败。用香港/新加坡地域可绕开备案，但要评估国内访问延迟。
⚠ **镜像拉取**：大陆地域拉 Docker Hub 往往超时，需要预先配好镜像加速器
（`/etc/docker/daemon.json` 的 `registry-mirrors`），或用阿里云 ACR。这一步在
`provision.sh` 装完 Docker 之后、跑 `deploy.sh` 之前做。

## B. 域名与 DNS

- 一个域名（如 `devapp.example.com`）**A 记录已指向该机公网 IP**，且已生效
  （`dig +short <域名>` 能返回该 IP）。
- 这个值就是 `PUBLIC_DOMAIN`：provision 用它写 Caddyfile、写 `NEXT_PUBLIC_API_URL`。
  **写错要重跑 provision 并重建 deploy.env**，不是改一行的事。

## C. 访问凭据（给 agent 的东西）

| # | 交给谁/放哪 | 内容 | 备注 |
|---|---|---|---|
| C1 | agent 的 SSH 通道 | 该机 **root**（或有完整 sudo 的用户）的 SSH 私钥 + 登录方式 | provision 全程要 root：装包、建用户、写 systemd/Caddy/sudoers |
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
- `COPILOTKIT_V2_AGENT_ID`：**建议留空**（服务端按 org 动态解析默认 agent）。

## E. 真实模型 e2e 取证凭据（可选，但强烈建议）

`/opt/workspacex/real-model-e2e.env`（0600）：`REAL_MODEL_E2E_EMAIL` +
`REAL_MODEL_E2E_PASSWORD` —— 一个**专用测试账号**，别用真人账号。
没有它，就绪核对的第三条探针（`real-model-chat-evidence.yml`）跑不了。

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

## 一页速查：你要给我的东西

1. ECS 规格与地域已按 A 开好，安全组只开 22/80/443；
2. 域名已解析到该机（大陆地域已备案）→ `PUBLIC_DOMAIN`；
3. root SSH 通道；
4. GitHub 只读 deploy key 私钥（已放到机器上，告诉我路径）；
5. self-hosted runner 已注册（标签 `self-hosted linux x64 workspacex`）+ 它的用户名；
6. D 表七个必填值（模型三件套 + 模型 ID + 两把 secret + 超管邮箱），按需再加 CF 邮件 / ASR；
7. 一个专用 e2e 测试账号的邮箱与口令。

这七项齐了，provision → deploy → 三条探针可以一路跑到底，中途不需要再问你。
