# Sprint 00/04 — 把 phase-00 剩余 15 个 feature 一次排完：按依赖分 6 波并行推进，同一波内各 feature 互不依赖、可并行认领

- **所属阶段**: Phase 00 (shared-kernel)
- **创建于**: 2026-07-29 01:56:45

## 本 sprint 目标
把 phase-00 剩余 15 个 feature 一次排完：按依赖分 6 波并行推进，同一波内各 feature 互不依赖、可并行认领

## 领取的 feature(引用自阶段权威清单,按 id)
- F02 (P1, kernel-auth) — PostgreSQL RLS 强制隔离 + 权限沿数据链路传播：跨租户泄漏为零，且 Artifact 权限传播到 Segment/embedding/图节点/缓存/Context Pack
- F03 (P1, kernel-auth) — 管理员边界：管理员不是超级用户，个人层只见计数，读取项目内容必留痕且对项目负责人可见
- F04 (P1, kernel-artifact) — Artifact 六表数据模型 + file-first 存储契约 + S3/PG 双 canonical
- F05 (P1, kernel-artifact) — 固定快照不可变存储：定版=新增不可变 artifact_version（SHA-256 固化），改源不影响已定版、字节一致、不可删
- F06 (P1, kernel-artifact) — 三模式绑定服务（草稿/实时关联/固定快照）与项目侧回流列表契约
- F07 (P1, kernel-artifact) — 下游引用资格门控：只有固定快照可被决策引用、进验收、进报告正式版、写回图谱与组织大脑
- F08 (P1, kernel-artifact) — 回流/定版审计：provenance_events append-only 血缘 + 越权尝试安全审计 + 通知
- F09 (P1, kernel-context) — Context Pack 结构契约：items[]/claims[]/omissions[] 三段结构，每条 items 含八字段六元组、无一为空
- F10 (P1, kernel-context) — 五路并行 query-planned hybrid 召回 + 权限过滤（RLS 层）+ RRF 融合 + rerank，含带权限过滤的 pgvector recall 测试集
- F11 (P1, kernel-context) — 五种筛选动作留痕（retrievalReasons）+ 预算裁剪 + 丢弃清单可审查（omissions[]）
- F12 (P1, kernel-context) — 引用完整性校验：AI 不得引用不在本次 Context Pack 中的证据
- F13 (P1, kernel-context) — Context Pack 随定版固化 + 可重放 + 机密材料本地模型路由
- F15 (P1, kernel-org) — 能力清单是组织配置，不是产品内置
- F16 (P1, kernel-org) — 每个人有一个本地组织，最隐私的数据不出本机
- F17 (P2, kernel-org) — 把本地成果导出到正式组织——隐私承诺的唯一豁口，全程受控

> 实际工作集见同目录 `active-features.json`(脚本派生,只读,勿手改)。
> 修改功能归属:改阶段 `feature_list.json` 里对应 feature 的 `sprint` 字段,再重跑
> `pnpm harness new-sprint`(或 refresh)重新派生。

## 完成标准
- 上述每个 feature 经 `pnpm harness verify --sprint 00/04` 门控为 `passing`。
- `session-handoff.md` 与 `progress.md` 已更新。
