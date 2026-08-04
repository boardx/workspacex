# 原始需求（细化）— UC-25.1 显式导入 Garden Advisors

> 所属：阶段一 · 能跑完一场项目 / M25 Curated Capability Packs
> 元数据：优先级 **P1**；估点 **5**；建议迭代 **待签核后安排**。
> 来源：管理员指定的四个 Garden Skills；导入机制复用已签核并合入的 Wave 2 #412 / PR #428。

## R1 概览

- **Use Case ID / 名称**：UC-25.1 / 显式导入 Garden Advisors。
- **Actor**：组织管理员；普通组织成员是明确的拒绝角色。
- **目标**：管理员在不引入可执行第三方代码的前提下，把四项经过审阅的 Garden 方法论作为
  WorkspaceX 声明式 advisor Skills 一次导入当前组织。
- **系统边界**：部署配置 `SKILL_STARTER_PACK_ROOT`、既有 `/admin/skill` 显式导入面、
  `POST /admin/skills/starter-pack-imports`、不可变 Skill 版本与文件、pack/上游 provenance。
  本 UC 不新增 Skill 执行器、工具调用或外部服务。

## R2 前置条件 / 触发条件

**前置条件**

- 部署者已把经过 review 的 pack 根目录显式配置到 `SKILL_STARTER_PACK_ROOT`；未配置即不存在可导入 pack。
- 当前身份已登录当前组织且 `orgRole = admin`。
- pack 坐标固定为 `garden-advisors@1.0.0`，其中四项上游 tag、commit 与归档摘要见 R7。
- 当前组织可为空；迁移、启动、注册、首次登录和目录空态都不得自动创建 Skill。

**触发条件**

- 管理员进入既有 `/admin/skill`，点击 `skill-starter-import`，输入 Pack ID `garden-advisors`
  与 Pack version `1.0.0`，再点击 `skill-starter-import-confirm`。

## R3 主流程

1. 系统先展示当前组织的真实 Skill 目录；空组织显示真实空态，不展示推荐、预选或内置候选。
2. 管理员输入固定 pack 坐标并确认；前端调用既有
   `POST /admin/skills/starter-pack-imports`，请求仍只有 `packId`、`packVersion`、`idempotencyKey`。
3. 服务端从 `SKILL_STARTER_PACK_ROOT` 读取对应 pack，先校验 pack digest、四项 Skill 的文件 digest、
   唯一路径和唯一根 `SKILL.md`，再开始同一事务写入。
4. 事务创建恰好四个组织级、已启用、不可变版本的 Skill：
   `garden-web-design-advisor`、`garden-gpt-image-prompt-advisor`、
   `garden-beautiful-article-advisor`、`garden-web-video-planning-advisor`。
5. 成功响应沿用 Wave 2 `SkillStarterImportResult`，`skillIds` / `versionIds` 均为 4 项；
   既有界面显示“导入完成：新增 4 个 Skill”并刷新当前组织目录。
6. 每个版本的 manifest 与只读文件保存上游 repo、tag/release、annotated tag object、commit、
   review-time archive SHA-256、MIT license 与 WorkspaceX adapter version/source allowlist。

## R4 备选流程与异常流程

**备选流程**

- **A1 相同重试**：同一组织、同一 idempotency key、相同坐标返回首次成功的字节等价结果，
  不增加 Skill、版本或文件。
- **A2 另一组织显式导入**：另一组织的管理员可独立导入；两个组织的 ID 与数据完全隔离。
- **A3 advisor 请求**：四项 Skill 只能产出建议文本、结构化提示词、编辑计划、脚本或 storyboard 计划；
  请求执行 browser/image/TTS/shell 等能力时明确回答该模式不可用，且没有可到达的工具或代码路径。

**异常流程**

- **E1 未配置或坐标不存在**：返回既有 `SKILL_STARTER_PACK_NOT_FOUND`；当前组织仍为零新增。
- **E2 文件或 pack 被篡改**：返回既有 `SKILL_STARTER_PACK_INVALID`；事务不产生部分写入。
- **E3 非管理员**：返回既有 `SKILL_STARTER_IMPORT_ADMIN_REQUIRED`；pack 内容不被导入。
- **E4 名称冲突**：返回既有 `SKILL_STARTER_PACK_CONFLICT`；不覆盖用户创建的同名 Skill。
- **E5 幂等键换载荷**：返回既有 `SKILL_STARTER_IMPORT_IDEMPOTENCY_CONFLICT`。
- **E6 任一 adapter 源文件越出 allowlist、出现脚本/模板/二进制或能力声明越权**：生成/check 阶段失败，
  不产出可部署 pack；不得以 warning 放行。

