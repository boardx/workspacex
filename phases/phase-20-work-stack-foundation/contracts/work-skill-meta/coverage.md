# 契约束 `work-skill-meta` — UC 覆盖证明（支撑材料）

> 需求单源：`requirements/01-skill-catalog.md`。operation 名见 `packages/contracts/src/work-skill-meta.ts` `operations`
> （`importSkillStarterPack` 在 `wave2-runtime.ts`）。

## 一、R12 → operation → API 操作 → 前端消费点

| 行键 | R12 验收线索 | operation / 用例 | API 操作 | 前端消费点 | feature |
|---|---|---|---|---|---|
| V1 | 导入 S003 后 `manifest.work.stableId='S003'`，目录一行 candidate | UC-2 | `POST /admin/skills/starter-pack-imports` | —（管理员导入，目录屏随后可见） | WS02 |
| V2 | `?q=search` 与 `?domain=Shared` 均返回 S003 | UC-3 | `GET /skills/catalog` | `work-catalog-search`、`work-catalog-domain-filter`、`work-catalog-row-S003` | WS03/WS05 |
| V3 | 详情 provenance 含 commit 与 Apache-2.0 | UC-4 | `GET /skills/catalog/:skillId` | `work-skill-provenance` | WS03/WS05 |
| V4 | 删 `riskClass` 的 fixture 使 lint 非 0 并打印字段路径 | UC-1 | —（CLI；门控 `pnpm --filter api exec vitest run tests/work-skill/manifest-frontmatter-lint.test.ts`） | — | WS01 |
| V5 | E1/E6/E8 返回 422 且 skill_versions 行数不变 | UC-2 | `POST /admin/skills/starter-pack-imports` → `WORK_SKILL_MANIFEST_INVALID` / `_CAPABILITY_UNREGISTERED` / `_PROVENANCE_LICENSE_MISSING` | — | WS02 |
| V6 | E2 stableId 冲突 409 | UC-2 | 同上 → `WORK_SKILL_STABLE_ID_CONFLICT` | — | WS02 |
| V7 | E3 后继自指/成环 422 | UC-5 | `PATCH /admin/skills/catalog/:skillId` → `WORK_SKILL_SUCCESSOR_INVALID` | `work-skill-set-successor` 错误提示 | WS03/WS05 |
| V8 | E4 deprecated→verified 409 | UC-5 | 同上 → `WORK_SKILL_CHANNEL_TRANSITION_INVALID` | `work-skill-change-channel`（仅显示 `allowedTransitions`） | WS03/WS05 |
| V9 | 授权全部 required → ready | UC-6 | `GET /skills/catalog/:skillId/readiness` | `work-catalog-readiness-badge`、`work-skill-deps-required` | WS04/WS05 |
| V10 | 撤销一个工具授权 → 该项 missing，整体非 ready | UC-6 | 同上 | 同上（“缺 N 项”） | WS04/WS05 |
| V11 | 授权查询失败 → unknown（E5） | UC-6 | 同上（200 + `overall=unknown`） | `work-catalog-readiness-unknown` | WS04/WS05 |
| V12 | optional 缺失仍 ready（A4） | UC-6 | 同上 | `work-skill-deps-optional`（“功能降级”） | WS04/WS05 |
| V13 | A1 无 metadata.work 导入成功且不在目录 | UC-2、UC-3 | `POST …/starter-pack-imports`；`GET /skills/catalog` | 目录屏无该行；`library` 屏不变 | WS02 |
| V14 | A2 新版本后旧版本 manifest 可按版本读 | UC-4 | `GET /skills/catalog/:skillId?versionId=` | `work-skill-versions` | WS02/WS03 |
| V15 | 成员 PATCH 403 且 UI 无通道按钮 | UC-5、UC-4 | `PATCH …` → `WORK_SKILL_ADMIN_REQUIRED`；详情 `canManageChannel=false` | `work-skill-change-channel` 不渲染 | WS03/WS05 |
| V16 | 其他组织读 S003 404；未登录 401 | UC-3/4/6 | 各 GET → `WORK_SKILL_NOT_FOUND` / `UNAUTHENTICATED` | 统一 denied 出口 | WS03 |
| V17 | UI 显示 S003 行与就绪性徽章 | UC-3 | `GET /skills/catalog` | `work-catalog-row-S003` | WS05 |
| V18 | 搜索无结果显示空态与清除筛选 | UC-3 | `GET /skills/catalog`（空 items） | `work-catalog-state-empty`、`work-catalog-clear-filters` | WS05 |
| V19 | 勾选“显示已废弃”才出现 deprecated | UC-3 | `GET /skills/catalog?includeDeprecated=true` | `work-catalog-include-deprecated` | WS03/WS05 |

## 二、operation → 需求（反向）

| operation | 需求 | 孤儿？ |
|---|---|---|
| `importSkillStarterPack`（扩展） | R3.3/3.4、E1/E2/E6/E8、A1/A2 | 否 |
| `listWorkSkillCatalog` | R3.5/3.6、A3、E7 | 否 |
| `getWorkSkillCatalogEntry` | R3.7、R3.10、A2 | 否 |
| `getWorkSkillReadiness` | R3.8、A4、E5/E6 | 否 |
| `updateWorkSkillCatalogEntry` | R3.9、E3/E4/E9 | 否 |

## 三、证据边界
契约与覆盖已闭合；无任何实现、测试或截图证据。签核与一致性复核保持 pending。

## 四、开放问题（请签核人裁决）

- **Q1 束名**：任务指定束 `work-skill-meta`，但 `feature_list.json` WS01–WS05 的 notes 写“契约束 skill-catalog”，
  WS05 `design_ref` 为 `ui-preview/skill-catalog/work-catalog-screen.png`。已收敛：截图目录统一为 `ui-preview/skill-catalog/`，由 `ui-material-map.json` 映射。
- **Q2 门数量**：ADR-119 标题与正文为 G0–G6（G6 生产），计划与任务描述写 G0–G5。契约按 ADR 取 G0–G6；verified 只要求 G5。
- **Q3 就绪性计算位置**：ADR-117 后果写“由 `resolve-runtime-context` 计算”，requirements R1 称其现无此能力、为本域新增。建议独立 readiness 用例、由 resolve-runtime-context 调用，是否接受。
- **Q4 分类登记**：ADR-120 未落地时是否接受本域先建最小分类登记常量表（R10）。
- **Q5 riskClass 与 domain 取值**：契约定 riskClass=`low|medium|high`、domain 为自由字符串（≤64），需确认是否应为封闭枚举。
- **Q6 门证据**：门脚本前 `candidate→verified` 由人工 `gateEvidenceRef` 放行，谁有权提交（管理员 vs 仅平台运营）。
- **Q7 导入错误码**：新增码放在本文件 `WorkSkillImportError`，未合并入 `wave2-runtime.ts` 的 `SkillStarterImportError`（避免改他束单源）；实现时需让导入端点的 `err` 联合两者。
