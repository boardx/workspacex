# Work Skill 元数据与目录（能力域 work-skill-meta）

> 元数据：估点 **29**（WorkSkillManifest 契约 + frontmatter 校验 5 · skill_catalog_entries 迁移与仓储 6 · 目录/搜索 API 6 · 依赖就绪性计算 5 · 目录页 UI 7；与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。
> 实现轮次：`docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md` 第 2 轮（验收：S003 以包形式导入后在目录可见，元数据可查；契约与迁移测试通过）。
> 依据：ADR-117（元数据落在包模型上，权威）、ADR-116（v2 权威 / Agent 即数字人）、ADR-119（候选→已验证通道与 G0–G5 门）、ADR-120（工具能力分类）、`docs/proposals/PROP-WORK-STACK-001.md` 修订 R1、实体文档 `requirements/work-stack-v2/skills/S003-enterprise-search.md`（首个落地样例）。

## 现状核实（本文所有"已有"论断的出处）
- 包模型表 `skills` / `skill_versions` / `skill_version_files` / `skill_mounts` 定义于 `apps/api/migrations/20260804031000_wave2_skill_starter_import.sql`：`skills.status` 仅 `enabled|disabled`；`skill_versions.manifest jsonb NOT NULL` 不可变、`content_digest` 为 64 位十六进制；迁移本身不插数据，内容只经 `POST /admin/skills/starter-pack-imports` 进入（仓储 `apps/api/src/infrastructure/skill/pg-skill-starter-import-repository.ts`）。
- `apps/api/src/application/skill/resolve-runtime-context.ts` 目前只计算**数据范围**（declaredScope ∩ Context Pack 返回项），**尚无**能力分类 × 已授权工具的就绪性计算——ADR-117「后果」所述就绪性是本域新增。
- 工具目前只有 `sideEffect`（`packages/contracts/src/agent-runtime.ts`），无 `capabilityCategory`；分类字段由 ADR-120 引入，本域只**消费**分类值，不负责给 MCP 工具打分类（归属第 5 轮 / ADR-120 实现）。
- Web 端 `/skill`（`apps/web/app/skill/page.tsx`）默认屏 `library` 已接真实后端（`components/skill/skill-catalog-live.tsx`），其余 7 屏为原型；Work Skill 目录作为该页新屏或并列视图接入，不另起顶层路由（见 R8）。
- 现有包：`skills/<pack>/<skill>/SKILL.md` + `skills/starter-packs/`（如 `standard-context`、`data-workflows`）。

## R1 概览
- **Use Case 名称**：把 Work Skill 以带结构化元数据的包发布进组织，并在目录中按领域/通道检索、查看依赖就绪性。
- **Actor**：组织管理员（导入、改目录通道/后继）、平台运营（维护官方 Work Skill 包的 candidate/verified/deprecated）、组织成员（浏览/搜索目录、查看就绪性）、Workflow Runtime 与 Agent 装配流程（系统 Actor，读取 manifest 与就绪性）。
- **目标**：让 58 个第一阶段 Skill（及后续 200 个）具备依赖、溯源、地区、评测、风险等级等可查元数据，发布状态可变而版本内容不可变，且能在运行前回答"本组织现在能不能跑这个 Skill、缺什么"。
- **系统边界**：`packages/contracts`（WorkSkillManifest Zod）、`apps/api` skill 导入与新 catalog 模块、PostgreSQL 新表 `skill_catalog_entries`、`apps/web` `/skill` 目录屏。不含 Workflow Runtime（第 3 轮）、Eval Runner 与门脚本（第 6 轮，本域只预留 `evalSuiteId` 与门状态展示位）、工具分类打标（ADR-120）。

## R2 前置与触发
- **前置条件**：组织存在；导入者具有组织管理员权限；starter-pack 摘要校验沿用现有导入流程；对应实体文档评审为 PASS（修订 R1：只有 PASS 的实体才进入实现）。
- **触发条件**：
  - 管理员调用 `POST /admin/skills/starter-pack-imports` 导入含 `metadata.work` 的包；
  - 运营/管理员调用目录写接口修改通道、后继；
  - 成员打开 `/skill` 的 Work Skill 目录屏或调用目录/搜索/就绪性读接口；
  - 系统在 Workflow 定义固定 Skill 版本（ADR-118 #9）或 Agent 装配时查询就绪性。