## R5 权限与可见性

- **组织管理员**：可在当前组织显式导入与重试，能看到导入结果和刷新后的四项目录记录。
- **普通组织成员及其它非管理员角色**：没有导入按钮；绕过界面直接请求仍被服务端拒绝。
- **另一组织的任何身份**：不能读取或复用当前组织的导入结果、版本或幂等记录。
- 未列出的角色默认没有导入权限。

## R6 后置条件 / 不包含

**后置条件**

- 成功组织恰有四个新的逻辑 Skill、四个已发布不可变版本及其 allowlisted 文件；每项 provenance 可追溯。
- `starter_pack_imports` 留下组织级、管理员级、pack 坐标和 digest 的成功记录。
- 未导入的组织保持真实空态；导入不会给其它组织、项目或 Agent 自动挂载 Skill。

**不包含**

- 不复制或执行上游 `scripts/`、`templates/`、package manifest、Agent 配置或二进制产物。
- 不做网页生成/修改、浏览器验收、图片生成或编辑、文章 HTML/PDF 构建、视频 Web 工程、TTS 或录屏。
- 不安装 package，不访问任意文件系统或网络，不发现/读取环境 secret。
- 不新增推荐列表、默认 pack、startup seed、隐式导入或隐式调用。
- 不新增 API 字段、错误码、`Skill.source` 取值、AgentRun、MCP/tool executor。
- Deep Research Agent 适配属于独立需求，不在本 UC。

## R7 业务规则

### R7.1 Pack 与四项稳定身份

- Pack：`garden-advisors@1.0.0`；adapter schema/version 必须进入 digest。
- 四个 stableName 恰为 R3.4 所列集合；不能多、不能少、不能按上游目录扫描自动扩容。
- 每项运行时文件 allowlist 恰为 `SKILL.md`、`references/advisor-guide.md`、`NOTICE.md`、
  `LICENSE.upstream.txt`。这些文件由 review 过的 WorkspaceX adapter source 确定性生成；
  不把上游文件整包复制进运行时。

### R7.2 上游固定点与 review-time archive 证据

仓库均为 `https://github.com/ConardLi/garden-skills`；以下摘要来自 2026-08-04 对 GitHub tag tarball
字节的 review-time 固定取证，NOTICE 必须逐项保留。实现不得跟随 `main` 或用“latest”解析。

| Advisor | Upstream tag | annotated tag object | commit | archive SHA-256 |
|---|---|---|---|---|
| Web Design | `web-design-engineer-v1.3.0` | `928a7d28598e27a6ee1dfc2d666943f970929d5b` | `ea45dc563a42042341de36cc11806d8a870a6606` | `83bbc80e06145e9a8479f41cb45f2c9d7b8ea940c81794a8188379b6ef9993a7` |
| GPT Image Prompt | `gpt-image-2-v1.0.4` | `5161b37aaf18087d4e56aed7db2b56727a488cb7` | `78b4d081493e2a4a1c199d074f63e57814ed7e30` | `95be4b77d5703bfdfa8fd198e1770d746cda8d3b2c5e3a2e52c2fa9cd6eeda10` |
| Beautiful Article | `beautiful-article-v0.1.0` | `6b438c530f005ec6232a26811511d6e602605d77` | `78b4d081493e2a4a1c199d074f63e57814ed7e30` | `696b266005fe362148a8d375a80d1c95e1e1b80ddb352630a6ecb51cbb35ad71` |
| Web Video Planning | `web-video-presentation-v1.2.2` | `329f520d264915c4474a39d5465281da60210c11` | `78b4d081493e2a4a1c199d074f63e57814ed7e30` | `6856c64336dfb50fdbf674a7f05d4b5ab53f9fd00dee723c5a0e1f5df0e489ef` |

### R7.3 Advisor-only 安全边界

- **Web Design**：只给设计方向、层级/排版/可用性 critique 与 redesign plan，不写文件、不跑 browser。
- **GPT Image Prompt**：只启用上游 Mode C advisor-only，产出结构化 prompt/negative constraints；
  不调用 OpenAI/兼容图片 API，不探测 API key。
- **Beautiful Article**：只做编辑 brief、outline、信息密度、版式与素材计划；不摄取 URL/PDF/DOCX，
  不构建 React/HTML/PDF。
