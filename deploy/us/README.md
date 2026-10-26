# WorkspaceX 正式镜像手动部署

目标：在一台新服务器上运行已发布的 WorkspaceX 镜像。部署者不需要应用源码、Node/pnpm、构建镜像、创建 `main-us` 分支或安装 GitHub Runner。手动执行本说明中的命令即可；共用逻辑由安装器完成，每台机器只填写一份私密 `.env`。

本说明的“本机”指上传安装包的电脑，“服务器”指通过 SSH / 阿里云 Workbench 登录的目标 Linux 主机。每个代码块单独执行，不复制提示符，不把相邻命令拼成一行。

## 0. 准备什么、交给部署者哪些文件

| 内容 | 由谁提供 / 用途 |
|---|---|
| 服务器 root 登录方式 | 运维提供；SSH 或已登录的 Workbench 均可。 |
| 公网域名、服务器 IP | 运维提供；域名用于 HTTPS、登录和业务验收。 |
| 五个镜像共同的实际 tag | 发布者提供；api、web、deep-agent、skill-sandbox、postgres-age 必须同源同版本。 |
| 仓库公网地址、只读拉取账号 | 发布者提供；US 主机使用公网地址，不使用 `-vpc` 地址。 |
| 模型地址、模型 ID、API Key | 模型服务方提供；须支持 OpenAI-compatible Chat Completions、流式输出及 Agent 所需工具调用。 |
| `workspacex-install.tar.gz`、`.sha256` | 维护者从本版代码打包；摘要经可信渠道核对。工具包不包含镜像和真实凭据。 |

部署者收到的压缩包只有一个操作入口：

| 包内文件 / 目录 | 用途 | 部署者是否修改 |
|---|---|---|
| `install.py` | 计划、安装、状态、验收、启停、备份入口 | 否 |
| `.env.example` | 配置示例，复制成 `.env` 后填写 | 只修改自己的 `.env` |
| `compose.yaml` | 七个服务的通用运行结构，只供查看 | 否；不要对它直接执行 `up` |
| `README.md` | 本操作说明 | 否 |
| `SHA256SUMS` | 包内文件校验清单 | 否 |
| `.runtime/` | 自动使用的脚本、模板和安全策略 | 否；上传、解压时必须完整保留 |

仓库中的 `deploy/us` 保留说明、示例配置和通用 Compose 视图；可执行程序统一维护在 `scripts/image_install/`，打包时自动装入 `.runtime/`。新增服务器不用复制一套脚本或新增几十个配置文件。

### 维护者打包（有源码的电脑上执行）

使用包含本次运行配置修复的版本重新打包，不能将旧安装包与本说明混用：

```bash
cd /Users/shenyangjun/boardx/workspacex
python3 -m unittest discover -s tests -p test_image_installer.py
python3 scripts/image_install/installer.py package --output deploy/us/dist
```

将 `deploy/us/dist/workspacex-install.tar.gz` 和同目录 `.sha256` 一起交付，并提供实际镜像 tag。安装包不含应用源码构建流程，服务端无需 clone 仓库。

## 1. 确认目标服务器、网络和 DNS

适用范围：**独占 Ubuntu 24.04 / 26.04 x86_64、systemd、Docker Engine、新版 Compose、AppArmor、同机 PostgreSQL/Redis、本地持久化文件、HTTPS**。共享主机、ARM、托管数据库、完全离线安装和多节点高可用需要另一份方案。

本次实际部署记录（供核对，不是其他客户的默认值）：

| 项目 | 本次值 |
|---|---|
| US 服务器 | `43.110.25.66` |
| 域名 | `appv1.boardx.us`（统一小写） |
| 五镜像 tag | `40216660127-1`；仅在该版本仍可获取且明确要部署它时使用 |
| 系统 / 工具 | Ubuntu 26.04.1 x86_64、docker.io 29.1.3、docker-compose-v2 2.40.3 |
| 安装目录 | `/opt/workspacex-installer` |

**本机执行：**

