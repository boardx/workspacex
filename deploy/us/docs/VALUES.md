# 配置值与替换规则

## 唯一人工输入

复制 `config/settings.example.json` 为 `.local/settings.json`，只编辑副本。`REPLACE_` 都必须替换；其余默认值可按下表修改。`configure.py` 会拒绝未填占位值、非法域名、非摘要 Redis 镜像和已有输出目录。

| JSON 键 | 应填内容 |
|---|---|
| `repository` | GitHub 仓库 owner/repo；默认 boardx/workspacex。独立部署者改成其维护的仓库，必须已含本包 US 补丁。 |
| `domain` | US 对外域名，如 us.your-company.com；只填小写主机名，不带 https://、端口或路径。DNS A 指向主机公网 IP；没配置 IPv6 就不要保留失效 AAAA。 |
| `registryPrefix` | 同一镜像实例的公网主机名/命名空间，不带协议及结尾斜杠。五个仓库名固定 api、web、deep-agent、skill-sandbox、postgres-age。 |
| `releaseTag` | 真实已发布的完整镜像集合 tag，如 40174623496-1；不能随便取名字。旧 SHA-run-attempt tag 兼容。 |
| `sourceRevision` | 上述镜像的完整 40 位提交 SHA，从 release.json 和 OCI revision 双重核对，不能从短 tag 猜。 |
| `redisImage` | Redis 完整镜像@sha256:64位摘要；由维护者验证使用的版本、持久化与备份兼容性后提供，不能填写浮动 latest。 |
| `runnerUser` | 服务器 Runner 用户，默认 ghrunner；脚本创建普通用户，不加入 docker 组。 |
| `runnerName` | 该仓库唯一的 Runner 名称，只含字母、数字、下划线和连字符。 |
| `runnerArchiveUrl` | 从目标仓库 Settings → Actions → Runners → New self-hosted runner 的 Linux x64 安装说明取得官方 archive URL。 |
| `runnerArchiveSha256` | 同一安装说明提供的 archive SHA256，64 位小写十六进制，必须与 URL 对应；不要将下载后自行计算的值当独立来源验证。 |
| `adminEmail` | 初始管理员邮箱；也是可选 ACME 证书通知邮箱。不自动配置邮件发送。 |
| `adminName` | 管理员显示名，可保留 Administrator，可用空格；不能换行。 |
| `orgName` | 初始组织名，可保留 Workspace US；不能换行。 |
| `modelBaseUrl` | 经运维验证可从 US 主机访问的 HTTPS OpenAI-compatible 服务根地址，如 https://provider.example/v1；不带密钥和查询参数。 |
| `modelId` | 上述服务实际支持的模型 ID；配置生成不证明该模型能调用。 |
| `modelApiKey` | 模型服务真实 API key，只填本机 .local/settings.json，通过私密渠道传输；不要写回 example 或 Git。 |

输入文件和生成目录包含凭据，权限分别为 0600 和 0700。JSON 字符串中的双引号、反斜杠按 JSON 语法转义；不允许换行。运行时 `.env` 是 Docker 配置，不要在 shell 中 `source`。

## 需要通过命令/私密文件另外提供的值

| 值 | 放在哪里/从哪里取得 | 处理规则 |
|---|---|---|
| US 公网 IP、SSH 用户、SSH 密钥 | 运维资产记录；用于 RUNBOOK 的 scp/ssh | 不参与应用配置。示例 `US_HOST`、`SSH_USER` 都要换成实际值；先核对 SSH host key。 |
| 镜像只读用户名/口令 | 维护者授权的私有仓库只读账号 | 在 US root 会话 `docker --config ... login` 交互输入；不可使用镜像推送写入账号。 |
| 构建用 ACR 用户名/口令 | GitHub Repository Secrets `WSX_ACR_USERNAME` / `WSX_ACR_PASSWORD` | 维护者配置；服务器不持有写入凭据。 |
| 构建仓库主机/前缀 | Repository Variables `WSX_ACR_REGISTRY` / `WSX_REGISTRY_PREFIX` | 构建 job 不进入 production-us，所以不能只放 Environment 层。必须与 settings 的仓库对应。 |
| 基础镜像摘要覆盖（可选） | Repository Variables `WSX_NODE_IMAGE` / `WSX_PYTHON_IMAGE` / `WSX_POSTGRES_IMAGE` | 不设则现有 producer 解析默认基础镜像摘要；设置时使用完整 `@sha256` 引用。 |
| Runner 注册 token | 本机 `.local/runner-registration-token` → US `/root/runner-registration-token` | 用 `gh api --method POST repos/OWNER/REPO/actions/runners/registration-token --jq .token` 取得；短期有效，过期重新取；服务器文件 root:root 0600，安装后删除。不是 PAT。 |
| TLS fullchain / private key | 自备证书，或 `25-certificate.sh` | 域名匹配、未过期、证书与私钥匹配；脚本安装为 `/etc/workspacex-us/tls/`，密钥 0600。 |
| 交付包 SHA256 | 维护者独立可信渠道 | 在解压/执行前核对；不要只信与包一起被篡改的 checksum。 |
| 后续发布 tag | Actions 构建输出及 release.json | 手动发布时留空=构建所选 main-us；填已有 tag=部署已有集合，其 SHA 可与 workflow ref 不同，要核对实际 manifest。 |
| 恢复备份路径 | 由 `backup.sh` 生成并安全离机保存 | 必须校验 SHA256SUMS、测试恢复；备份含密钥和客户数据，不能随公开部署包发。 |

