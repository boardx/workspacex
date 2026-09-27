# PROP-PROJECT-HUB-002 — 项目中枢第三批：大脑吃全部证据并推理（B3）

> 承接 `PROP-PROJECT-HUB-001.md` 第 4 节的缺口。原十轮计划里第 1 / 3 / 4 / 8 轮已由 #4414 / #4437 落地；
> 本批按 **6 → 7 后半 → 9 后半 → 10 后半 → 5 后半** 的依赖顺序切五个切片，子 agent 并行开发，测试由协调者统一做。

## 1. 一句话
项目大脑从「只吃 chat 证据」变成「按设置页 AI 权限吃五类证据」，并在这些证据之上做跨来源冲突检测、
缺口建议与带引用的推理链；结论能沉淀回项目决策，推理质量有一份可重复跑的评测集。

## 2. 契约先行（协调者已落，agent 不改形状只实现）
- `packages/contracts/src/project-evidence.ts`：`ProjectEvidenceSourceKind`（六类）、`ProjectEvidenceItem`、
  `listProjectEvidence` / `getProjectEvidence`。**来源枚举只此一份**；`KgEvidenceAnchor.sourceKind` 引用它，
  `PROJECT_EVIDENCE_TO_AI_SOURCE` 把六类证据投影到设置页五个开关。
- `apps/api/src/application/project/project-evidence-ports.ts`：`ProjectEvidencePort`（list / find / upsert /
  revokeBySource / listForIngestion）。T1 实现，T2 消费。

## 3. 切片
| 切片 | 计划轮 | 交付 | 依赖 |
|---|---|---|---|
| T1 证据归一化 | 6 | 表 `project_evidence` + PG 仓储 + 两个读用例 + 路由；四个采集器把问卷答卷 / 访谈片段 / 转写片段 / 深研来源写成证据单元（挂到项目的资源才采）；chat 消息证据回填 `evidenceId`；项目页「研究洞察 › 来源」真实列表 | 无 |
| T2 抽取器按 AI 权限读项目证据 | 7 后半 | 项目级入图任务：按 `project_ai_settings.allowed_sources` 从 `listForIngestion` 取证据 → 现有抽取器 → 项目作用域结论，锚点带 `evidenceId`；关掉的来源不进、已进的不删但标「来源已关闭」 | T1 端口（用 fake 先行） |
| T3 跨来源推理 | 9 后半 | `getProjectReasoning`：跨来源冲突（同一主张在两类来源里相反）、缺口建议（假设无任何来源支持 / 只有单一来源）、带引用的推理链（每一步引用 `evidenceId`）；面板新增三区 | T1 契约形状 |
| T4 成果回流 + 评测集 | 10 后半 | 「采纳为项目决策」：结论 → `decision` 类 claim + 决策记录回链；`apps/api/tests/knowledge-graph/eval/project-reasoning-eval.test.ts` 固定语料 + 断言（冲突召回率 / 引用完整率）；`pnpm run e2e:kg-experience` 不动 | T3 契约形状 |
| T5 非工作坊容器成员 + 观察者脱敏 | 5 后半 | `research_project` / `user_insight` 两类容器的 `listMembers / addMember / removeMember`（`NonWorkshopMemberRole`），观察者读项目证据时 `speakerLabel` 与 `excerpt` 脱敏 | T1 的 `speakerLabel` 字段 |

## 4. 硬约束（每个 agent 都要遵守）
- 契约不改形状（可加注释）；要加字段先在 issue 里说明，由协调者改。
- 租户表 SQL 只在 `infrastructure/`，从 `application/security/permission-filter` 拿 `guard`；`lint-permission-paths` 必须过。
- 不跑 e2e；PG 测试写好但标明未本地执行；DB-free 单测必须本地过。
- 用户可见错误文案走 `httpFailureText`；「晋升」等禁用词见 `KG_BANNED_USER_FACING_WORDS`。
- 每个切片一个分支 `claude/admiring-gauss-adgfja-b3-t<N>`，一个 commit 序列，不推送、不开 PR，完成后回报文件清单。