```bash
ssh root@43.110.25.66
```

其他服务器替换 IP。若超时，在本机检查 `nc -vz -G 5 43.110.25.66 22`（macOS）；同时从云控制台登录，检查 SSH 服务、安全组和系统防火墙。`ping` 成功只能说明 ICMP 可达，不能证明 TCP 22 可用。

**服务器执行：**

```bash
hostname
cat /etc/os-release
uname -m
ss -lntp '( sport = :80 or sport = :443 )'
free -h
df -h / /var/lib
```

模板容器内存上限合计约 12.5 GiB，这是上限之和，不是预留或最低容量结论。本次 7.5 GiB 主机通过了业务探针，但没有生产压测结论；长期部署需监控内存/OOM、数据增长和并发。

安全组/防火墙：SSH 仅允许运维来源，公网开放 TCP 80/443。不要公开数据库 5432、Redis 6379、应用 3000/3200 或 Agent 8000。服务器需能访问仓库、模型服务、系统软件源、证书服务及自己的公网 HTTPS 域名。

DNS 控制台配置：`A appv1 → 43.110.25.66`。本次首次安装使用 Cloudflare **仅 DNS（灰云）**；没有 IPv6 服务时不要保留失效的 AAAA 记录。本流程不包含安装后重新启用 Cloudflare 代理的验收。

```bash
getent ahostsv4 appv1.boardx.us
```

应返回目标 IP。若仍返回原 Cloudflare 代理地址，先确认记录已保存，再刷新服务器本地缓存：

```bash
resolvectl flush-caches
getent ahostsv4 appv1.boardx.us
```

如果仍不一致，核对权威 DNS 与递归缓存，不要用修改 `/etc/hosts` 掩盖公网解析问题。

## 2. 准备 Docker、Compose 和宿主机程序

以下在**服务器**以 root 执行。

先判断已有 Docker 来源：

```bash
docker --version
docker compose version
apt-cache policy docker.io docker-ce docker-compose-v2 docker-compose-plugin
```

本次使用 Ubuntu 软件源的 `docker.io`。全新主机选择这条路径：

```bash
apt-get update
apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker
```