- **Web Video Planning**：只做 script/章节/step/storyboard 计划；不 scaffold Web 工程、不 TTS、不录屏。
- 所有 adapter 的 capability policy 都是 deny-by-default；不得声明 network/browser/image/TTS/shell/
  package-install/arbitrary-fs/secret-discovery。

### R7.4 单一显式发现通路

- Pack 只可由部署者设置的 `SKILL_STARTER_PACK_ROOT` 发现。
- 未设置 root 时 `FileSkillStarterPackSource` 返回 not found；代码内不得有 fallback root、候选数组、
  `if empty then import`、默认/recommended pack 或环境扫描。

## R8 界面线索

- **无新界面**。完全复用 `/admin/skill` 的 `SkillStarterImportPanel`。
- 稳定选择器：`skill-starter-import`、`skill-starter-import-confirm`、`skill-starter-import-result`、
  `admin-skill-empty`、`admin-skill-list`。
- UI 签核材料复用既有 `contracts/skills/ui.md` 与其 `ui-preview/skill-v2/` 索引；
  束级复用关系由 control-plane #432 的 `ui-material-map.json` `reuse_bundle` 单源声明，本文不抄截图清单。

## R9 非功能约束

- **确定性**：相同 adapter sources 必须 byte-for-byte 生成相同 JSON 与 pack digest；generator `--check`
  检出任何手工修改。
- **供应链**：tag、tag object、commit、archive SHA、MIT 全量入 provenance；任何缺失 fail closed。
- **安全**：pack 文件路径与 media type 固定 allowlist；内容扫描证明没有可执行脚本、package 安装、
  secret 名称发现或工具声明。
- **租户**：所有新增行继续受 Wave 2 RLS 与组织级幂等约束。
- **兼容**：完全复用 `wave2Runtime.operations.importSkillStarterPack`；若实现需要新增 API 字段、
  用户可见 source enum 或执行错误码，立即停止并走扩展签核，不在 F149 内自行添加。

## R10 已知约束 / 依赖

- 依赖 #412 / PR #428 已合入的 Skills persistence、显式 import、真实空态与 no-builtin gate。
- UI 复用门控依赖 control-plane #432；#431 在 #432 合入并 rebase 前预期因 UI material mapping fail closed。
- F149 开工前需本束人类签核，并由人类把本束纳入 phase-01 `design-coherence.md` 的
  `covers_bundles` 后重新完成阶段一致性复核；2026-07-30 的历史 confirmed 不能覆盖本束。
- 上游 MIT 允许改编与再分发，但 `LICENSE.upstream.txt` 与 NOTICE 必须进入每个不可变版本。

## R11 切分提示

- 一个 feature 完成：adapter sources + deterministic generator/check + pack artifact + 真实显式导入反证。
- 共享热点：`apps/api/package.json`、`apps/api/tests/skills/`、`apps/api/scripts/`、部署 pack 产物目录。
- 不与 Agent/Deep Research/AgentRun feature 合并；一 issue 一 PR。

## R12 AI Ready 验收线索

- **V1**：未设置 `SKILL_STARTER_PACK_ROOT` 的新组织在启动、迁移、注册和首次登录后仍为 0 Skills。
- **V2**：generator `--check` 对同一 adapter sources 两次生成 byte-for-byte 相同，并与提交产物一致。
- **V3**：pack 坐标固定为 `garden-advisors@1.0.0`，skills 集合恰为四个固定 stableName。
- **V4**：四项版本只含四个 allowlisted 路径，且每项恰一个根 `SKILL.md`；scripts/templates/binary 为 0。
- **V5**：每项 manifest/NOTICE/License 保留 repo、tag、tag object、commit、archive SHA、MIT 与 adapter provenance。
- **V6**：篡改任一文件内容但不改 digest、或篡改 pack 内容但不改 packDigest，均返回 INVALID 且 0 部分写入。
- **V7**：非管理员调用返回 ADMIN_REQUIRED，数据库 0 新增；按钮也不出现在非管理员 DOM。
- **V8**：管理员显式导入返回 4 个 skillIds / 4 个 versionIds，目录刷新显示新增四项。
- **V9**：相同重试返回首次结果且不重复写；同 key 换 payload 返回 IDEMPOTENCY_CONFLICT。
- **V10**：另一组织不能读到首组织的 Skill/version/file/import 记录，并可独立显式导入。
- **V11**：四个 adapter 对执行型请求只声明不可用；manifest 与文件中不存在可达的 network/browser/image/TTS/shell/secret/tool 能力。
- **V12**：no-builtin capability gate 继续通过，代码中不存在默认/recommended/seed/implicit import 路径。