## 自动生成的稳定值：不需要人工填写

`configure.py` 使用系统安全随机数生成独立的 32 字节十六进制秘密；一次配置只生成一次，输出已存在即拒绝覆盖。`stable-secrets.json` 是备份恢复需要保留的秘密；不能每次发布重新生成。

| stable-secrets 键 | 写入哪些实际配置 | 用途/一致性 |
|---|---|---|
| `owner` | postgres.env POSTGRES_PASSWORD；migration.env MIGRATION_DB_PASSWORD | 数据库迁移所有者 postgres；不可给常驻 API。 |
| `app` | api/migration/bootstrap/probe.env APP_DB_PASSWORD | API 受限角色 app_rw 的同一口令。 |
| `diag` | api/migration/bootstrap/probe.env DIAG_DB_PASSWORD | 独立诊断角色 app_diag_ro；不可合并为 app_rw。 |
| `agent` | migration.env AGENT_DB_PASSWORD；agent.env DATABASE_URI / DEEP_AGENT_CHECKPOINT_DB | 独立 workspacex_agent 数据库，角色 agent_server。 |
| `memory` | migration.env MEMORY_DB_PASSWORD；agent/memory-migration.env MEMORY_STORE_DATABASE_URL | 独立 workspacex_memory 数据库，受限角色 memory_rw。 |
| `memoryOwner` | migration.env MEMORY_DB_OWNER_PASSWORD；memory-migration.env MEMORY_STORE_MIGRATION_DATABASE_URL | 记忆 schema 所有者 memory_owner；不注入常驻 Agent。 |
| `redis` | redis.conf requirepass；agent.env REDIS_URI | Agent 的 Redis DB 1；不对公网暴露。 |
| `modelCipher` | api/probe.env MODEL_CREDENTIAL_KEY | 存量加密模型凭据的解密密钥；重生成会使存量凭据不可读。 |
| `emailVerification` | api/probe.env EMAIL_VERIFICATION_SECRET | 邮箱验证签名；不等于已配置邮件服务。 |
| `nativeBinding` | api/probe.env NATIVE_SESSION_BINDING_KEY | 原生会话绑定签名。 |
| `serviceKey` | API/Agent/probe 的 DEEP_AGENT_SERVICE_INTERNAL_KEY；Agent NATIVE_SESSION_SERVICE_KEY | 服务间调用同一共享 key。 |
| `admin` | bootstrap/probe.env PROVISION_ADMIN_PASSWORD | 初始管理员登录口令；从私密文件查看，部署后应安排专用验收账号，更新探针凭据也需重新审核哈希。 |

## 自动输出文件中的固定/派生值

这些值由脚本生成，**默认不逐个手工替换**。改变部署档位、目录或数据库拓扑要改生成逻辑并重新验收，不能只改一个文件。

