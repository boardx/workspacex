---
bundle: work-skill-meta
phase: "20"
covers: [WS01, WS02, WS03, WS04, WS05]
status: pending
---

# 契约束 `work-skill-meta` 设计签核

> 2026-09-28 人类授权：本束可先开发、后补签。**签核状态只由人类修改**；agent 不填
> `confirmed_by` / `confirmed_at`，本文件保持 `pending`。

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| WS01 | `WorkSkillManifest` Zod 契约 + SKILL.md frontmatter lint |
| WS02 | starter-pack 导入接入 manifest 校验 + `skill_catalog_entries` 迁移/仓储（原子） |
| WS03 | 目录/搜索/详情读接口 + 通道/后继写接口（审计） |
| WS04 | 依赖就绪性计算（能力分类 × 已授权启用工具）与读接口 |
| WS05 | `/skill?screen=work-catalog` 目录屏与详情抽屉 |

依据：`requirements/01-skill-catalog.md` R1–R12；ADR-116、ADR-117（权威）、ADR-118 #9、ADR-119、ADR-120。

## 一、材料清单

- ① UI：`ui.md`（截图位 `ui-preview/skill-catalog/`，与 WS05 `design_ref` 一致）。
- ② 用例：`usecases.md`（UC-1～UC-6 + 统一失败枚举）。
- ③ API 契约：`packages/contracts/src/work-skill-meta.ts`（单一事实源；四个 HTTP operation + 导入端点新增失败码）。
- 支撑·领域：`domain.md`（I-1～I-12）。支撑·覆盖：`coverage.md`（R12 → operation → 前端消费点）。

## ① UI

- [ ] 目录屏作为 `/skill` 的新屏 `?screen=work-catalog`，不另起顶层路由。
- [ ] 列表行字段、通道徽章、就绪性三态徽章（ready / 缺 N 项 / unknown）的信息层级。
- [ ] deprecated 默认隐藏、勾选才显示；空态带“清除筛选”；unknown 只做局部提示不整页报错。
- [ ] 非管理员完全不渲染“变更通道/设置后继”按钮。

## ② 用例

- [ ] 导入原子性：任一 Work Skill manifest 非法，整个 starter-pack 422 且不写任何行。
- [ ] 通道转移表仅 `candidate→verified|deprecated`、`verified→deprecated`；deprecated 终态。
- [ ] 门判定脚本落地前 `candidate→verified` 需人工 `gateEvidenceRef`，是否接受。
- [ ] 就绪性不缓存、授权查询失败 → `unknown`，且不能用同分类其他供应商替代被拒授权。

## ③ API 契约

- [ ] 四个 operation 的路径、入参、出参与错误码（见 `work-skill-meta.ts` `operations`）。
- [ ] 跨组织与不存在一律 404（不泄露存在性）。
- [ ] 导入端点复用 `POST /admin/skills/starter-pack-imports`，只追加 `WorkSkillImportError` 码。

## 待签核人裁决的开放问题

见 `coverage.md` 第四节。
