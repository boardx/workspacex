# 开源收尾：只能由人完成的动作（执行书）

> 适用分支：`claude/open-source-business-model-oqdjzf`（PR #4065）合入 `main` 之后。
> 每一项都对照过实际代码：命令、文件路径、环境变量名都是仓库里真实存在的。
> 本文**不含任何凭据值**；凡是 `<…>` 都是占位，由你填入。公司名称、邮箱一律不在本文里猜。

## 一屏清单（按「解锁得最多」排序）

| # | 动作 | 解锁什么 | 预计耗时 |
|---|---|---|---|
| 1 | [审阅并合入 PR #4065](#10-审阅并合入-pr-4065) | 下面所有项的代码前提 | 30–60 分钟 |
| 2 | [确认凭据扫描命中（先看 `aliyun-ak` 2 处）](#9-确认凭据扫描命中) | 仓库能否公开（硬阻塞） | 1–3 小时（真凭据需轮换则更长） |
| 3 | [填权利人名称、商标邮箱（可选：安全邮箱、NOTICE）](#2-权利人名称联系邮箱安全联系人) | 商标政策、NOTICE、B8 收尾 | 组织决定后 5 分钟 |
| 4 | [`fabric-markdown` 上游许可](#8-fabric-markdown-许可问题) | B6 最后一个未定包 | 找到上游作者后 15 分钟 |
| 5 | [部署 ops-telemetry 与 ops-console + Access（含 D6 核对）](#3-部署-ops-console-与-ops-telemetry-worker) | 车队视图、发布控制台、D11 真实数据 | 2–3 小时 |
| 6 | [实例安装密钥与上报地址](#4-实例上报的安装密钥分发) | 客户实例真正开始上报 | 30 分钟（决定方案） |
| 7 | [立平台大脑真实实例（D4/D11）](#5-平台大脑真实实例d4--d11) | 平台大脑起步、六跳检索有数据 | 半天 |
| 8 | [个人信息跨境传输法务确认](#6-个人信息跨境传输的法务签核) | D3 CRM 与上报链路的合规结论 | 约 1 小时会谈 + 律师周期 |
| 9 | [E7 真机升级演练 + 回滚](#7-e7-真机升级演练) | 自托管升级的「真机验证」 | 2 小时 |
| 10 | [D32 公开域名](#1-d32-devportal-公开域名) | devportal 公开层拆域生效 | 决定后 30 分钟（含 DNS 生效） |

---

## 1. D32 devportal 公开域名

**为什么要做**：公开层（`/explore`、`/projects/:slug`、`/u/:handle`、`/a/:handle/:agent`）与协作层同一份构建，
按主机名分流（规则唯一事实源 `apps/devportal/lib/public-host.ts`）。域名是占位值时拆分不生效，
CD 只发警告放行。

**前置条件**：选定一个主机名（例如 `<公开域名>`），它所在的 zone 在同一个 Cloudflare 账号下；有 PR 权限。

**逐步操作**：
1. 改 `apps/devportal/wrangler.toml` 的 `[vars]`：
   ```toml
   DEVPORTAL_PUBLIC_HOST = "<公开域名>"   # 原值 "__SET_DEVPORTAL_PUBLIC_HOST__"；不带协议、路径、端口
   ```
2. 改 `.github/workflows/deploy-devportal.yml` 的「Assert public-layer host configured (D13)」步骤：
   ```yaml
   run: node scripts/assert-public-host.mjs          # 去掉 --allow-placeholder
   ```
3. 本地自检后开 PR：
   ```bash
   (cd apps/devportal && node scripts/assert-public-host.mjs && pnpm exec vitest run tests/public-host-routing.test.ts)
   ```
4. Cloudflare Dashboard → Workers & Pages → `devportal` → Custom domains → Add `<公开域名>`。
   zone 在 Cloudflare 时它会自动建 DNS：`CNAME <公开域名> → devportal.pages.dev`（代理开启）。
   zone 不在 Cloudflare 时手动在 DNS 商建这条 CNAME。
5. Zero Trust → Access → Applications：**不要**给 `<公开域名>` 建 Access 应用；`develop.boardx.us` 的应用保持不变。

**需要填的值**：`apps/devportal/wrangler.toml` 中 `DEVPORTAL_PUBLIC_HOST = …` 那一行；
`.github/workflows/deploy-devportal.yml` 中 `assert-public-host.mjs --allow-placeholder` 那一行。
`docs/deployment/cloudflare-access-inventory.json` 里写的是 `$DEVPORTAL_PUBLIC_HOST` 引用，不用改。

**完成后如何验证**：
```bash
node apps/devportal/scripts/assert-public-host.mjs      # 预期：✓ DEVPORTAL_PUBLIC_HOST = <公开域名>
curl -sI https://<公开域名>/explore | head -1           # 预期：HTTP/2 200
curl -sI https://<公开域名>/portal  | head -1           # 预期：HTTP/2 404
curl -sI https://develop.boardx.us/explore | grep -iE '^(HTTP|location)'   # 预期：308 + location: https://<公开域名>/explore
```

**预计耗时**：决定后 30 分钟（DNS 与证书签发通常数分钟）。

---

## 2. 权利人名称、联系邮箱、安全联系人

**为什么要做**：Apache-2.0 第 6 条不授予商标权，`TRADEMARKS.md` 需要写明权利人与申请渠道；
NOTICE 的版权方名称也挂在这件事上（backlog B6、B8）。

**占位现状**（`git grep -n '〔待定'` 可复核）：

| 文件 | 行 | 内容 |
|---|---|---|
| `TRADEMARKS.md` | 19 | `权利人：〔待定：权利人法定名称〕。` |
| `TRADEMARKS.md` | 44 | `发邮件到 〔待定：商标联系邮箱〕，…` |
| `TRADEMARKS.md` | 11–12 | 「本文件凡是〔待定…〕都是占位」的警示（全部填完后应删除） |
| 根目录 `NOTICE` | — | **不存在**。backlog B6 记着「NOTICE 的版权方名称待组织确定」 |

安全联系人**已经有值**：`SECURITY.md` 第 10 行与 `apps/home/.well-known/security.txt`、`apps/home/privacy.html`、
`apps/home/zh/privacy.html`、`apps/home/assets/js/zh.js` 里是同一个地址（`check-deploy.mjs` 核对一致）。
只有组织决定换地址时才需要改；五处必须一起改。
还缺的是**人**：`docs/research/open-source-business-model.md` 第 4.9 节「谁负责」一行仍写「未定」（该行说邮箱是占位，已过时）。
组织指定安全负责人（`<安全负责人或团队>`）后改那一行，再跑 `pnpm run lint:commitments`，预期「显式缺口」少一处。

`LICENSE` 是 Apache-2.0 官方正文，**不要改**（`lint:package-license` 按 md5 比对）。

**前置条件**：组织给出正式名称 `<权利人正式名称>`、商标联系邮箱 `<商标联系邮箱>`（可选：新的 `<安全联系邮箱>`）。

**逐步操作**（脚本：`scripts/fill-legal-placeholders.mjs`）：
```bash
# 先看会改哪些文件（不写盘）
node scripts/fill-legal-placeholders.mjs --name "<权利人正式名称>" --email <商标联系邮箱> --notice --dry-run
# 确认后执行；换安全邮箱时再加 --security-email <安全联系邮箱>
node scripts/fill-legal-placeholders.mjs --name "<权利人正式名称>" --email <商标联系邮箱> --notice
git diff            # 人工过一遍
```
脚本行为：只处理 git 跟踪的文本文件；跳过 `docs/research/`（历史记录，只是在「讲」占位）；
全部替换后删掉 `TRADEMARKS.md` 的占位警示；`--notice` 只在 `NOTICE` 不存在时按 Apache 惯例新建；
参数像占位（含 `<>`、`〔〕`、「待定」）或邮箱格式不对时退出码 2。
填完后还可以删掉 `TRADEMARKS.md` 第 45 行「邮箱确定前，可先在仓库开 issue…」这句过渡说明。

**完成后如何验证**：
```bash
git grep -n '〔待定' -- . ':!docs/research'     # 预期：无输出（退出码 1）
pnpm run lint:package-license                   # 预期：通过
node scripts/fill-legal-placeholders.mjs --name "<权利人正式名称>" --email <商标联系邮箱>   # 预期：没有需要替换的占位
```

**预计耗时**：组织决定后 5 分钟。

---

## 3. 部署 ops-console 与 ops-telemetry Worker

**为什么要做**：两个都是**内部运营平面**（`.harness/scripts/lib/ops-plane.mjs` 登记，不随产品交付）。
ops-telemetry 收客户实例上报并给出车队视图（D10）；ops-console 是发布控制台、事故、GTM、CRM 边缘（D1/D2/D3）。

> ⚠ 硬规则：这两个 Worker **绝不**存客户内容、自然人信息（PII）、凭据值、计费账本。
> 这由 `pnpm run lint:telemetry-schema`、`lint:ops-incident-schema`、`lint:ops-gtm-schema`、`lint:ops-crm-schema`
> 门控 schema；部署时不要为了「方便」加 KV / D1 / R2 绑定存别的东西。

**前置条件**：Cloudflare 账号（Workers + Zero Trust 权限）；本机 `pnpm install` 完成；
`pnpm exec wrangler login` 或设置 `CLOUDFLARE_API_TOKEN`；两个自定义域名，例如 `<ops-console 域名>`、`<ops-telemetry 域名>`。

**代码需要的绑定**（读自 `wrangler.toml`，不要另加）：

| Worker | name | 绑定 | vars | secret |
|---|---|---|---|---|
| `apps/ops-console` | `workspacex-ops-console` | Durable Objects：`INCIDENTS`→`IncidentLog`、`GTM`→`GtmLog`、`CRM`→`CrmLeadLog`（迁移 v1–v3，SQLite 类） | `RELEASE_REPO`、`DEPLOY_WORKFLOWS`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ORIGIN_CRM_BASE` | `GITHUB_READ_TOKEN` |
| `apps/ops-telemetry` | `workspacex-ops-telemetry` | Durable Objects：`INSTANCE`→`InstanceReports`、`FLEET`→`FleetIndex`（迁移 v1） | `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` | 无 |

没有 KV / D1 / R2：存储全在 Durable Objects 里，首次 `wrangler deploy` 会按 `[[migrations]]` 自动建类。

**逐步操作**：

1. **GitHub 只读令牌**（只给 ops-console）：GitHub → Settings → Developer settings → Fine-grained tokens，
   Resource owner 选 `boardx`，只选仓库 `boardx/workspacex`，权限：
   `Actions: Read`、`Contents: Read`（读 Releases）、`Deployments: Read`、`Metadata: Read`（自动）。其余全部 No access。
   代码只调 `/repos/{repo}/releases` 与 `/repos/{repo}/actions/workflows/{wf}/runs`（`apps/ops-console/src/releases.ts`）。
2. **先部署一次**（此时 Access 未配，视图与 API 会 fail-closed 503，这是预期）：
   ```bash
   pnpm --filter ./apps/ops-telemetry exec wrangler deploy
   pnpm --filter ./apps/ops-console   exec wrangler deploy
   pnpm --filter ./apps/ops-console   exec wrangler secret put GITHUB_READ_TOKEN   # 交互输入，值不进仓库
   ```
3. **绑定自定义域**：Dashboard → Workers → 各 Worker → Settings → Domains & Routes → Add Custom Domain。
   ops-console 的 `workers_dev = false`，没有自定义域就无法访问。
   （也可以在各自 `wrangler.toml` 加 `[[routes]] pattern = "<域名>"` + `custom_domain = true` 后重新 deploy。）
4. **建 Access 应用**（Zero Trust → Access → Applications → Add → Self-hosted），各建一个：
   - ops-console：域名 `<ops-console 域名>`，路径 `/api/ops/*`（或整域 `/*`）；策略 Allow，Include 只放运营人员（邮箱域或 GitHub 组织）。
   - ops-telemetry：域名 `<ops-telemetry 域名>`，路径 `/fleet` 与 `/api/*`；策略同上。
     **另外**加一条 Service Auth 策略，Include 一个 Service Token（给第 5 项 `sync-customer-instances.ts --url` 用，
     它读环境变量 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`）。
   - **`/v1/report` 不能在 Access 后**：它是客户实例的机器上报。要么应用路径不覆盖它，要么为它单独建一个 Bypass 应用。
5. **取 AUD 与团队域名**：每个应用详情 → Overview →「Application Audience (AUD) Tag」。团队域名与 devportal 相同
   （`apps/devportal/wrangler.toml` 的 `CF_ACCESS_TEAM_DOMAIN`）。两者都**不是秘密**，写进 `wrangler.toml [vars]`：

   | 文件 | 行 | 填什么 |
   |---|---|---|
   | `apps/ops-console/wrangler.toml` | `ACCESS_TEAM_DOMAIN = ""` | 团队域名 |
   | `apps/ops-console/wrangler.toml` | `ACCESS_AUD = ""` | ops-console 应用的 AUD |
   | `apps/ops-console/wrangler.toml` | `ORIGIN_CRM_BASE = ""` | 境内源站 API 基址（`https://…`），见第 6 项；未定可暂留空（详情页 503） |
   | `apps/ops-telemetry/wrangler.toml` | `ACCESS_TEAM_DOMAIN = ""` | 团队域名 |
   | `apps/ops-telemetry/wrangler.toml` | `ACCESS_AUD = ""` | ops-telemetry 应用的 AUD |

   设了 `ORIGIN_CRM_BASE` 时，境内 API 的环境变量 `KERNEL_CORS_ORIGINS`（`apps/api/src/main.ts` 读取，逗号分隔）要加上
   `https://<ops-console 域名>`，因为线索详情页由运营人员浏览器直接回源。
6. **D6 Access 清单核对**：更新 `docs/deployment/cloudflare-access-inventory.json` 中 `apps/ops-console`、
   `apps/ops-telemetry` 的 `console_application` 与 `hosts[].host`（把 `TBD` 换成真实域名/应用名），
   然后按该文件 `reconcile` 五步逐条对控制台核对，跑门禁：
   ```bash
   pnpm run lint:cf-access
   ```
7. 带着上面的 `wrangler.toml` 与清单改动开 PR，合入后再 `wrangler deploy` 一次两个 Worker。

**完成后如何验证**：
```bash
curl -s https://<ops-console 域名>/api/ops/healthz
# 预期（经 Access 登录后或 healthz 未被边缘拦时）：{"ok":true,"access_configured":true,"github_configured":true}
curl -s -o /dev/null -w '%{http_code}\n' https://workspacex-ops-telemetry.<账号子域>.workers.dev/api/fleet
# 预期：401（直连无 Access JWT）；绝不能是 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' https://<ops-telemetry 域名>/v1/report
# 预期：422（契约校验失败）——说明 /v1/report 没被 Access 拦（被拦会是 302/403）
```
浏览器打开 `https://<ops-telemetry 域名>/fleet`：先跳 Access 登录，登录后看到车队页（可能为空）。

**预计耗时**：2–3 小时。

---

## 4. 实例上报的安装密钥分发

**代码实际怎么做的**（`apps/api/src/infrastructure/telemetry/`、迁移 `20260924230000_instance_telemetry_state.sql`）：
- 安装密钥**在实例本机自动生成**：首次运行时 `randomBytes(32)` 写入单行表 `instance_telemetry_state.install_secret`，从不出站。
- 上报的 `instanceId = sha256(install_secret)`；请求头 `Authorization: Bearer <install_secret>`。
- 边缘（`apps/ops-telemetry/src/index.ts`）只核 `sha256(Bearer) == instanceId`，**没有预登记名单**，密钥不落盘、不记日志。
- 实例侧只需要环境变量：
  - `WSX_TELEMETRY_ENDPOINT`：上报地址，填 `https://<ops-telemetry 域名>/v1/report`。未设 = 整个上报关闭。
  - `WSX_TELEMETRY_DISABLED`：`1` / `true` = 总开关关闭。
  - `WSX_PRODUCT_VERSION`：可选，发行版号 `x.y.z`。
- 周期：每天一次（D28）；只发客户同意的分节（出厂只开 `health`）。

所以「分发」**不需要把密钥发给实例**；要决定的是**边缘接不接受陌生 instanceId**：

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A. 现状（首报即登记） | 什么都不做，只把 `WSX_TELEMETRY_ENDPOINT` 写进发行版默认配置或安装文档 | 零运维；与「实例不透露身份」一致 | 任何人可伪造新实例刷车队；靠 DO 限流（429）兜底 |
| B. 签约客户白名单 | 客户在「上报设置」页看到 instanceId，交付时报给我们登记 | 车队只含已知实例 | 需要新代码：边缘校验名单（**未实现**） |
| C. 发行版签发的注册令牌 | 首报时附带发行渠道签发的一次性令牌 | 可区分官方分发与 fork | 需要新代码与密钥管理（**未实现**） |

**推荐**：先用 A 上线（车队只做运营参考，不作计费依据），把 B 记成 D10 后续 issue，等出现计费需求再做。

**需要填的值**：实例侧 `WSX_TELEMETRY_ENDPOINT`（写在自托管的 `selfhost.env` 或 API 的 systemd 环境里；
`selfhost.env.example` 目前未列出它——它是可选项，未设即关闭）。

**完成后如何验证**：在一台实例上设好 `WSX_TELEMETRY_ENDPOINT` 并重启 API，打开 Web 的「上报设置」页看「最近一次上报」结果为 `sent`；
在 `https://<ops-telemetry 域名>/fleet` 看到对应 instanceId。

**预计耗时**：决定方案 30 分钟；方案 A 的配置 10 分钟。

---

## 5. 平台大脑真实实例（D4 / D11）

**为什么要做**：D14 已定「平台大脑就是跑在一个真实 WorkspaceX 实例上的我们自己的组织」。
实例建起来之后的部分已有一条幂等命令：`apps/api/scripts/bootstrap-platform-brain.ts`。

**前置条件**：一台按 `docs/deployment/SELF-HOST-UPGRADE.md`「首次启动」立起来的实例（或指定一套现有环境）；
在该实例机器上有**本仓的完整 git clone**（脚本读 ADR、`.harness/instructions`、`mod-*` 经验与 `git log`/`git tag`）。

**需要的配置**：
- 数据库连接：与 migrate 相同，由 `apps/api/src/infrastructure/db/pg-config.ts` 的 `migrationConfig()` 读取
  （`PG*` 系列与 `MIGRATION_DB_PASSWORD` 等，按实例的 `selfhost.env` 加载即可；云上还有 `WORKSPACEX_DEPLOY_PROFILE`、`PGSSLMODE`、`PGSSLROOTCERT`）。
- D11（可选）：车队来源二选一——
  - `--fleet-url https://<ops-telemetry 域名>`，需要环境变量 `CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`（第 3 项的 Service Token）；
  - `--fleet-file <fleet.json>`，内容是 `/api/fleet` 的导出。
  不给就跳过客户实例同步，绝不捏造实例。

**逐步操作**：
```bash
set -a; . ./selfhost.env; set +a
pnpm --filter api exec tsx src/infrastructure/db/migrate-cli.ts
pnpm --filter api exec tsx scripts/import-platform-knowledge.ts --dry-run       # 先看要导入什么
pnpm --filter api exec tsx scripts/sync-dev-process-projection.ts --dry-run
pnpm --filter api exec tsx scripts/bootstrap-platform-brain.ts                   # D4 + D12
# D11（第 3 项部署后）：
CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… \
  pnpm --filter api exec tsx scripts/bootstrap-platform-brain.ts --fleet-url https://<ops-telemetry 域名>
```
（`CF_ACCESS_*` 的值从密码管理器注入，不要写进 shell 历史；可以先 `read -s` 再 `export`。）

**完成后如何验证**：
- 命令输出一段 JSON，含 `orgId`、`knowledge`、`devProcess`、`customers`（未给车队来源时为 `"skipped (no fleet source)"`）。
- 重跑一次，计数不应翻倍（幂等）。
- 有车队数据后：`pnpm --filter api exec tsx scripts/query-six-hop-path.ts <64 位 instanceId>` 返回路径。

**预计耗时**：实例已有时 1 小时；从零立实例半天。

---

## 6. 个人信息跨境传输的法务签核

**为什么要做**：D3 定了「边缘存 ID、源站存个人信息」，但跨境结论待法务，代码刻意没建任何导出通道。

**各处实际存了什么**（给律师的事实底稿）：

| 位置 | 物理位置 | 存什么 | 依据 |
|---|---|---|---|
| 境内源站 `crm_contacts` 表 | 境内（阿里云） | 线索姓名、公司、电话、邮箱、备注（≤4000 字）、`created_by` | 迁移 `20260924250000_crm_contacts.sql`，RLS FORCE + 平台运营守卫 |
| ops-console `CRM` Durable Object | Cloudflare（全球） | 不透明 `leadId`（`lead_` + 16 位十六进制）、阶段、渠道、活动 ID、时间戳 | `apps/ops-console/src/crm-schema.ts` |
| 线索详情页 | 运营人员浏览器 | 浏览器直接回源读个人信息，Worker 不代取、不缓存 | `apps/ops-console/src/index.ts` |
| ops-telemetry Durable Objects | Cloudflare（全球） | `instanceId`（安装密钥哈希）、版本、同意项、健康/用量/诊断/对标分节的聚合数 | `packages/contracts/src/instance-telemetry.ts` |
| Cloudflare 平台日志 | Cloudflare | 请求元数据（含来源 IP）；两个 Worker 都开了 `[observability]`，ops-telemetry `head_sampling_rate = 1` | 两个 `wrangler.toml` |

**要问律师的问题**：
1. 运营人员在境外（或出差时）打开线索详情页，浏览器从境内源站读取个人信息并显示——这算不算个人信息出境？若算，适用哪条路径（安全评估 / 标准合同 / 认证 / 豁免）？
2. 不透明 `leadId` 与阶段、渠道存放在境外边缘，但与境内表可一一关联——是否属于个人信息或「可识别」信息？
3. `instanceId` 是随机密钥的哈希，不含主机名、组织名；但客户组织与实例的对应关系我们在合同里知道——`instanceId` 与上报的聚合数是否构成个人信息或重要数据？
4. Cloudflare 边缘日志中的客户实例出口 IP 是否需要处理？是否应关闭 `[observability]` 或降低采样？
5. 线索个人信息的收集来源（表单、会议、名片）各需要什么告知与同意文本？保存期限怎么定？
6. 客户若是境外实体、其实例上报到我们的边缘，反方向是否需要额外文件（如 DPA）？
7. 若需要标准合同备案，由谁做、提交哪些材料（数据清单可用上表）？
8. 结论需要落在仓库哪里、谁签字：建议写进 `docs/research/implementation-backlog.md` 的 D3 行，并附会谈纪要日期。

**完成后如何验证**：D3 行状态从「跨境传输仍待法务确认」改为有日期的结论；若结论要求改动，另开 issue。

**预计耗时**：准备 30 分钟，会谈 1 小时，律师出意见的周期另计。

---

## 7. E7 真机升级演练

**为什么要做**：`compose.yaml` + `scripts/upgrade.sh` 只跑过 dry-run 与 lint，backlog E7 标着「完整升级待真机验证」。

**前置条件**：一台装有 Docker（含 compose v2）、Node（版本见 `.nvmrc`）、pnpm 的 Linux 机；
本仓完整 clone；API 以 systemd 单元 `workspacex-api` 运行（或演练时用 `--api-service` 指定）；两个可比较的版本 `<旧版本>`、`<新版本>`（tag 或 commit）。

**需要填的值**：`cp selfhost.env.example selfhost.env` 后填 `MIGRATION_DB_PASSWORD`（≥16 字符）、`SOURCE_REVISION`、
`SANDBOX_UID`、`SANDBOX_GID`、`SANDBOX_SOCKET_DIR`、`NATIVE_SESSION_SOCKET_DIR`；可选 `APP_DB_PASSWORD`、`APP_API_PORT`（默认 3200）、`PGDATABASE`。

**逐步操作**：
```bash
# 0. 在旧版本上立实例（按 SELF-HOST-UPGRADE.md「首次启动」）
git checkout --detach <旧版本>
cp selfhost.env.example selfhost.env && $EDITOR selfhost.env
export SOURCE_REVISION=$(git rev-parse HEAD)
docker compose --env-file selfhost.env up -d --build --wait
pnpm install --frozen-lockfile
set -a; . ./selfhost.env; set +a
pnpm --filter api exec tsx src/infrastructure/db/migrate-cli.ts
sudo systemctl restart workspacex-api && curl -fsS http://127.0.0.1:3200/healthz

# 1. 造一点可辨认的数据（在 Web 里建一个组织/项目，记下名字）

# 2. 先看要执行什么，再真升级
scripts/upgrade.sh --dry-run --env-file selfhost.env --ref <新版本>
pnpm selfhost:upgrade -- --env-file selfhost.env --ref <新版本>
```

**回滚演练**（升级成功后照脚本最后打印的「回滚方法」执行，时间戳目录见输出）：
```bash
git checkout --detach <旧版本> && pnpm install --frozen-lockfile
SOURCE_REVISION=<旧版本 commit> docker compose -p workspacex -f compose.yaml --env-file selfhost.env up -d --build --wait
WORKSPACEX_DEPLOY_PROFILE=starter STARTER_POSTGRES_CONTAINER=workspacex-postgres-1 \
  PGUSER=postgres PGDATABASE=${PGDATABASE:-workspacex} PGPASSWORD="$MIGRATION_DB_PASSWORD" \
  pnpm --filter @repo/cloud-deploy exec node --import tsx src/starter-backup-cli.ts restore .selfhost/backups/<时间戳>
sudo systemctl restart workspacex-api
```
再做一次**失败路径**：`--ref` 给一个不存在的 ref，确认脚本非零退出并打印回滚步骤、数据未动。

**完成后如何验证**：
- 升级输出以 `✓ 升级完成：<旧 commit> → <新 commit>` 结尾；`.selfhost/upgrades/<时间戳>/state` 含 `old_rev`、`new_rev`、`backup_dir`。
- `curl -fsS http://127.0.0.1:3200/healthz` 返回 200；第 1 步建的数据仍在。
- 回滚后 `git rev-parse HEAD` 是旧版本，healthz 200，数据仍在。
- `docker compose -p workspacex ps` 全部 healthy。
- 把以上输出贴进 E7 的 issue，backlog E7 行去掉「待真机验证」。
- 演练结束 `docker compose -p workspacex down`（演练机不再用时加 `-v`），遵守资源释放 SOP。

**预计耗时**：2 小时（首次构建镜像占大头）。

---

## 8. fabric-markdown 许可问题

**在哪里**：
- `.harness/scripts/lib/ownership.mjs`：`"packages/fabric-markdown": { class: "undecided", … }`——仓库里唯一未定归属的包；
- `docs/research/implementation-backlog.md` B6 行：「只剩 `fabric-markdown` 未定（上游许可未记录）」；
- `packages/fabric-markdown/VENDOR.md`：上游是本机目录 `~/Documents/projects/fabric-markdown`，**不是 git 仓库**，v0.1.0，2026-07-30 并入；
- `packages/fabric-markdown/UPSTREAM-README.md`：上游 README 原文，没有许可声明；决策记录在 `docs/adr/ADR-100-fabric-markdown.md`。

**要回答的确切问题**：
> `fabric-markdown` v0.1.0（VENDOR.md 所记的上游目录、树摘要为并入时的原始值）的**著作权人是谁**，
> 它以什么许可证发布？是否允许我们以 Apache-2.0 再分发本仓里修改过的版本？

- 若作者是本组织员工且属职务作品 → 权利归组织，改登记为 `oss`，加 `license: "Apache-2.0"` 与 LICENSE 正文；
- 若是第三方 → 取得书面许可或其开源许可文本，保留其版权声明（放进包目录的 LICENSE / NOTICE），再定归属；
- 若无法确认 → 开源版本移除该包，或改为可选依赖。

**逐步操作**：问到答案后，改 `.harness/scripts/lib/ownership.mjs` 那一行的 `class` 与 `why`；按类在
`packages/fabric-markdown/package.json` 加 `license`；oss 类还要放 LICENSE 文件（与根 `LICENSE` 逐字一致）。

**完成后如何验证**：
```bash
pnpm run lint:package-license     # 预期：通过，且「未定」列表里不再有 packages/fabric-markdown
```

**预计耗时**：找到作者后 15 分钟。

---

## 9. 确认凭据扫描命中

**报告**：`docs/research/oss-secret-scan-2026-09-24.md`（只记计数，不记位置——保持这条纪律，不要把位置写进仓库）。
扫描脚本：`.harness/scripts/oss-secret-scan.mjs`。

**前置条件**：本地**完整历史** clone（`git fetch --unshallow`，并拉全远端分支与标签）；能登录阿里云控制台核对 AccessKey。

**逐步操作**（在你自己的终端里跑，输出不要贴进 issue/PR/聊天）：
```bash
git fetch --unshallow 2>/dev/null; git fetch --all --tags
node .harness/scripts/oss-secret-scan.mjs              # 完整历史，看明细
node .harness/scripts/oss-secret-scan.mjs --head-only  # 只看工作树
```
分诊顺序与判定：
1. **`aliyun-ak`（历史 2 处）**：在阿里云 RAM 控制台按 AccessKey ID 前缀比对。存在即视为已泄露：禁用 → 轮换 → 查操作审计日志，
   然后再决定是否重写历史。删历史不能替代轮换。
2. **`assigned-secret` 非测试路径的 11 处**：逐条判定为「开发默认值 / 样例 / 真值」；真值同上处理，默认值确认生产不用它。
3. **测试路径下的私钥块 3、JWT 1、GitHub token 1**：确认是生成的样例（私钥不对应任何在用证书、token 在 GitHub 查无此令牌）。
4. 用 gitleaks 或 trufflehog 在完整镜像上复扫一遍。
5. 在报告末尾追加一节「人工确认」：日期、确认人、每条规则的结论**计数**（例如「aliyun-ak 2：已轮换」），以及复扫工具与命令。**不写值、不写位置。**

**完成后如何验证**：报告有「人工确认」节；复扫工具对 HEAD 无新增命中；轮换过的密钥在云控制台显示为禁用或已删除。

**预计耗时**：1–3 小时；若需要重写历史，另计半天（涉及所有协作者重新 clone）。

---

## 10. 审阅并合入 PR #4065

**为什么要做**：本文所有项的代码都在这个 PR 里（18 个 issue，`Closes #4055 … #4091`）。auto-merge 已开，检查全绿且有批准就会自动合入。

**前置条件**：仓库写权限；PR 当前 `mergeable_state: blocked`（等审批 / 检查）。

**逐步操作**：
```bash
gh pr view 4065 --repo boardx/workspacex
gh pr checks 4065 --repo boardx/workspacex
gh pr diff 4065 --repo boardx/workspacex --name-only | less
```
重点看：
- 运营平面：`apps/ops-console`、`apps/ops-telemetry` 的 schema 文件（不许出现 PII 字段）；
- 迁移：`apps/api/migrations/20260924230000_instance_telemetry_state.sql`、`20260924250000_crm_contacts.sql`（RLS）；
- 上报器只出站、可关：`apps/api/src/infrastructure/telemetry/telemetry-config.ts`；
- `compose.yaml`、`scripts/upgrade.sh`、`TRADEMARKS.md`。
然后：
```bash
gh pr review 4065 --repo boardx/workspacex --approve --body "<审阅意见>"
```
有红的检查按 `.harness/instructions/coordinator-sop.md` 的 PR 状态表分诊，不要跳过检查强行合入。

**完成后如何验证**：
```bash
gh pr view 4065 --repo boardx/workspacex --json state,mergedAt   # 预期：state=MERGED
gh issue view 4061 --repo boardx/workspacex --json state         # 预期：CLOSED（其余 Closes 的 issue 同理）
```

**预计耗时**：30–60 分钟。
