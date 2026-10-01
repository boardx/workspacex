# 契约束 `work-eval` — UC 覆盖证明（支撑材料）

> 需求单源：`requirements/04-eval-gates.md`。operation 名见 `packages/contracts/src/work-eval.ts` `operations`
> （`updateWorkSkillCatalogEntry` 本体在 `work-skill-meta.ts`）。

## 一、R12 → operation → API 操作 → 前端消费点

| 行键 | R12 验收线索 | 用例 | API 操作 / CLI | 前端消费点 | feature |
|---|---|---|---|---|---|
| V1 | `eval --entity S003` 退出 0，报告含 digest 与 E1–E10 逐条 pass | UC-1/UC-2 | CLI `pnpm harness eval --entity S003` → `WorkEvalReport` | — | EV01/EV02 |
| V2 | `--baseline` 报告并列基线 | UC-2 | CLI `--baseline` → `WorkEvalReport.baseline` | `work-gate-score`（经回写后） | EV02 |
| V3 | 门脚本对 S003 打印 G0–G4 全 pass | UC-3 | CLI `lint:work-stack-gates --entity S003` → `WorkGateResult[]` | — | EV03 |
| V4 | 反证：缺 license/未登记分类/缺注入 case/过期报告/无套件各 fail 且非 0 | UC-3 | 同上 → `PROVENANCE_LICENSE_MISSING`/`CAPABILITY_UNREGISTERED`/`INJECTION_OR_DENIAL_CASE_MISSING`/`REPORT_STALE`/`NO_SUITE` | — | EV03 |
| V5 | E2/E3 坏夹具与 grader 异常为 error，整体非 0 | UC-2 | CLI → `outcome=error`，退出 1 | — | EV02 |
| V6 | G5：subject>baseline 且 E2/E3/E6 全过 → pass，PATCH verified 成功 | UC-4/UC-7 | `decideG5`；`PATCH /admin/skills/catalog/:skillId` | `work-gate-mark-verified` | EV05 |
| V7 | subject=baseline（E6）或无基线（E5）→ G5 fail，PATCH 409 | UC-4/UC-7 | 同上 → `WORK_EVAL_G5_NOT_PASSED` | `work-gate-mark-verified-reason` | EV05 |
| V8 | 平台运营回写后 GET 含当前版本 G0–G5 | UC-5/UC-6 | `POST …/gate-status`；`GET /skills/catalog/:skillId/gate-status` | `work-gate-badge-<gate>` | EV04 |
| V9 | 非平台运营回写 403，目录门状态不变（E9） | UC-5 | `POST …/gate-status` → `WORK_EVAL_PLATFORM_ADMIN_REQUIRED` | — | EV04 |
| V10 | 新版本导入后「未评测」，旧版本记录仍可查（A4） | UC-6 | `GET …/gate-status?versionId=` | `work-gate-state-not-evaluated` | EV04 |
| V11 | 成员读徽章但拿不到夹具原文 | UC-6 | `WorkGateView`（无夹具/报告路径字段） | `work-skill-gates` | EV04 |
| V12 | 跨组织读门状态被拒 | UC-6 | → `WORK_SKILL_NOT_FOUND`（RLS） | 统一 denied 出口 | EV04 |
| V13 | 非 verified Skill 被官方 Agent 绑定时被拒 | UC-7 | 装配用例读目录通道（第 5 轮 agent-role 束） | — | EV05 |
| V14 | `--all-skills --baseline` 覆盖 58 Skill，verified 数 = G5 pass 数 | UC-7 | CLI `eval --all-skills --baseline --write-back` | `work-catalog-channel-verified` 筛选 | EV05 |
| V15 | 列表行门状态缩略 | UC-6 | `WorkGateSummary` | `work-catalog-gate-summary` | EV04 |
| V16 | 报告过期黄色提示（R8/E4） | UC-6 | `WorkGateView.stale` | `work-gate-stale` | EV04 |

## 二、operation → 需求（反向）

| operation | 需求 | 孤儿？ |
|---|---|---|
| `writeBackWorkGateStatus` | R3.6、R5、E9、A4 | 否 |
| `getWorkGateStatus` | R3.10、R5、R8、A4、E4 | 否 |
| `updateWorkSkillCatalogEntryGateCheck`（追加码） | R3.8、E5/E6 | 否 |
| CLI `eval` / `lint:work-stack-gates` | R3.1–3.5、R3.9、E1–E3/E7/E8/E10/E11 | 否（非 HTTP） |

## 三、证据边界
契约与覆盖已闭合；无实现、测试或截图证据。签核与一致性复核保持 pending。

## 四、开放问题（请签核人裁决）

- **Q1 G6**：ADR-119 定义 G0–G6，本束只判 G0–G5（R6）；`WorkGateStatus.gates` 固定 6 项。G6 引入时需契约 bump。
- **Q2 门状态形状重复**：`work-skill-meta.ts` 的 `WorkSkillCatalogDetail.gates`（`not_run|passed|failed`）与本束
  `WorkGateView` 是同一事实两种形状。建议 EV04 实现时让详情的 `gates` 改为引用 `WorkGateView`（或删除，改由
  `getWorkGateStatus` 单独提供）——需改他束单源，请裁决。
- **Q3 门状态存储**：新子表 `skill_gate_records`（按版本一行）vs 在 `skill_catalog_entries` 加列。本束选子表以满足 A4「旧版本记录保留」。
- **Q4 G5 通过数口径**：只计 `deterministic=true` 的 case；必过 case 若为非确定性如何处理（建议禁止）。
- **Q5 回写范围**：R5 说平台运营只回写「官方平台组织」目录；其他组织导入同一官方 Skill 时是否复制门状态，还是各组织显示「未评测」。
- **Q6 路径口径**：ADR-119 `evals/work-stack/<ID>/` 与 PROP §4.4 两级路径冲突，本束按 ADR-119；PROP 需收敛。
- **Q7 Workflow/Agent 门**：A1 仅跑 G0/G2/G4，本束让 G1/G3/G5 判 `not_applicable`；是否应对 Workflow 也判 G3（effect-gateway 权限）。
- **Q8 数字格式**：`Sha256` 采用 `sha256:<hex>` 前缀，需与现有 `content_digest` 存储格式核对后统一。
