# 契约束 `work-skill-meta` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层；形状单源为 `packages/contracts/src/work-skill-meta.ts`，此处不复述字段，只写行为。

## 统一失败枚举

| 错误 | HTTP | 语义 |
|---|---|---|
| `WORK_SKILL_MANIFEST_INVALID` | 422 | frontmatter 缺字段/类型错/依赖非分类格式；附 `issues[{file, fieldPath, message}]`（E1） |
| `WORK_SKILL_CAPABILITY_UNREGISTERED` | 422 | 依赖分类未登记（E6） |
| `WORK_SKILL_PROVENANCE_LICENSE_MISSING` | 422 | provenance 缺 license 或 copied 无 notice（E8） |
| `WORK_SKILL_STABLE_ID_CONFLICT` | 409 | stableId 与组织内另一 Skill 冲突；附 `conflictingSkillId`（E2） |
| `WORK_SKILL_NOT_FOUND` | 404 | 不存在或跨组织，不区分（R5） |
| `WORK_SKILL_ADMIN_REQUIRED` | 403 | 非管理员调用写接口（E9） |
| `WORK_SKILL_CHANNEL_TRANSITION_INVALID` | 409 | 非法转移 / 缺门证据 / `expectedChannel` 不一致；附 `allowedTransitions`（E4） |
| `WORK_SKILL_SUCCESSOR_INVALID` | 422 | 后继不存在/自指/成环（E3） |
| `WORK_SKILL_IDEMPOTENCY_CONFLICT` | 409 | 同键不同 payload |
| `UNAUTHENTICATED` | 401 | 未登录 |

## UC-1 `lintWorkSkillManifests`（WS01，本地/CI）
in: 仓库内所有 `skills/**/SKILL.md`；out: 退出码 + 逐条 `file / fieldPath / message`。
只解析含 `metadata.work` 的文件；无该键的普通 Skill 跳过（A1）。

## UC-2 `importSkillStarterPack` 扩展（WS02）
复用现有 operation；在现有摘要校验之后、写库之前，对每个含 `metadata.work` 的 SKILL.md 执行
`WorkSkillManifest` 解析 + 分类登记检查 + provenance 检查。全部通过后**同一事务**：写
`skill_versions.manifest.work`，并 upsert `skill_catalog_entries`（新行 `channel=candidate`；已有行只刷新检索字段，不回退通道）。
任一失败 → 整体回滚，`skill_versions` 行数不变。A2：新版本产生新 skill_versions 行，旧版本 manifest 可按 `versionId` 读取。

## UC-3 `listWorkSkillCatalog`（WS03）
`GET /skills/catalog`；按 `domain/channel/q/includeDeprecated/cursor`。`q` 非空按相关度（名称、stableId、domain、描述；中英文），空按 stableId。
deprecated 默认隐藏。每行附就绪性摘要，**批量计算，禁止 N+1**（R9）。

## UC-4 `getWorkSkillCatalogEntry`（WS03）
`GET /skills/catalog/:skillId[?versionId]`；返回 manifest 明细、门状态占位、版本列表、后继、`canManageChannel`。

## UC-5 `updateWorkSkillCatalogEntry`（WS03）
`PATCH /admin/skills/catalog/:skillId`；管理员（本组织）或平台运营（仅平台组织）。校验：`expectedChannel` 一致 → 转移表 →
`candidate→verified` 需 `gateEvidenceRef` → 后继合法性（存在、非自身、无环）。成功写审计事件（操作者、前后通道、时间、证据引用）。

## UC-6 `getWorkSkillReadiness`（WS04）
`GET /skills/catalog/:skillId/readiness[?versionId]`；对 required ∪ optional 每个分类：分类未登记 → `missing/CATEGORY_UNREGISTERED`；
有已授权启用工具 → `satisfied`；有工具但授权被拒 → `denied/GRANT_DENIED`；无工具 → `missing/NO_ENABLED_TOOL`。
全部 required satisfied → `ready`；optional 缺失不影响。工具授权查询失败 → 200 + `overall=unknown`（E5）。
不写缓存；Workflow Runtime / Agent 装配（系统 Actor）经同一应用服务调用，不绕过 RLS。