如果已有 Docker 官方源的 Docker CE，继续使用其 `docker-compose-plugin`，不要混装两套 Docker。自定义 Docker 源安装方式参见 [Docker 官方 Ubuntu 文档](https://docs.docker.com/engine/install/ubuntu/)。安装器不会替你卸载或升级现有 Docker。

本次 `docker: unknown command: docker compose` / `unknown shorthand flag: 'p' in -p` 的原因是缺少 Compose，不是 Compose 文件错误。Ubuntu 源对应修复是 `apt-get install -y docker-compose-v2`。

```bash
docker compose version
docker compose run --help | grep -- --env-from-file
docker info --format '{{.ServerVersion}}'
```

三条都应成功。需要支持 `env_file.format=raw` 和 `run --env-from-file`，不要使用旧版 `docker-compose` 替代。

```bash
apt-get install -y python3 nginx apparmor apparmor-utils openssl util-linux curl
systemctl enable --now apparmor nginx
aa-enabled
nginx -T 2>/dev/null | grep -E '^# configuration file|^[[:space:]]*(listen|server_name)'
```

`aa-enabled` 应显示 `Yes`。Nginx 已监听 80 不一定冲突：本次只有默认站点，可以继续。若承载其他业务，停止使用这条独占主机流程；ACME 申请/续期会短暂停止 Nginx。

## 3. 上传、校验和解压安装包

**本机执行，以下是本次路径/IP；其他部署替换为自己的值：**

```bash
cd /Users/shenyangjun/boardx/workspacex/deploy/us/dist
scp workspacex-install.tar.gz workspacex-install.tar.gz.sha256 root@43.110.25.66:/opt/
```

`scp` 上传成功后，文件在**远程服务器 `/opt/`**；本机终端不会自动变成服务器终端。在 Mac 上 `cd /opt` 查看的是 Mac 的目录。

**切回服务器终端执行：**

```bash
cd /opt
sha256sum -c workspacex-install.tar.gz.sha256
install -d -m 0755 /opt/workspacex-installer
tar -xzf /opt/workspacex-install.tar.gz --strip-components=1 -C /opt/workspacex-installer
chown -R root:root /opt/workspacex-installer
chmod -R go-w /opt/workspacex-installer
cd /opt/workspacex-installer
sha256sum --quiet -c SHA256SUMS
```

外部摘要须与发布者通过可信渠道提供的值一致；仅下载包和配套摘要不能证明来源。外部校验应为 `OK`，内部校验成功时无输出。以上适用于**首次安装空目录**；已有实例不要通过重新解压/清目录来重装。

## 4. 填写唯一的实例配置

```bash
cd /opt/workspacex-installer
cp .env.example .env
chmod 600 .env
nano .env
```

| 键 | 必须替换的内容 / 示例 |
|---|---|
| `IMAGE_TAG` | 发布者提供的五镜像共同 tag。本次为 `40216660127-1`；不使用 `latest` 或占位值。 |
| `PUBLIC_DOMAIN` | 本次 `appv1.boardx.us`；其他部署填写自己的域名，不带协议、端口或路径。 |
| `ADMIN_EMAIL` | 真实首位管理员邮箱，也作为 ACME 证书通知邮箱；不可留空。 |
| `MODEL_BASE_URL` | 真实 HTTPS OpenAI-compatible 根地址，通常以 `/v1` 结束，不填写 `/chat/completions`。 |
| `MODEL_ID` | 该地址和凭据实际可用的模型 ID，需满足 Agent 工具调用要求。 |
| `MODEL_API_KEY` | 对应真实模型密钥；只写服务器私密配置，不发到聊天/issue。 |
| `REGISTRY_PREFIX` | 默认公网 `workspacex-cn-prod-registry.cn-shanghai.cr.aliyuncs.com/workspacex-prod`；仓库迁移时才替换。 |
| `REDIS_IMAGE` | 默认 `redis:7-alpine`，首次安装解析并固定实际 digest；也可提供已审核的 digest 引用。 |
| `ADMIN_NAME` | 首位管理员显示名，默认 `Administrator`。 |
| `ORG_NAME` | 新组织名称，默认 `Workspace`。 |

格式为 `KEY=value`、每项一行；允许成对引号，不支持 shell 变量展开，不加行尾注释。数据库口令、内部服务密钥、加密密钥、管理员初始密码由安装器生成，部署者不需手工配置。

```bash
python3 install.py plan --config .env
```

这是**计划预览**，不创建数据库、不启动服务、不生成管理员密码。因此此时执行 `status/start/backup` 或读取 `stable-secrets.json` 不代表安装已完成。确认输出列出五镜像及正确的 `https://appv1.boardx.us` 后再继续。

## 5. 登录仓库、复用已有镜像

以 root 登录公网仓库，交互输入维护者提供的只读账号和口令：

```bash
docker login workspacex-cn-prod-registry.cn-shanghai.cr.aliyuncs.com
docker image ls --format '{{.Repository}}:{{.Tag}}'
```

已经拉取的五镜像可直接复用；缺少的由安装器拉取并检查架构与 OCI source revision。Redis 是额外依赖，不属于五个正式应用镜像。不要为各镜像随意挑不同 tag。

### 维护者尚未发布镜像时：手动触发 image-release

已有完整正式镜像的部署者跳过本小节。发布者在 GitHub Actions 打开 `image-release` → `Run workflow`，按当前工作流配置选择：

| 输入 | 本次 US 手动部署的选择 |
|---|---|
| 分支 | `main`（选定要发布的正式代码）；不需要 `main-us`。 |
| `environment` | `cn` 或 `auto`，使用当前正式仓库配置；当前工作流没有 `us` 选项。 |
| `service` | `all`，发布五镜像完整集合。 |
| `build_only` | **必须勾选 true**，只构建/发布镜像，不执行工作流的主机部署。默认 false 会进入现有 CN 部署路径。 |
| `tag` | 新构建留空，采用工作流生成的 tag；输入已有 tag 表示复用已有发布，并非新建该名称。 |
| `source_revision` | 通常留空；只有明确需要精确基线时填写完整 SHA，且保持 build_only=true。 |

等待构建与完整集合聚合成功，核对发布结果中的实际 tag/source revision、五个镜像及仓库权限，再将 tag 写入服务器 `.env`。这里 `environment=cn` 选择的是当前正式发布环境，**US 服务器仍由第 6 节手动安装**；不触发 CN 主机部署靠的是 `build_only=true`，不能遗漏。工作流输入以仓库 `.github/workflows/image-release.yml` 为准。


## 6. 执行安装

**没有证书，本次使用 ACME：**

```bash
cd /opt/workspacex-installer
python3 install.py install --config .env --acme
```

**已经持有该域名的有效完整证书链和私钥，二选一：**

```bash
python3 install.py install --config .env --cert /root/fullchain.pem --key /root/private-key.pem
```

安装器按顺序完成：校验主机/镜像 → 生成稳定私密配置 → 创建数据与回执目录和 AppArmor 策略 → PostgreSQL/Redis → 独立数据库角色及迁移 → 管理员/组织/默认 Agent → 七个容器 → Nginx/TLS → 真实业务验收。

新版安装包自动配置以下共用项目，**不用部署者逐项修改**：

| 配置 | 为什么需要 |
|---|---|
| Web/API/探针一致的 UUID `WORKSPACEX_DEPLOYMENT_MARKER` | 验证访问的是同一部署；完整镜像 source SHA 另外保留，不混用。 |
| `KERNEL_MODEL_MAX_OUTPUT_TOKENS=4096` | Agent 模型调用准入要求明确输出上限；不是供应商模型最大上下文。 |
| Agent 持久用量 spool、内部回调和空闲重放 | 进程重启后仍可核对模型用量。 |
| API 持久 `WORKSPACEX_CREDIT_RECEIPT_DIR` | 生产计费准入/回执存储；缺失会拒绝模型调用。 |
| Nginx 白板同步正则加引号 | 避免 `{36}` 被解释成配置块。 |
| 数值 UID/GID 创建私密目录 | 不要求宿主机恰好存在名为 `1000` 的用户。 |

不要关闭计费准入、回执校验或 AppArmor 来获得“通过”。安装涉及真实模型调用和测试数据。迁移和证书续期测试需要时间；另一窗口查看日志即可，不要同时启动第二次安装。

## 7. 按层验收，确认真的能用

### 7.1 服务与 HTTPS

```bash
python3 install.py status
nginx -t
curl --fail --silent --show-error https://appv1.boardx.us/api/healthz
curl --fail --silent --show-error https://appv1.boardx.us/.well-known/workspacex-deployment
```

其他部署替换域名。应有七个服务运行：api、web、agent、sandbox、sandbox-sessions、postgres、redis；健康响应 `trustworthy: true`。这一步只证明服务/入口可达。

### 7.2 真实业务探针

首次 `install` 最后已经自动执行；只有需要复验时才单独运行：

```bash
python3 install.py verify
```

成功标志：

```text
Public health and login/file/Agent/model/sandbox probes passed. Complete browser acceptance in README.
```

`nginx -t`、证书续期 dry-run、图初始化或健康 HTTP 200 都不能替代这条业务验收。失败时先按下节定位，不要连续重复触发模型任务。

### 7.3 浏览器及重启验收

打开 `https://appv1.boardx.us/login`，使用 `ADMIN_EMAIL` 登录。管理员初始密码在服务器私密文件的 `admin` 项，本人终端读取：

```bash
python3 -c 'import json; print(json.load(open("/etc/workspacex-selfhost/stable-secrets.json"))["admin"])'
```

该命令会在终端显示密码，不截图、不粘贴到聊天/issue，避免共享屏幕时执行。

浏览器必须逐项完成：登录 → 发真实对话收到回复 → 刷新仍有历史 → 上传文件并读取 → 生成文件、下载后实际打开。再在维护窗口重启服务器，确认七个服务和 AppArmor 恢复、历史及文件仍在，并复验业务。**重启验收未做时，不写“已通过重启验收”。**

## 8. 日常操作与文件在哪里

在服务器 `/opt/workspacex-installer` 执行：

```bash
python3 install.py status
python3 install.py logs
```

需要停机或恢复时分别执行（不是安装后的固定连续步骤）：

```bash
python3 install.py stop
```

```bash
python3 install.py start
```

只查一个服务时使用实际生成的 Compose，而不是包内通用视图：

```bash
docker compose -p workspacex-selfhost --env-file /etc/workspacex-selfhost/compose.env -f /etc/workspacex-selfhost/compose.json logs --tail 100 agent
```

| 服务器路径 | 内容 / 维护原则 |
|---|---|
| `/opt/workspacex-installer/.env` | 本机安装输入，权限 600；普通改动不会自动更新已安装实例。 |
| `/opt/workspacex-installer/.runtime/.local/runtime/` | 首次私密暂存与稳定密钥，失败重试时复用，勿删除。 |
| `/etc/workspacex-selfhost/` | 生成的运行 env、Compose、稳定密钥、证书和 socket 配置。 |
| `/etc/workspacex-selfhost/stable-secrets.json` | 稳定数据库/加密/服务密钥与初始管理员密码，须加密离机备份。 |
| `/var/lib/workspacex-selfhost/{postgres,redis,objects}` | 数据库、缓存、用户对象文件。 |
| `/var/lib/workspacex-selfhost/{agent-usage,credit-receipts}` | Agent/API 持久用量回执；不可清空“消除报错”。 |
| `/var/lib/workspacex-selfhost-state/` | 初始化标记、探针结果、验收标记与不确定状态。 |
| `/etc/apparmor.d/workspacex-native-sessions` | 重启自动加载的沙箱策略。 |
| `/etc/nginx/conf.d/workspacex-selfhost.conf` | 站点 TLS、流式和 WebSocket 代理。 |
| `/var/lib/workspacex-selfhost/backups/` | 本地备份输出，仍需离机保存。 |

## 9. 备份、更新与恢复边界

全部服务正常运行时执行：

```bash
python3 install.py backup
```

会短暂停应用，备份三个数据库、对象文件、Agent/API 回执目录、运行配置/密钥和真实镜像摘要，再恢复应用。核对输出目录中的 `SHA256SUMS`，加密后离机保存。Redis 登录会话/缓存不在恢复承诺中；只备份数据库而丢失稳定密钥无法构成完整恢复。

当前入口面向**新实例安装**，不提供通用自动升级、还原或数据库回滚命令。恢复需在隔离服务器验证数据、回执目录、相同稳定密钥、镜像摘要和证书，成功前不要覆盖运行实例。升级需维护者给出目标版本的迁移/回滚方案；修改 `.env` tag 后重跑安装不等于升级，换回旧镜像也不能撤销 SQL。

## 10. 失败时按阶段处理

| 现象 | 原因 / 下一步 |
|---|---|
| SSH 超时、ping 正常 | 检查 TCP 22、安全组、SSH 监听和系统防火墙；可使用 Workbench，不需重新上传/重装应用。 |
| `docker compose` 不存在 / `unknown shorthand flag: p` | Compose 缺失；Ubuntu docker.io 路径安装 docker-compose-v2，验证版本及 env-from-file 支持。 |
| `Requires Ubuntu 24.04 x86_64`，实际是 26.04 | 旧安装器；取得支持本机版本的新包，不修改 OS 版本或跳过检查。 |
| `Fill ADMIN_EMAIL` | 填写 `.env` 中真实管理员邮箱；plan 成功不等于 install 成功。 |
| 镜像 401/不存在/来源不一致 | 核对 root 仓库登录、公网 registry、namespace、共同 tag、架构和完整 OCI revision。 |
| DNS 仍返回代理地址 | 检查 Cloudflare 灰云、保存结果和缓存，按第 1 节处理。 |
| Nginx `unknown directive "36}/sync$"` | 旧模板未给正则加引号，新包已修复；已有实例由维护者保留备份后修正生成配置并执行 nginx -t。 |
| 部署 marker 503/不一致 | 旧包缺 Web marker 或将 SHA 当 UUID；不要改变 settings.json 的镜像 sourceRevision 来凑通过。 |
| Agent 缺 MAX_OUTPUT_TOKENS、spool 初始化失败 | 旧包漏了模型输出上限或持久回执目录；核对容器实际 env、挂载、UID/GID 和 0700 权限。 |
| 模型直连成功，Agent 报 APIConnectionError | 还需检查 Agent 堆栈及内部准入；本次底层为 credit_accounting_unavailable，API 漏配生产回执目录，不能仅凭异常名判断公网网络。 |
| usage_idle_receipt_delivery_unconfirmed | 回执未确认；保留 spool，核对 API 回调、鉴权、准入及账本，不清空队列。 |
| stable-secrets.json 不存在 | 只有 plan 或安装尚未进入配置生成，先确定阶段。 |
| 已有部分初始化 / started 标记 | 保留现场；先核对已完成 DDL、稳定密钥和数据，不能删标记、数据目录后重跑。 |
| verify 退出 79 / business-probe-uncertain | 按下述“探针重试”处理，不直接删除标记。 |

### 探针重试与旧实例

本次 `verify` 退出 79 是验收器无法证明远端清理状态的保护结果，**不等于每次都有远程任务仍在运行**。探针并行检查多个组件，通用错误不会直接指出根因。

维护者先按同一时间段核对：API 的 `agent run model call failed`、Agent 堆栈、业务库 `agent_runs`、`native_session_bindings`，以及 Agent 库 `wsx_agent_runs`。确认相关本地/远程任务都已进入终态、绑定已释放、失败原因已修复，才可在 `/run/workspacex-selfhost-deploy.lock` 同一部署锁下**归档** `business-probe-uncertain`，保留原文件及诊断证据，再只执行一轮 `verify`。不要把无条件移动标记写进日常重试脚本。

旧包已经生成的 `/etc/workspacex-selfhost` 不会因更新安装包自动修正。维护者应先备份并核对实例状态，再将所缺运行 env、持久目录/挂载、marker、Nginx 配置按实例修复；只重建受影响容器，禁止旋转稳定密钥或重跑已完成的数据库初始化。本次 `43.110.25.66` 已完成这些运行配置修复，不需重新安装。

只有初始化**之前**遇到 Ubuntu 26.04 `install: invalid user: 1000`，且数据/状态目录完全为空时，新包提供受限恢复：

```bash
python3 install.py recover-host-setup --config .env
```

它校验原配置、暂存密钥、空数据/状态、无本项目容器及无策略/入口文件，然后将早期半成品私密归档，不删除数据、不生成新密钥。拒绝恢复时停止并交由维护者处理。该命令不适用于已有业务数据的实例。

## 11. 本次已验证与未验证边界

2026-10-26，`43.110.25.66 / appv1.boardx.us` 在保留原镜像和稳定密钥、补齐上述运行配置后，`python3 install.py verify` 输出第 7.2 节成功信息，覆盖公网健康、真实登录、文件、Agent、模型和沙箱。浏览器登录页可正常加载。

这些是本次**修复后的实例**证据。修复已回写共用模板，并有离线生成/打包回归检查；不据此声称新版包已在另一台空主机从零重装验证。完整浏览器登录后操作、重启恢复、备份还原、并发压测仍须按交付清单实测。

邮件发送、ASR、受控浏览器、第三方连接器和客户数据迁移不在本基础镜像安装范围内。管理员可登录不代表邮件验证和找回密码已配置；新增这些能力需单独配置并验收，不复用其他生产环境凭据。
