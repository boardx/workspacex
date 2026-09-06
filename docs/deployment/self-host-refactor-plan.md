# 开源自托管重构计划——「5 分钟起一套可用的 workspacex」

> 状态:提案(未实施)。本文档定义目标状态与分阶段落地计划;
> 落地时每个阶段拆成独立 issue + PR,遵循 AGENTS.md 的 ad-hoc 改动规则
> (验证跑绿自动开 PR,不合并多个 feature)。
>
> 配套文档:重构完成后,`docs/deployment/QUICKSTART.md` 是面向最终用户的发布文档,
> 描述的是**本计划落地之后**的状态,现在读会发现有些命令还不存在——这是预期的,
> 它是目标态说明书,不是现状说明书。

## 一、现状是给谁用的,不是给谁用的

读完 `.harness/scripts/vm/provision.sh`、`deploy.sh`、`backend-gates.yml` 之后,
结论很明确:**这套 DevOps 是给"团队有一台常驻 VM + GitHub self-hosted runner +
愿意手动 SSH 上去 provision 一次"这种场景设计的**,处处合理,但每一处合理都在
垒高一个开源新用户的门槛:

| 现状 | 为什么当初这样做合理 | 为什么开源新用户过不去 |
|---|---|---|
| `provision.sh` 要 root、要新建系统用户、要装 systemd unit、要装 Caddy | 团队长期维护一台机器,systemd 重启策略、Caddy TLS 终结都是长期收益 | 新用户可能只想在自己笔记本或一台云主机上跑起来看看,不想被建系统用户、写 sudoers |
| 部署靠 GitHub Actions self-hosted runner + sudoers 免密单条命令 | 防止「PR 改部署脚本等于拿到 root」这类真实发生过的供应链风险 | 新用户没有、也不需要为一次自托管专门接 GitHub runner |
| `deploy.sh` 里 API/Web 是**宿主 systemd 进程**,只有依赖服务(PG/MinIO/Redis/sandbox)在 Docker 里 | 历史上先有 compose 后加的服务,systemd 重启策略当时已经跑顺 | 「装 Node 22 + pnpm + systemd unit」比「docker compose up」重得多,是 5 分钟目标的最大绊脚石 |
| 必填 env 分散在 3 处发现:`provision.sh` 生成的模板注释、`verify-required-env.ts` 的运行时探测、`deploy.sh` 里散落的显式检查(如 `KERNEL_DEEP_AGENT_MODEL_ID`) | 每处都是真实事故催生的,各自局部合理 | 新用户没有一份**开工前**就能看完、一次性收集齐的清单,只能"填一点、崩一点、看日志、再填一点" |
| clone 地址、部署 key 都假设 `git@github.com:boardx/workspacex.git` | 内部项目,写死没问题 | fork 出去的开源用户第一步就要手改脚本 |
| 域名(`PUBLIC_DOMAIN`)是必填项,TLS 靠 Caddy 自动签证书 | 生产环境必须有域名 + HTTPS | 本地试用/纯内网场景不该被要求先买域名、开 80/443 |

**这不是说现有方案错了**——devapp 这条路径继续服务"团队自建 CD 到常驻 VM"这个真实场景,
本次重构不动它。要新增的是**第二条路径**:面向"任何人在任意一台机器上,不接 CI、
不建系统用户,跑一条脚本 + 一份 `.env` 就能用"的自托管路径。两条路径共享同一套
compose 依赖服务定义与同一份迁移/backfill 脚本,不重复实现。

## 二、目标状态(5 分钟部署长什么样)

```bash
git clone https://github.com/<your-fork>/workspacex.git
cd workspacex
./setup.sh                 # 交互式问答,或用 --env-file 非交互喂答案
# → 生成 .env.selfhost(0600)
# → docker compose -f docker-compose.selfhost.yml up -d
# → 等待迁移 + 健康检查
# → 打印:「打开 http://localhost:3100,用 <你填的邮箱> 登录」
```

用户在开工前只需要回答**五类问题**(细节见下方"用户需要准备什么"),其余全部由
脚本推导或自动生成。这是本计划最重要的单一改动:**把"必需 env 是什么"从三处
隐性来源收拢成一份显式清单 + 一个交互脚本**,不再让用户靠"部署崩溃—看日志—填一个
—再崩溃"这种方式发现配置项(这正是 `verify-required-env.ts` 当初为**单台内部机器**
解决的问题,现在要把同一个原则前移到"用户填表"这一步,而不是"部署到一半才报")。

