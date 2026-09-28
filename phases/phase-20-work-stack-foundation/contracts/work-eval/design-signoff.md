---
bundle: work-eval
phase: "20"
covers: [EV01, EV02, EV03, EV04, EV05]
status: pending
---

# 契约束 `work-eval` 设计签核

> 2026-09-28 人类授权：本束可先开发、后补签。**签核状态只由人类修改**；agent 不填
> `confirmed_by` / `confirmed_at`，本文件保持 `pending`。

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| EV01 | `WorkEvalSuite` / `WorkEvalCase` Zod + S003 首个套件 |
| EV02 | `pnpm harness eval --entity` 回环运行器 + `WorkEvalReport` |
| EV03 | `lint-work-stack-gates` G0–G4 门脚本 + 反证测试，产出 `WorkGateStatus` |
| EV04 | 门状态回写 `POST /admin/skills/catalog/:skillId/gate-status` + 目录详情门状态区 |
| EV05 | G5 基线批量评测 + `candidate→verified` 以门状态为准 |

依据：`requirements/04-eval-gates.md` R1–R12；ADR-119（权威）、ADR-117、ADR-118 #9、ADR-120、ADR-116。

## 一、材料清单

- ① UI：`ui.md`（截图 `ui-preview/work-eval/gate-status-panel.png`，已产出）。
- ② 用例：`usecases.md`（UC-1～UC-7 + 统一失败枚举）。
- ③ API 契约：`packages/contracts/src/work-eval.ts`（单一事实源）。
- 支撑·领域：`domain.md`（I-1～I-14）。支撑·覆盖：`coverage.md`。

## ① UI

- [ ] 门状态区位于 `/skill?screen=work-catalog` 详情抽屉（work-skill-meta 已预留的 `work-skill-gates`），不另起页面。
- [ ] 六枚徽章四态（pass / fail / 不适用 / 未评测），悬停显示原因 + 判定时间；报告过期黄色提示。
- [ ] 列表行只显示 G4/G5 缩略。
- [ ] 「标为 verified」仅平台运营可见，G5 未过时灰显并给原因。
- [ ] 成员看不到夹具原文与 grader 细节。

## ② 用例

- [ ] 无套件 = G4 fail（不是 not_applicable）；error 永不计 pass；持平基线即 G5 fail。
- [ ] 只接受门脚本产出的 `WorkGateStatus`；任何角色不能手改门字段。
- [ ] 回写失败不写半截，目录保留旧门状态；新版本门状态初始「未评测」，旧版本记录保留。
- [ ] Workflow/Agent 套件本阶段只跑 G0/G2/G4，G5 只对 Skill 强制。

## ③ API 契约

- [ ] 两个新 operation + `PATCH /admin/skills/catalog/:skillId` 追加 `WORK_EVAL_G5_NOT_PASSED`。
- [ ] 回写仅平台运营（403），跨组织/不存在 404。
- [ ] 套件/报告/门状态格式（`suite.json`、`cases.jsonl`、`reports/<runId>.json`）。

## 待签核人裁决的开放问题

见 `coverage.md` 第四节。
