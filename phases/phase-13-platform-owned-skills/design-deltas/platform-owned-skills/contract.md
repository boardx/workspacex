# contract · 平台级 skill 全局可见——docx/xlsx/pdf/pptx 四个官方 skill 对所有 org 默认可用，不需要逐个导入

> 规范唯一来源。签核口径见同目录 `design-signoff.md`，验收口径见 `verification.md`。
> 触发缘由：人类明确指出"这些 skill 应该是所有的 org 都可以用的，不需要导入到任何的
> org，请检查现在的系统逻辑"。

## §0 现状核实（读代码，不是猜的）

- `skills`/`skill_versions`/`skill_version_files`/`capability_listings` 四张表都是
  `FORCE ROW LEVEL SECURITY`，策略恒为 `USING (org_id = current_setting('app.current_org'))`
  ——没有任何跨组织读的例外。
- `pg-skill-contract-repository.ts` 的 `listAll()`/`loadMountableRow()`、
  `pg-agent-run-repository.ts` 的 `readPinnedSkills()`、`pg-capability-repository.ts`
  的 `listByKind()`/`listAll()`/`findById()` 全部 `WHERE org_id = $1`，strictly 按调用者
  自己的组织查。
- **结论**：docx-create/xlsx-create/pdf-create（F979）与 pptx-create（F962）四个官方
  skill，即使已经通过 starter-pack 导入进了某个组织，也**只有那一个组织**能挂载/执行
  它们——不是"做完就能用"，是"做完了但只有导入过的那个 org 能用"。这正是人类这次要求
  检查、并确认要修的那件事。

## §1 已有先例：canvas 模板的 platform-org 模式，直接复用

- `PLATFORM_ORG_ID = "org-platform"`（人类已裁决过一次的服务组织，唯一成员
  `svc-platform-templates` 结构上不可登录）+ 一条**额外的** RLS `FOR SELECT` 策略
  （与既有租户策略并存，Postgres 对多条 permissive 策略取 OR）+ 查询层
  `WHERE (org_id = $1 OR org_id = PLATFORM_ORG_ID)`——canvas 模板（`20260826120000_
  platform_canvas_template_library.sql`）已经用这套机制解决过同一个问题。

## §2 与 canvas 模板的一处关键差异：不需要"用时 fork"

canvas 模板选了 **B2（全局母版 + 用时 fork）** 而不是"母版直接可用"，唯一原因是
`canvas_template_bindings` 对模板的引用是**复合外键**（含 `org_id`），母版行的 org_id
是 `org-platform`、绑定行的 org_id 是使用者的真实组织，两者不相等 ⇒ 外键指不到，逼得
必须先 fork 成组织自有行。

**skill 没有这个约束**：`thread_skill_mounts_skill_fk`（`(skill_id, org_id) REFERENCES
skill_contracts (id, org_id)`）已经在 issue #1534 被**整个 DROP 掉**——注释原话："a
single FK cannot point at two tables"（model A `skill_contracts` 与 model B
`skills`/`skill_versions` 并存），改成应用层（`SkillVisibilityPort.visibleTo()`）
在 INSERT 之前做存在性校验，`agent_versions.skill_version_ids` 也是同样的"无 FK，
校验在应用层"先例。

⇒ skill 可以直接走 **"母版直接可用"（不需要 fork）**：`thread_skill_mounts` 里
`skill_id`/`version_id` 直接指向 `org-platform` 下的真实行，`org_id` 列仍然是挂载方
自己的组织（不违反该表的 RLS 租户策略），应用层的可见性判定只要认得"这行是平台行"
即可放行。比 canvas 模板的实现更简单——不需要 fork 用例，不需要"我的/平台推荐"两个
分区 UI。

## §3 范围：只把四个官方 skill 做成平台级，不是"所有 skill"

只有本仓自己原创实现、复用度最高的四个 skill 走平台级：pptx-create（F962）、
docx-create/xlsx-create/pdf-create（F979）。**用户/组织自己通过 URL 导入或 starter-pack
导入的任意 skill 依然严格按 org 隔离**——这是一个安全边界，不因为"平台机制存在了"就
默认放宽：一个组织导入的第三方 skill 内容（可能含未经审查的提示词/脚本约定）不该对
其它组织可见，只有本仓自己审过、原创写的四个官方 skill 才进平台库。

## §4 改动点（全部只加 SELECT 能力，不动任何写路径）

1. **新迁移**：`skills`/`skill_versions`/`skill_version_files`/`capability_listings`
   各加一条 `_platform_read` SELECT 策略（`USING (org_id = 'org-platform')`），与既有
   `_tenant`（`FOR ALL`）策略并存，同 canvas 模板那条注释的同一条纪律："只放宽读，
   不动写"。
2. **`PLATFORM_ORG_ID` 常量**：从 `domain/canvas/platform-org.ts`（canvas 专属模块）
   挪到 `domain/org-id.ts`（更贴近这个值真正的性质——它不是 canvas 概念，是"平台组织"
   这个跨域概念），canvas 那边改成 re-export，不产生第二个声明（`ports.ts` 里
   `DEEP_AGENT_PROVIDER_NAME` 已经用过同一招）。
3. **查询层各加一次 `OR org_id = PLATFORM_ORG_ID`**：
   - `pg-skill-contract-repository.ts`：`listAll()`、`loadMountableRow()`。
   - `pg-agent-run-repository.ts`：`readPinnedSkills()`（运行时真正取内容那一处——
     漏了这处会让"能看到、能挂上，但一执行就 `SKILL_VERSION_UNAVAILABLE`"，是最容易
     漏掉、也最难在人工测试里发现的一处）。
   - `pg-capability-repository.ts`：`listByKind()`、`listAll()`、`findById()`。
4. **`SkillVisibilityPort.visibleTo()` / `loadMountableRow()` 的可见性判定**：确认平台行
   的 `visibility`/`status` 映射与既有 wave2 行一致（`org-wide`/`已启用`），不需要新增
   判据分支——它们已经是"能查到就能挂"，平台行只是多了一个能查到的来源。
5. **backfill 脚本**：`apps/api/scripts/backfill-platform-skills.ts`（同
   `backfill-platform-org.ts`/`backfill-canvas-builtin-templates.ts` 先例：幂等、
   人类显式触发、不 wire 进任何自动流程），直接在 `org-platform` 下创建四个 skill 的
   `skills`/`skill_versions`/`skill_version_files`/`capability_listings` 行（内容复用
   F979 的 `apps/api/scripts/office-docs-skill-content.ts` 三份 + 新写一份 pptx 的
   `SKILL.md`），跳过 starter-pack 导入流程（那条路径要求一个真实 org admin 身份，
   平台组织唯一成员结构上不可登录）。

## §5 明确不做

- 不做"fork 到组织自己名下"这条 canvas 模板有的能力——skill 不需要它（§2）。
- 不放宽用户自己导入的第三方 skill 的可见性——只有本仓官方四个 skill 进平台库。
- 不改任何 skill 的执行机制（沙箱/隔离/失败码/重试/渐进式加载）——这些已经在
  F962/F979/`skill-lazy-loading` 三个 delta 里签过，本 delta 只解决"谁能挂载/看到
  这四个 skill"，不碰"挂载之后怎么执行"。
