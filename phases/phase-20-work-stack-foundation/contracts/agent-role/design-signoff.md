---
bundle: agent-role
phase: "20"
covers: [AG01, AG02, AG03, AG04, AG05, AG06, AG07]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-28T16:30:00Z"
confirmed_via: "人类在 GitHub 亲自签核"
---

# 契约束 `agent-role` 设计签核

> 2026-09-28 人类授权：本束可先开发、后补签。**签核状态只由人类修改**；agent 不填
> `confirmed_by` / `confirmed_at`，本文件保持 `pending`。

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| AG01 | 角色冻结字段契约（`AgentRoleFields`）+ `agent_versions` 迁移回填 + `SNAPSHOT_FROZEN_FIELDS` 接入 |
| AG02 | starter-pack `toolPolicy` 放宽为能力分类 + DB CHECK 替换 |
| AG03 | 官方角色包 D002/D003/D005/D011 内容与按组织导入（`UNRESOLVED_*_REF`） |
| AG04 | 头像组件、成员 Agent 目录页、管理详情「角色」区块 |
| AG05 | Workflow 白名单执行校验（`workflow_not_allowed`） |
| AG06 | `escalate` 中断 kind + decision-guard |
| AG07 | handoff（`HANDOFF_NOT_ALLOWED`，接收方以发起人身份重读） |

依据：`requirements/03-agent-role.md` R1–R12；ADR-116 #3、ADR-118 #6/#9、ADR-119 #4、ADR-120 #1–#3、ADR-121 #2；PROP-WORK-STACK-001 修订 R1 与 §4.3。

## 一、材料清单

- ① UI：`ui.md`（截图位 `ui-preview/agent-role/agent-directory.png`，并行产出中）。
- ② 用例：`usecases.md`（UC-1～UC-7 + 统一失败枚举）。
- ③ API 契约：`packages/contracts/src/agent-role.ts`（单一事实源；7 个 operation + 导入端点追加失败码 + escalate/handoff 载荷）。
- 支撑·领域：`domain.md`（I-1～I-14）。支撑·覆盖：`coverage.md`（R12 → operation → 前端消费点）。

## ① UI

- [ ] 成员目录作为新顶层路由 `/agent`（与 `/skill` 平行），按 `roleCategory` 分组卡片。
- [ ] 卡片信息层级：插画头像 / 名称 / roleLabel / 官方徽标 / 可发起 Workflow 列表 / 就绪状态（成员只见「可用 / 能力未就绪」）。
- [ ] 管理详情「角色」区块：官方 Agent 白名单/策略只读并提示「克隆后可改」。
- [ ] escalate 卡片、handoff 确认卡片的形态（目前**无截图**，见 ui.md 缺口）。

## ② 用例

- [ ] 导入原子性：非法 toolPolicy / 未解析引用 → 整包失败、DB 无新增行。
- [ ] toolPolicy 永不产生授权；写分类须管理员显式授予。
- [ ] 白名单拒绝不静默改走其它 Workflow；escalate 不超时自动批准；handoff fail closed。

## ③ API 契约

- [ ] 7 个 operation 的路径、入参、出参与错误码（`agent-role.ts` `operations`）。
- [ ] 跨组织 / visibility 不覆盖一律 404。
- [ ] 导入端点复用 `POST /admin/agents/starter-pack-imports`，只追加 `AgentRoleImportError` 码。

## 待签核人裁决的开放问题

见 `coverage.md` 第四节。
