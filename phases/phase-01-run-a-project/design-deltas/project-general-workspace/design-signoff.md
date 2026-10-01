---
status: confirmed              # pending | confirmed —— ⚠ 只能由人类改，agent 不许动（本 PR 由人类审阅合入即为签核动作）
bundle: project
scope: project-general-workspace
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-09-29"
confirmed_via: "对话签核（协调者经 AskUserQuestion 封闭选项呈报 PROP-PROJECT-WORKSPACE-001 §7，人类逐条勾选）——①「同意，推翻 Q-12」；②「新增 general 容器」；③「第一版就并入通用项目」（研究项目 / 用户洞察并入 general）；④「项目成员自动可编辑项目白板」。补充逐字：「现在还没有上线，所以你可以改，不需要迁移数据」「请用尽可能小变更，和快的方式来实现第一个版本」「board 也必须是项目的一部分，很重要」。"
---

# project 束 delta —— 「项目」泛化为通用工作空间（第一版）

这是一份**新的 delta 包**，修订（不重签）`contracts/project/design-signoff.md`（2026-07-30）
与 `requirements/00-project/OPEN-QUESTIONS.md` 的 **Q-12**。本文件的 `status` 归人类所有。
方案全文：`docs/proposals/PROP-PROJECT-WORKSPACE-001.md`（issue #4615）。

## 被推翻 / 修订的既有裁决

| 条目 | 原裁决 | 新裁决 |
|---|---|---|
| Q-12 | 「项目」收窄为工作坊；三类独立容器（workshop / research_project / user_insight） | 「项目」= 通用工作空间；容器两类：`general`（通用项目）与 `workshop`（可选形态） |
| U-7 / F128 | 研究 / 洞察容器不得有分组与四角色 | 不变，改为「`general` 容器不得有分组与四角色」 |
| U-1 | 研究 / 洞察各一张成员表（owner / collaborator） | 合为 `general_project_members`（owner / collaborator） |
| I-P6 | 四角色仅对 workshop 成立 | 不变 |
| I-P33 | `projects` 列集 `{id, org_id, name, status, kind}` 封闭 | 不变（第一版不加列） |

## ① UI

- 新建项目：一步——项目名称 → 创建（`kind: general`）；次要入口「用工作坊模板创建」保留原工作坊流程。
- `general` 工作台五个 tab：概览 / 内容 / 大脑 / 成果 / 设置（工作坊工作台保持现状）。
- 「内容」统一列表：对话 / 白板 / 访谈 / 问卷 / 研究 / 转写 / 设计 / 文件；新建与关联已有。
- 截图：随实现 PR 的真栈 e2e 产物补入（`apps/web/e2e/project-hub-b3-walkthrough.spec.ts` 扩展）。

## ② 用例

1. 组织成员新建通用项目 ⇒ 创建者为 owner，进入工作台。
2. owner 加 / 移协作者；协作者可进工作台、建与看项目内容；被移出即失去访问（`NO_PROJECT_ROLE`）。
3. 在项目中新建或关联：对话、白板、访谈、问卷、深度研究、转写、设计；每个内容至多属于一个项目。
4. 挂在项目上的白板：项目 owner / 协作者可编辑（与白板自身成员表取并集），组织 lead/admin 旁观只读；移出项目即撤销这条来源。
5. 内容进入项目证据（新增白板便签来源），受设置页 AI 权限开关约束；项目大脑推演（冲突 / 缺口 / 推理链）与采纳为决策对通用项目 owner / 协作者可用。
6. 工作坊形态的全部既有用例不变。

失败面：沿用现有码（`NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT` / `ORG_ROLE_INSUFFICIENT` / `PROJECT_ARCHIVED` 等），不新增错误码。

## ③ API 契约（`packages/contracts/src/`，分支 `claude/project-workspace-v1`）

- `project.ProjectKind = ["workshop", "general"]`
- `project.ProjectLinkableResourceKind` / `ProjectResourceKind` = survey、guided_research、personal_transcription、interview、whiteboard、design
- `project.ProjectAiSourceKind` 增 `whiteboard`
- `project-evidence.ProjectEvidenceSourceKind` 增 `whiteboard_note`（→ AI 来源 whiteboard）

## 未上线声明

人类确认产品尚未上线：研究项目 / 用户洞察的结构直接替换为 `general`，不做数据迁移；迁移脚本仍须可重放。