## R3 主流程
1. 作者在 `SKILL.md` frontmatter 写 `metadata.work`，字段按 ADR-117 #2：`stableId`（如 `S003`）、`domain`、`riskClass`、`dependencies{required[],optional[]}`（值为能力分类如 `knowledge.search`、`crm.read`，**不写供应商**）、`provenance[]`（repo/path/commit/license/strategy/copied/notice）、`locales[]`、`jurisdictions[]`、`evalSuiteId`、`inputSchema`、`outputSchema`。
2. 本地/CI 执行 manifest 校验命令（lint 脚本）→ 用 `WorkSkillManifest` Zod 解析每个含 `metadata.work` 的 SKILL.md；失败列出文件路径 + 字段路径 + 原因，退出码非 0。
3. 管理员导入 starter-pack → 现有导入流程校验摘要 → 新增步骤对 `metadata.work` 做同一 Zod 校验 → 通过后把解析结果写入不可变 `skill_versions.manifest`（作为其 `work` 子键，不改表结构）。
4. 同一事务内为该 Skill 建立/更新一行 `skill_catalog_entries`（org_id、skill_id、stable_id、domain、channel、successor_skill_id、search 字段、updated_by/at）；新 Skill 默认 `channel = candidate`；已有行只刷新检索字段，**不回退**已有 channel。
5. 成员打开目录 → `GET /skills/catalog?domain=&channel=&q=&cursor=` 返回分页列表：名称、stableId、domain、channel、riskClass、当前生效版本 semantic_label、就绪性摘要（ready / missing N）、后继（若有）。
6. 成员输入关键词 → 按名称、stableId、domain、描述做搜索（Postgres 全文或 trigram，含中英文）→ 结果按相关度排序，空关键词按 stableId 排序。
7. 成员点开某 Skill → `GET /skills/catalog/:skillId` 返回 manifest 明细：依赖（必需/可选分组）、溯源表、地区/法域、evalSuiteId 与门状态占位、输入/输出 schema、版本列表。
8. 系统计算就绪性：`required` 中每个能力分类 × 本组织已授权且启用的工具的分类集合 → 每项给出 `satisfied | missing | denied`；全部 required 满足即 `ready`；optional 缺失只提示不阻断。`GET /skills/catalog/:skillId/readiness` 返回逐项结果与原因。
9. 平台运营/管理员通过 `PATCH /admin/skills/catalog/:skillId` 把通道由 `candidate → verified`（要求门状态满足 ADR-119 规定，门判定未落地前该转移需显式 `gateEvidenceRef`）或 `→ deprecated` 并可设 `successorSkillId`；写审计事件。
10. 目录列表与详情立即反映新通道；deprecated 条目默认从列表隐藏，详情页展示后继链接。

## R4 备选与异常
- **备选流程**
  - A1：普通平台 Skill（无 `metadata.work`）照常导入，不建目录行，不出现在 Work Skill 目录屏，现有 `library` 屏行为不变。
  - A2：同一 Skill 导入新版本 → 新 `skill_versions` 行携带新 manifest；目录行指向的"当前生效版本"按现有 published 语义切换，旧版本 manifest 仍可按版本查询（Workflow 固定版本依赖它）。
  - A3：成员勾选"显示已废弃" → 列表包含 deprecated 条目并带标记。
  - A4：optional 依赖缺失 → 就绪性仍为 `ready`，详情中该项显示"可选，未授权，功能降级"。
- **异常流程**
  - E1：frontmatter 缺必填字段/类型错/`dependencies` 写了供应商名（非已登记分类格式）→ 导入整体拒绝（422），返回文件路径与字段路径，**不写入**任何 skill_versions 或目录行（原子性）。
  - E2：`stableId` 与组织内另一 Skill 冲突 → 409，指出冲突 Skill，不覆盖。
  - E3：`successorSkillId` 指向不存在的 Skill、自身、或形成后继环 → 422，拒绝。
  - E4：非 candidate 的转移不合法（如 deprecated → verified，或 candidate → verified 无门证据）→ 409 并说明允许的转移。
  - E5：工具注册表/授权查询失败 → 就绪性返回 `unknown` 并给出原因，**不得**显示为 ready；目录列表其余字段照常返回。
  - E6：能力分类在分类登记表中不存在（拼写错误或 ADR-120 尚未登记）→ 导入时校验失败（同 E1）；已导入数据若分类被下线 → 就绪性该项为 `missing` 并注明"分类未登记"。
  - E7：搜索无结果 → 空态提示并给出清除筛选入口，不回退到模糊到无关的结果。
  - E8：provenance 缺 license 或 `copied=true` 但无 notice → 导入拒绝（G1 许可要求见 ADR-119）。
  - E9：非管理员调用写接口 → 403，界面不展示通道操作入口。

## R5 权限与可见性
- 组织成员：可浏览/搜索本组织目录中 candidate 与 verified 条目及其 manifest、就绪性；deprecated 需主动勾选可见；只能看本组织数据（RLS 按 org_id）。
- 组织管理员：以上全部 + 导入 starter-pack + 修改本组织目录行 channel/successor；就绪性详情中可看到具体缺失的工具授权入口。
- 平台运营（platform-admin）：维护官方包在平台组织中的通道；不能直接改其他组织的目录行。
- 系统 Actor（Workflow/Agent 装配）：只读 manifest 与就绪性，经服务端接口，不绕过 RLS。
- 访客、未登录用户、其他组织成员：无任何访问；API 返回 401/404（不泄露存在性）。
- 任何角色都**不能**修改 `skill_versions.manifest`（不可变；改元数据 = 发新版本）。

