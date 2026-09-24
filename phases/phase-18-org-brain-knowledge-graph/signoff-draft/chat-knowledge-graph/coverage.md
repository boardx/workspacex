# 契约束 `chat-knowledge-graph` — UC 覆盖证明（支撑材料）

> 横切的一件，**两个方向都查**：
> - **判据 → API**：验收线索找不到对应 API ⇒ 接口不够，业务跑不通。
> - **API → 判据**：有 API 操作没有任何判据要它 ⇒ 接口多余，或有判据没写。
>
> 本束是待签核的新束，实现为零。本表的 `✅` 一律读作「契约面已闭合，缺口只在实现」；`⚠` 才是契约本身不够。
> 「前端消费点」填 `ui.md` 第三节的真实 `data-testid`；没有界面的写 `—（API 层验收）`。

## 一、判据 → API（五个 UC 的 R12，逐条）

### uc-18-1 会话知识入图

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 发消息 → 30 秒内出现实体与结论，挂着消息锚点 | 内部 UC-KG-9 `ingestSource` → 读 `getThreadKnowledge` / `getClaimSources` | `kg-claim-<id>`、`kg-evidence-<segmentId>` | ✅ |
| V2 | 重复触发三次，行数不变 | 内部 UC-KG-9（幂等键，I-7）；`requestReindex` | —（API 层验收） | ✅ |
| V3 | 模型身份直写 `claims` 被拒 | 执行器 + RLS（I-3） | —（API 层验收） | ✅ |
| V4 | 停 AGE，消息照发，canonical 照落；恢复后 `graph:rebuild` 一致 | 内部投影 worker + 重建脚本（ADR-114） | —（API 层验收） | ✅ |

### uc-18-2 会话内图谱与向量召回

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 20 轮后问「谁定的、为什么」，答案含两处可点回的引用 | UC-KG-10（L3 召回）→ `context-pack` 束 `ContextPack.items[]` | `kg-citation-<id>`、`kg-why-recall-body`、`kg-graph-path-<id>` | ⚠ 图路径文本字段待 D-KG-2 |
| V2 | 另一用户的会话里说过同样的事，本会话召回为空 | UC-KG-10 + RLS（I-11、I-14） | —（API 层验收） | ✅ |
| V3 | 停 AGE → 回答下方可见「图检索不可用」 | UC-KG-10 | `kg-channel-unavailable`、`kg-channel-down-graph` | ⚠ 信号载体待 D-KG-1 |
| V4 | 关系类评测集 hybrid > 纯向量 | UC-KG-10（评测脚本） | —（API 层验收） | ✅ |

### uc-18-3 本会话知识图谱视图

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 所有者确认 → 徽标变「已确认」，`reviewed_by` = 本人 | `applyHumanAction{confirmClaim}` | `kg-action-confirm-<id>`、`kg-tri-state-confirmed` | ✅ |
| V2 | 非所有者无编辑按钮；直调 API 得 `KG_NOT_OWNER` | `getThreadKnowledge.canEdit`；`applyHumanAction` err | `kg-readonly-badge`（无 `kg-claim-edit-trigger-*`） | ✅ |
| V3 | 删除 → 列表消失，DB 行仍在（superseded + revoked_at） | `applyHumanAction{revokeClaim}` | `kg-action-delete-<id>`、`kg-delete-confirm-btn-<id>` | ✅ |
| V4 | 合并两个实体 → 边全部挂到保留实体，AGE 同步 | `applyHumanAction{mergeObjects}` | `kg-action-merge-<id>`、`kg-graph-edge-<id>` | ✅ |

### uc-18-4 晋升到个人空间并跨会话召回

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 会话 A 晋升 → 新个人会话 B 召回并标「来自个人空间知识」 | `promoteToPersonal` → UC-KG-10 L1 召回 | `kg-promote-submit`、`kg-from-personal-<id>` | ✅ |
| V2 | 另一用户的个人空间零召回 | UC-KG-10 + RLS（I-14） | —（API 层验收） | ✅ |
| V3 | 晋升 proposed → `KG_PROMOTE_REQUIRES_ACCEPTED` | `promoteToPersonal.results[].rejected.code` | `kg-promo-reject-reason-<claimId>` | ✅ |
| V4 | 删会话 A 原消息 → 会话 B 5 分钟内不再召回 | UC-KG-8 `invalidateOntologyEdges`（I-10） | —（API 层验收） | ✅ |

### uc-18-5 删除与失效传播

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 删消息 → 结论 revoked、召回为空、AGE 无该边 | UC-KG-8 | `kg-evidence-revoked-<segmentId>` | ✅ |
| V2 | 两个来源删一个 → 结论仍在，证据数 2 → 1 | UC-KG-8 + `getClaimSources` | `kg-source-evidence-list` | ✅ |
| V3 | 停 AGE 再删 → 召回立即为空（canonical 过滤） | UC-KG-8 + UC-KG-10（I-11） | —（API 层验收） | ✅ |
| V4 | L0 结论失效 → L1 副本同时失效 | UC-KG-8（I-10） | —（API 层验收） | ✅ |

## 二、API → 判据（反向：每个操作都有人要）

| 操作 | 被哪些判据需要 |
|---|---|
| `getThreadKnowledge` | uc-18-1 V1、uc-18-3 V1–V4 |
| `getClaimSources` | uc-18-1 V1、uc-18-5 V2 |
| `applyHumanAction` | uc-18-3 V1–V4 |
| `requestReindex` | uc-18-1 V2、uc-18-1 E1（失败重试） |
| `promoteToPersonal` | uc-18-4 V1、V3 |
| `listPromotionNominations` | uc-18-4 A1（R12 未单列，AI 提名卡片） |
| `getPersonalKnowledge` | uc-18-4 R6 后置条件（L1 可查）；R12 未单列，⚠ 如判为多余可在签核时删 |
| 内部 UC-KG-8 / 9 / 10 | 见上表 |

## 三、feature ↔ 判据

见 `../../feature_list.json` 各 feature 的 `spec_ref`。本束 `covers` = F01…F14（全阶段）。