## 三、用户需要准备什么(发布文档的核心,先在这里定稿)

### 必填(不给就跑不起来)

| # | 信息 | 做什么用 | 怎么获取 | 脚本行为 |
|---|---|---|---|---|
| 1 | 管理员邮箱 | 系统第一个组织的超级管理员账号(`PLATFORM_SUPERUSER_EMAILS`) | 你自己的邮箱 | 直接写入,不做校验发信 |
| 2 | 管理员初始密码 或 留空自动生成 | 首次登录凭据 | 你自己定 | 留空则 `openssl rand` 生成并在终端打印一次(不写日志文件) |
| 3 | 模型服务信息三件套:Base URL / API Key / 模型 ID | 聊天、通用助手、图片生成、语音转写背后的推理服务——**没有这三个,发消息拿不到任何回复** | 任选一个 OpenAI 兼容网关(阿里云百炼/DashScope、OpenAI、自建 vLLM 网关等),从其控制台取 | 三个都必填;脚本内置一个"推荐默认"(DashScope 兼容端点),用户可直接回车用默认再自己去开通,也可以填自己的 |
| 4 | 访问方式:localhost / 局域网 IP / 已有域名 | 决定生成的访问 URL、要不要开 TLS | 你自己决定 | 选 localhost→纯 HTTP、无需公网;选域名→额外问是否要脚本用 Caddy 自动签证书(需要该域名已解析到本机公网 IP 且 80/443 可达) |

### 可选(不给也能跑,只是某个功能不可用,脚本会明确告诉你缺什么、影响什么)

| # | 信息 | 做什么用 | 不给的后果 |
|---|---|---|---|
| 5 | 发信凭据(如 Cloudflare Email / 任意 SMTP 网关的 API Token + 发信域名) | 用户注册时的邮箱验证邮件、密码找回邮件 | 不给:脚本自动打开"开发直通模式"(见 `.harness/instructions/dev-mode-testing.md` 的既有机制)——注册不需要真的收邮件,验证码在页面上直接可见。适合个人自用/评测;多人共享实例建议补上 |
| 6 | LangSmith 三件套(Tracing 开关/API Key/Project) | 通用助手每次运行的可观测 trace | 不给:tracing 关闭,功能不受影响,只是排障时看不到 trace |
| 7 | 对象存储根目录路径 | 用户上传的头像/文件落盘位置 | 不给:使用默认 `./data/objects`(与 compose 卷绑定,重启不丢;不像现在文档里警告过的 `/tmp` 那种误配) |

### 完全不需要用户操心(脚本自动生成,不问)

- `MODEL_CREDENTIAL_KEY`(模型凭据加密密钥)
- `EMAIL_VERIFICATION_SECRET`
- 数据库密码(`APP_DB_PASSWORD` / `MIGRATION_DB_PASSWORD` / `DIAG_DB_PASSWORD`)
- 对象存储访问密钥(自托管 MinIO 的 access/secret key)
- 沙箱 socket 路径、宿主 uid/gid 对齐

这一节(必填 5 项 + 可选 3 项 + 自动生成清单)就是重构后 `QUICKSTART.md` 的"开工前
准备"一节的定稿内容,不需要再单独维护第二份。

## 四、分阶段落地计划

每个阶段独立可发布、独立验证,不要求一次做完;阶段之间不互相阻塞对外沟通
("我们在做这件事"可以先说,但不代表下一阶段已经在做)。

### 阶段 0 — 收拢必需 env 的单一事实源(先做,风险最低)

- 新增 `.harness/scripts/lib/required-config.ts`(或等价单文件),把当前分散在
  `verify-required-env.ts`(运行时探测)、`provision.sh`(生成模板注释)、
  `deploy.sh` 里散落的显式 `KERNEL_DEEP_AGENT_MODEL_ID` 等检查,收敛成**一份
  声明式清单**:`{key, purpose, required, defaultBehavior}`。
- `verify-required-env.ts` 与新的 `setup.sh` 问答脚本都读这同一份清单,不再各自
  维护一份"必填项是什么"的认知——这正是 AGENTS.md 反复强调的"同一事实不得声明
  在两处"。