| 文件/值 | 来源与含义 |
|---|---|
| compose.env `API_IMAGE`/`WEB_IMAGE`/`AGENT_IMAGE`/`SANDBOX_IMAGE`/`POSTGRES_IMAGE` | registryPrefix + 固定仓库名 + releaseTag；初始化后普通发布由受信 consumer 生成不可变 override；不要手工改初始 compose.env。 |
| compose.env `REDIS_IMAGE` | settings.redisImage；应用发布不替换 Redis。 |
| API `PGHOST/PGPORT/PGDATABASE/PGSSLMODE` | `postgres:5432/workspacex`，同一 Docker 网络内通信，disable 只适用于本包同机档位；不可直接用于公网数据库。 |
| `APP_DB_USER` / `DIAG_DB_USER` / `MIGRATION_DB_USER` | 固定 app_rw / app_diag_ro / postgres；权限分离。 |
| `AGENT_DB_*` / `MEMORY_DB_*` | migration.env 中用于首次创建独立 DB/角色的固定名称及上述密钥。 |
| API `APP_PUBLIC_URL`、probe `PROVISION_PUBLIC_URL` | https:// + domain。 |
| API/probe `KERNEL_MODEL_*` | modelBaseUrl/modelId/modelApiKey；stream=1，provider=openai-compatible。 |
| `KERNEL_DEEP_AGENT_BASE_URL` / `KERNEL_SUBTASK_CALLBACK_BASE_URL` / `NATIVE_SESSION_SERVICE_BASE_URL` | 容器网络的 agent:8000、api:3200；无需开放到公网。 |
| `KERNEL_NATIVE_RUNTIME` / sandbox socket / NATIVE_SESSION_SOCKET | 启用原生运行与两个隔离的 Unix socket 挂载。 |
| `WORKSPACEX_OBJECT_STORE` / `WORKSPACEX_OBJECT_ROOT` | fs / /var/lib/workspacex/objects；映射到宿主 `/var/lib/workspacex-us/objects`。API 不设置 WORKSPACEX_DEPLOY_PROFILE；否则 cloud profile 会强制 OSS。 |
| `WORKSPACEX_DEPLOYMENT_MARKER` | 初次 sourceRevision 作为稳定安装标记；不随普通镜像更新改变，不能当当前运行版本证明。当前版本必须读实际 image ID/revision/receipt。 |
| Web `NODE_ENV/PORT/API_INTERNAL_URL` | production / 3000 / http://api:3200；镜像构建时公共 API 已固定为同源 /api。 |
| Agent `DATABASE_URI/REDIS_URI/DEEP_AGENT_CHECKPOINT_DB` | 固定独立 DB/Redis DB 1 + 生成口令；memory DB 与 Agent DB 分开。 |
| `MEMORY_STORE_SCHEMA` | workspacex_memory；只有初始化/显式迁移使用 memory-migration.env 中的 owner 连接。 |
| `PROVISION_ADMIN_EMAIL/NAME/PASSWORD/ORG_NAME` | 输入值和生成的 admin 口令，创建第一位管理员与默认 Agent。 |
| migration.env `WORKSPACEX_DEPLOY_PROFILE=starter` | 仅首次建角色脚本的准入，不用于把 API 伪装为 cloud/OSS 部署。 |
| `PROVISION_TIMEOUT_MS` | memory migration=240000；业务探针=90000；consumer 总 readiness 上限 120 秒，超时按失败处理，不强行放宽原门控。 |
| probe `PROVISION_ORG_ID/PROVISION_DEFAULT_AGENT_ID` | 渲染时为 FILL_FROM_BOOTSTRAP；20-bootstrap 自动从真实 bootstrap-admin.json 写入；不需要人手猜 UUID。恢复时用原备份值。 |
| `us.json` 中的文件 sha256 | 40-accept 在业务验收后由 seal-policy.py 计算；不可填写示例 hash 或编辑运行配置后直接重封假装已验收。 |
| `us.json` 固定部署字段 | environment=us，project=workspacex-us，lock=/run/workspacex-us-deploy.lock；业务探针是固定 root-owned 文件，current.json 仅成功后更新。 |
| provenance.json | 模板来源文件的真实 SHA256；打包发现来源变化会拒绝，维护者审查并再生成快照后更新，不是部署输入。 |
| github/us-support.patch | 固定 main-us→us→production-us→workspacex-us-production；其他部署者更换 repository 即可，不能在同仓库复用标签指向不同客户。 |

## 可选能力与其它部署档位

- 邮件：应用已支持 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_EMAIL_API_TOKEN`、`MAIL_FROM`、`CLOUDFLARE_EMAIL_SENDING_DOMAIN`、`CLOUDFLARE_EMAIL_PREVIEW_DISABLED=true`。必须先完成供应商域名验证，再将真实值放私密 api.env 并验收；这些不是本包默认开通项。
- ASR：`KERNEL_ASR_PROVIDER/BASE_URL/API_KEY/MODEL` 及可选 `KERNEL_ASR_RECORDING_TURN_SILENCE_MS`。需要供应商配套，不能只放一个 key 就声明可用。
- OSS：当前代码要求 `OSS_REGION/BUCKET/ENDPOINT/PREFIX/AUTH_MODE`，环境认证方式还需对应 SDK 凭据；ECS role 方式需真实 RAM role。要切换应使用仓库 cloud-deploy 配置契约和真实地域资源，不能照抄 CN 域名、bucket 或默认本地 fs 配置。
- 托管数据库：需重新准备 TLS、CA、应用/迁移/Agent/Memory 角色、独立数据库、挂载与预检。此包恢复/初始化脚本只适配本机 PostgreSQL，不适配托管数据库。
- 录音、受控浏览器、第三方连接器和客户数据迁移：需要各自配置及真实验收，未包含在默认基础安装成功声明中。
