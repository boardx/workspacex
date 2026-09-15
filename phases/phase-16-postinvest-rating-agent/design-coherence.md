---
phase: "16"
covers_bundles: [postinvest-rating]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
---

# Phase 16（postinvest-rating-agent）一致性复核

本阶段目前只有一个契约束（`postinvest-rating`），没有第二束可以产生**束间**交叉约束——
一致性复核在「跨束打架」这个意义上退化为「确认只有一束、且它自己已签核」这一条机械检查。
但本束**大量消费阶段外已签束**的事实，下面把这些跨阶段引用逐条列出供签核参考，
不编造不存在的跨束分析。

## 一、同一事实是否在多处被重复定义

| 事实 | 权威落点 | 本束的用法 | 核查结果 |
|---|---|---|---|
| 评分口径 / 阈值 / 分级文案 | `skills/standard-finance/postinvest-rating/` 包（F01） | 契约只带回 `RatingGrade` 五档名与 `RatingGradeMeta` 投影；四份 `.md` 不含数值 | ✅ 单源（I-10） |
| 沙箱失败码 `SCRIPT_FAILED_AFTER_RETRIES` / `SANDBOX_TIMEOUT` / `SANDBOX_UNAVAILABLE` | `packages/contracts/src/skills.ts`（F962） | `PostinvestRatingError` 里**同名值**，语义引用不重定义 | ✅ 引用同名值；⚠ 两处枚举字面重复，是本仓既有做法（`error-observability` 同型），签核时确认接受 |
| `KERNEL_UNAVAILABLE` | `kernel-gateway.ts` | 同上 | ✅ 同上 |
| 组织角色 `admin` / `lead` / `consultant` / `compliance` | `identity.ts` | 本束不定义角色枚举，只在 `pre` 里引用 | ✅ |
| 聊天附件白名单 / 上限 | `chat-file-upload.ts` | 报表 / 报告上传沿用，本束不复述数值；录音**不走**它（D5） | ✅ |
| 原件不可变 + SHA-256 + 版本 | `files.ts`（`uploadArtifact`） | 录音与历史报表上传；`RatingInputFile.sha256` 是对原件哈希的引用 | ✅ |
| HITL 中断 / checkpoint | `deep-agent-hitl.ts` | 本束只定义裁决入口 `decideRatingHitl`，不定义中断形状 | ✅ |
| run 状态机 / SSE 事件 | `agent-runtime.ts` / `streaming-transport.ts` | 本束 `RatingRunPhase` 只是序列图三阶段的**粗粒度**投影，不与 `AgentKernelRunStatus` 重叠 | ⚠ 请确认 `RatingRunPhase` 不会被前端当成第二份运行状态源（它没有 `failed` / `cancelled`，终态只看内核状态） |
| 可信渠道白名单 | `postinvest-rating.ts`（本束新增，D2） | `standard-web-tools.ts` 的 `web_search` / `fetch_url` 不知道白名单，过滤在编排层 | ✅ 单源在本束；⚠ 过滤是编排层行为，不是 web 工具契约的一部分——确认不在 `standard-web-tools` 里再加一份 |

## 二、跨阶段引用的不变量是否互相矛盾

- 本束 I-2（算分只来自脚本，失败即 `failed`）vs F962 沙箱重试语义：沙箱**可以**重试脚本
  （`SCRIPT_FAILED_AFTER_RETRIES` 名字本身说明），本束禁止的是**LLM 补分**，不是沙箱重试——不矛盾。
- 本束 I-3（`confirmed` 不可逆）vs `files.ts` 原件不可变：同向；产物 `reports[].artifactId` 指向的原件
  在记录 `confirmed` 后也不会被改写（原件本来就不可变）。
- 本束 I-14（人工确认事实来自人）vs `deep-agent-hitl` 的 checkpoint 恢复：HITL 恢复值就是「人的裁决」，
  由 `decideRatingHitl` 写入——不矛盾，但**依赖** HITL 束保证「未裁决不恢复」。
- D5 vs `chat-file-upload` 已签白名单：不改白名单，用 `AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD` 在本束侧拒——
  同一 wav 在两条路径行为不同，是刻意的，见本束 `design-signoff.md` 核对项 3。

## 三、跨阶段级联是否闭合

- **反馈 → 重算 → 新版本 → 记忆**：`submitFeedback`（本束）→ 新 run（`agent-runtime`）→ IUC-2～IUC-7（本束内部）
  → `wx_memory_write`（`standard-memory`）。每一环有接手方；记忆写入失败不阻断（IUC-8）。
- **降级触发 → HITL → 落库**：IUC-3 / IUC-4（本束）→ `interrupt()`（`deep-agent-hitl`）→ `decideRatingHitl`（本束）
  → IUC-7 落库。⚠ 依赖 `deep-agent-hitl` 束对「中断类型」是否可携带本束三种语义（直接 E / 降级 / 期间不一致）——
  若该束的中断 payload 不可扩展，本束需另开 design-delta。
- **A6 关页 → 恢复**：`CreateRatingRunOutput.recordId` 占位 → `listRatingRecords` 找回 → 内核状态决定运行 / 结果态。
  闭合，但与本束待决 2（失败占位回收）绑定。

## 四、错误语义是否一致

- `NO_PROJECT_ROLE`：与 `identity` 束「两层交集鉴权」语义一致，未发明新可见性规则。✅
- `ORG_NOT_ELIGIBLE` 对外裸 404：与既有 `/agent/[teamId]` 路由 E8 行为一致。✅
- `RUN_NOT_AWAITING_HITL`：与 phase-14 `plan-permissions` 的 `RUN_NOT_AWAITING_*` 同一命名族。✅
- `ADMIN_CANNOT_CONFIRM` 与 `NO_PROJECT_ROLE` 区分：仅为页面文案；语义上都是「角色不允许」。⚠ 确认这个拆分是想要的。

## 五、待人类裁决的交叉约束汇总

1. `deep-agent-hitl` 中断 payload 能否承载本束三种中断语义（否则需 design-delta）。
2. `RatingRunPhase` 是否保留（有被当成第二份 run 状态源的风险），还是删掉只用内核状态。
3. 沙箱 / 内核错误码在本束 `err` 里**字面重复**的做法是否继续接受（与 `error-observability` 同型）。

⚠ 本束 `design-signoff.md` 目前 `status: pending`，本文件同样 `status: pending`——按 ADR-023 决策四，
一致性复核必须在束签核之后才由人类确认。本文件现在只是**声明复核范围**（`covers_bundles` 已列本阶段唯一束）
与**预先识别跨阶段引用**，不代表复核已完成。

## 六、人类裁决（签核时补充）

1. HITL payload：<可承载 / 需 design-delta>
2. `RatingRunPhase`：<保留 / 删除>
3. 错误码字面重复：<接受 / 收敛为 import>