- 产出:一份机器可读的清单文件 + 一份从它生成的人类可读表格(即上面第三节),
  CI 加一条门控断言两者一致,防止未来再次漂移。

### 阶段 1 — 容器化 API / Web(移除"必须在宿主装 Node/pnpm/systemd"这一约束)

- 新增 `apps/api/Dockerfile`、`apps/web/Dockerfile`(生产多阶段构建,`deep-agent-service`
  已有的 Dockerfile 是现成参考)。
- 新增 `docker-compose.selfhost.yml`:在现有 `apps/api/docker-compose.deploy.yml`
  (PG/MinIO/Redis/sandbox)基础上,加入 `api`、`web`、`deep-agent` 三个服务容器,
  一条 `docker compose up -d` 起完整栈。
- 迁移、backfill、密码对齐这些 `deploy.sh` 里的步骤,抽成一个 `entrypoint.sh` 或
  一次性 `migrate` 容器(`docker compose run --rm migrate`),保留"迁移先于服务
  启动且幂等"这条硬规则,只是把执行位置从"宿主 systemd 前置步骤"搬进容器编排。
- **这是最大的一块工作**,理由见第一节表格第 3 行——不做这一步,"5 分钟"目标
  达不到,因为光装 Node 22 工具链就不止 5 分钟。
- devapp 现有的 systemd 路径**不删除、不强改**:两条路径共享同一份
  `docker-compose.deploy.yml` 依赖服务定义与迁移脚本,新路径是叠加,不是替换。

### 阶段 2 — `setup.sh` 交互式向导

- 按第三节的五项必填 + 三项可选问答,生成 `.env.selfhost`(0600)。
- 支持非交互模式(`./setup.sh --answers answers.env`),方便脚本化/CI 场景。
- 生成完 env 后自动:`docker compose -f docker-compose.selfhost.yml up -d` →
  轮询健康检查(复用 `deploy-readiness.sh` 里已经验证过的"连续稳定样本"逻辑,
  不重新发明)→ 打印访问地址与管理员登录方式。
- 失败时的诊断复用阶段 0 的清单:哪一项没填、它影响什么、该去哪填,一次性列全
  (与 `verify-required-env.ts` 当初解决"一次崩溃只发现一个变量"是同一个原则)。

### 阶段 3 — 域名/TLS 可选化

- `setup.sh` 问到"访问方式"时,选 localhost/IP → 生成不带 Caddy 的 compose
  override(直接暴露 web/api 端口);选域名 → 生成带 Caddy 自动签证书的 override
  (复用 `provision.sh` 里已经踩过坑的 Caddyfile 路由规则,尤其是 CopilotKit 那三条
  必须排序正确的 handle 块,不重新踩一遍)。

### 阶段 4 — 开源身份去耦合

- clone 地址、部署 key 等不再硬编码 `boardx/workspacex`;`setup.sh` 从
  `git remote get-url origin` 自动推导,或允许显式传参。
- `PROJECT.md` 的"部署面"表格改为模板占位 + 一份"如何为你自己的 fork 填写"的
  说明,而不是假设填的人就是本仓库维护者。

### 阶段 5 — 发布文档定稿 + 端到端演练

- 在一台全新的干净虚拟机(不是任何现有开发机)上,从 `git clone` 到
  "打开浏览器登录发出第一条消息"完整走一遍,记录真实耗时。
- `QUICKSTART.md` 按演练结果定稿,时间数字必须是实测值,不是估算
  (同 AGENTS.md「静态痕迹 ≠ 动态事实」的精神——文档里的"5 分钟"必须是量出来的)。

## 五、明确不做的事(避免范围蔓延)

- 不在这次重构里引入 k8s/Helm——architecture.md 定义的"多云容器"形态已经支持
  同一份镜像跑 k8s,新增 Helm chart 是独立的后续需求,不与"5 分钟单机自托管"
  这个目标混在一次改动里。
- 不改动 devapp 现有的 CI/CD 触发方式或 systemd 部署路径。
- 不把"发信凭据可选"这件事悄悄扩大成"生产环境也可以不验证邮箱"——开发直通模式
  的适用边界(个人自用/评测 vs 多人共享实例)在发布文档里必须写清楚,不是默认
  推荐给所有场景。