## R6 后置条件 / 不包含
- **后置条件**：每个带 `metadata.work` 的已导入版本在 `skill_versions.manifest.work` 有经校验的元数据；每个 Work Skill 有且仅有一行目录记录；通道变更有审计；就绪性可随授权变化实时重算（不缓存为事实）。
- **不包含**：
  - 声明式 `skill_contracts` 模型加 Work 字段或两模型收敛（ADR-117 #4，另立 issue）。
  - Eval 运行、G0–G5 门判定脚本（第 6 轮）；本域只展示门状态字段位。
  - MCP 工具 `capabilityCategory` 打标与健康探测（ADR-120，第 5 轮），本域以现有分类登记数据为输入。
  - 58 个 Skill 的内容作者化（第 7–9 轮），本轮只需 S003 端到端样例。
  - 实时语音（项目范围外）。

## R7 业务规则
- manifest 属于不可变版本；通道/后继/检索字段属于可变目录行——同一事实不在两处声明（通道不写进 manifest）。
- 依赖只写能力分类，不写供应商；就绪性判断只看"分类 × 已授权工具"，不允许用同分类其他供应商静默替代被拒授权（ADR-120 #3）。
- 通道转移：`candidate → verified`、`candidate → deprecated`、`verified → deprecated`；其余拒绝。`passing` 式不可逆：deprecated 不可复活，只能发新 Skill 作为后继。
- 就绪性未知 ≠ 就绪；任何查询失败都显示 unknown。
- Workflow 固定的 Skill 版本不要求所属 Agent 挂载该 Skill（ADR-118 #9）；目录不以挂载关系作为可见条件。

## R8 界面线索
- 前端入口：`/skill` 页新增屏 `?screen=work-catalog`（左侧领域筛选 + 通道切换 candidate/verified/已废弃；顶部搜索框；列表行：名称、stableId、domain 标签、通道徽章、riskClass、就绪性徽章 ready / 缺 N 项 / unknown）。
- 详情抽屉：依赖分组（必需/可选，每项状态图标 + 原因）、溯源表（repo/path/commit/license）、地区与法域、评测套件与门状态占位、版本列表、后继链接；管理员可见"变更通道/设置后继"按钮。
- 状态：加载骨架、空态（E7）、错误态（E5 就绪性 unknown 局部提示，不整页报错）、无权限（E9 不展示入口）。
- 线框：待 UI 先行阶段产出；开工前须随契约束 `design-signoff.md` 第 ① 节经人类签核（ADR-023）。

## R9 非功能约束
- 性能/规模：目录 ≤ 1,000 条/组织（200 Work Skill + 平台 Skill 余量）；列表与搜索 p95 < 300ms；就绪性单 Skill 计算 p95 < 200ms，列表批量计算不得 N+1。
- 安全/隐私/合规：RLS 按 org_id；provenance 许可信息必须完整（E8）；审计通道变更者与时间。
- 兼容与降级：现有 `library` 屏与普通 Skill 导入行为不变（A1）；工具授权服务不可用时降级为 unknown（E5）。

## R10 已知约束 / 依赖
- 依赖：现有 starter-pack 导入与摘要校验；组织工具授权数据；能力分类登记（ADR-120，若未落地则本域先建最小分类登记常量表，并在 issue 中说明）。
- 技术：TypeScript 严格模式、Zod 契约放 `packages/contracts`、洋葱架构（domain/application/infrastructure）、新迁移不改 `skill_versions` 结构。

## R11 切分提示
- F-a WorkSkillManifest 契约 + frontmatter lint（5）→ F-b 导入接入校验与 `skill_catalog_entries` 迁移/仓储（6）→ F-c 目录/搜索/详情 API + 通道写接口（6）→ F-d 就绪性计算与 API（5）→ F-e 目录屏 UI（7）。
- F-a 先行；F-d 可与 F-c 并行；F-e 依赖 F-c/F-d 与 UI 签核。

## R12 AI Ready 验收线索
- 成功态：导入含 `metadata.work` 的 S003 包后，`skill_versions.manifest.work.stableId = 'S003'`，目录有一行 `channel=candidate`；`GET /skills/catalog?q=search` 与 `?domain=Shared` 均能返回 S003；详情返回 provenance 含 commit 与 Apache-2.0。
- lint：故意删掉 `riskClass` 的 fixture 使校验命令退出非 0 并打印字段路径。
- E1/E6/E8：非法 frontmatter、未登记分类、缺 license 导入均返回 422 且 `skill_versions` 行数不变。
- E2/E3/E4：stableId 冲突 409；后继自指/成环 422；deprecated → verified 409。
- 就绪性：组织授权了 required 所有分类 → `ready`；撤销其中一个工具授权 → 该项 `missing` 且整体非 ready；模拟授权查询失败 → `unknown`（E5）；optional 缺失仍 `ready`（A4）。
- A1/A2：无 `metadata.work` 的 Skill 导入成功且不出现在目录；导入新版本后旧版本 manifest 仍可按版本读取。
- 权限：成员调用 PATCH 得 403 且 UI 无通道按钮；其他组织成员读 S003 得 404；未登录 401。
- UI：`/skill?screen=work-catalog` 显示 S003 行与就绪性徽章；搜索无结果显示空态与清除筛选；勾选"显示已废弃"才出现 deprecated 条目。
