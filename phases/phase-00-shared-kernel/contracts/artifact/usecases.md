# 契约束 `artifact` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 S3、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
已有原型是 happy path 演示、零异常态（`[挂到项目环节…]` `[保存]` 两个按钮点进去无任何屏），
**别继承这个缺陷**。

---

## 统一失败枚举 `ArtifactError`

前端据此渲染 R8 要求的七态之一（校验失败 / 依赖失败 / 无权限 / …）。

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `NO_PROJECT_ROLE` | 项目层无角色 | 项目层限制：你在本项目没有对应角色 | 判定属 identity 束，此处透传 |
| `PROJECT_ROLE_INSUFFICIENT` | 角色不够 | 你的角色不能定版/绑定 | 如组员不可定版（R5） |
| `STEP_CLOSED` | 目标环节已关闭/归档 | 该环节已关闭，绑定失败；内容已保留为草稿 | E2，草稿不丢 |
| `STEP_REJECTS_ARTIFACT_TYPE` | 环节不收此类产出 | 本环节不允许此类产出 | R3 步骤2 校验 |
| `VERSION_CHANGED` | 并发定版 | 版本已变化，可刷新/对比/重新定版 | E4/V6，只产生一个新版本号 |
| `REQUIRES_PINNED` | 下游引用非快照 | 需先定版为固定快照（附**一键定版**入口） | E1/AC1/F07，错误 detail 带 artifactId |
| `CANNOT_DOWNGRADE` | 快照降级 | 固定快照不可降级为实时/草稿 | A3，已定版可能已被引用 |
| `SNAPSHOT_IMMUTABLE` | 改/删已定版 | 已定版快照不可修改或删除；纠错请新增版本 | I-1/I-11/V8，并写安全审计 |
| `ARTIFACT_NOT_FOUND` | 不存在 / 草稿越权 | 找不到该产出 | ⚠ V4：草稿对非创建者返回 404 **而非 403** |
| `MATERIALIZATION_FAILED` | file-first 物化失败 | 保存失败：内容未能落成文件，请重试 | 自动保存失败**必须显式提示，不得静默**（E3） |
| `INGESTION_FAILED` | 摄取失败 | 摄取失败（扫描/解析），可查看原因并重试 | 摄取抽屉的失败态 |
| `DEPENDENCY_UNAVAILABLE` | 存储/网络不可用 | 依赖不可用，已保留当前输入与最后成功版本，可安全重试 | E3 |

⚠ 拒绝响应**不得泄露资源是否存在**——`ARTIFACT_NOT_FOUND`（草稿越权）与「真的不存在」必须不可区分。

---

## 用例

### `saveDraft` —— R3 步骤1：写草稿缓冲（file-first 物化）

```
in:  { artifactId?, orgId, projectId?: ProjectId | null, source, title }
out: { artifactId, autosavedAt, materializedKeys: string[] }
pre: 用户在四个 Studio 之一有可保存内容（无项目归属也可，A1）
err: MATERIALIZATION_FAILED | DEPENDENCY_UNAVAILABLE
```

⚠ **自动保存只走这里**：默认草稿模式，**永不改变已有绑定、永不产生固定快照**（R7）。
非文件来源在此**物化为真实文件**（问卷→responses.csv+schema.json；对话→messages.jsonl；
访谈→音频+transcript.jsonl+notes.md；AI→内容文件+provenance.json）——file-first 硬约束。

### `pinVersion` —— R3 步骤3 / A2：定版（生成不可变快照）

```
in:  { artifactId, expectedHeadVersion }        // 乐观并发
out: { versionId, versionNumber, contentHash, objectStorageKey }
pre: 调用者在该项目有写权限（两层交集，属 identity 束）；组员不可定版（R5）
err: PROJECT_ROLE_INSUFFICIENT | VERSION_CHANGED | MATERIALIZATION_FAILED | DEPENDENCY_UNAVAILABLE
```

对当前内容做**不可变复制** → `artifact@vN`，固化 SHA-256，记录定版人/时间/Context Pack 引用清单。
`expectedHeadVersion` 不匹配即 `VERSION_CHANGED`（E4/V6：并发只产生一个新版本号）。
性能（R9）：3 秒内完成；超 10 秒转后台任务并允许离开页面——**这是契约的一部分**，界面据此渲染排队/运行/完成/失败。

### `bindToProjectStep` —— R3 步骤2-4：三模式挂到项目环节

```
in:  { artifactId, projectId, stepId, mode: "draft"|"live"|"pinned", sourceVersionId? }
out: Binding
pre: 调用者对该项目该环节有写权限；pinned 模式必须提供 sourceVersionId
err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT | STEP_CLOSED
   | STEP_REJECTS_ARTIFACT_TYPE | ARTIFACT_NOT_FOUND | DEPENDENCY_UNAVAILABLE
```

- `draft` → 仅本人可见，**不产生项目侧绑定行**（I-12）。
- `live` → 项目侧出现，`pinnedVersionId = null`，读取解析到当前最新版；标注「实时·随源变动」。
- `pinned` → `pinnedVersionId = sourceVersionId`，冻结；此后源改动不影响它（I-8）。

### `upgradeBinding` —— A2/A3：实时关联升级为固定快照

```
in:  { bindingId, expectedHeadVersion }
out: Binding                                     // mode 变为 pinned
pre: 调用者有写权限
err: CANNOT_DOWNGRADE | VERSION_CHANGED | PROJECT_ROLE_INSUFFICIENT | ARTIFACT_NOT_FOUND
```

⚠ **只升不降**：`pinned → live/draft` 一律 `CANNOT_DOWNGRADE`（I-11）。

### `listBackflow` —— 项目侧「已回流的产出与版本」（F06 / AC3）

```
in:  { projectId, stepId? }
out: BackflowEntry[]                             // 每条 mode/version/pinnedBy/pinnedAt 非空
pre: 调用者对该项目可见
err: NO_PROJECT_ROLE
```

⚠ **草稿不在此列表**（I-12）。空态返回 `[]`，**不生成伪数据**（V5）。徽标：草稿 / 实时·随源变动 / 已定版 vN。

### `referenceForDownstream` —— **下游引用资格门控**（F07，本用例价值核心）

```
in:  { versionId, purpose: "report-final"|"acceptance"|"decision-reference"|"graph-writeback"|"brain-promotion",
       referencedBy: {kind, id} }
out: { referenceId, eligible: true }
pre: —
err: REQUIRES_PINNED | SNAPSHOT_IMMUTABLE | ARTIFACT_NOT_FOUND
```

⚠ AC1：**只有固定快照可被决策引用、进验收、进报告正式版、写回图谱与组织大脑**。
对 live/draft 一律 `REQUIRES_PINNED`（错误 detail 带 `artifactId`，界面据此给一键定版入口，E1）。
> 定版是**必要非充分**条件：需验收的产出还须经 UC-13.2 验收后才获证据资格（R7，下游）。

### `getIngestionStatus` —— 摄取九态抽屉

```
in:  { artifactId }
out: IngestionRun                                // status ∈ 九态 + REVIEW_PENDING
err: ARTIFACT_NOT_FOUND | INGESTION_FAILED
```

### `queryProvenance` —— 审计检索（F08 / V7）

```
in:  { artifactId?, actorId?, mode?, since?, until? }
out: ProvenanceEvent[]                           // 按操作者/时间/Artifact/模式检索
err: NO_PROJECT_ROLE
```

⚠ **跨束**：identity 束的 `mutateCapability` 也写 `provenance_events`。见 coverage 缺口①：
应是**统一的** provenance 查询面，不要每束各造一个（这是第七次「同一事实声明在多处」的高发点）。

### `markEvidenceWithdrawn` —— E5：上游证据被撤回

```
in:  { versionId, reason }
out: { annotatedReferences: string[], notifiedApprovers: string[], provenanceEventId }
pre: —
err: ARTIFACT_NOT_FOUND | DEPENDENCY_UNAVAILABLE
```

⚠ **不修改快照内容**（快照不可变）；改为在引用处标注「证据已撤回」，并通知拍板人复核
（**不自动改已签字决策**）。写一条 `evidence-withdrawn` 的 provenance 事件。

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `ObjectStore` | 原件/派生物读写；**写一次不覆盖**（I-2） | S3（bucket 版本化 + object-lock） |
| `ArtifactRepository` | artifacts / artifact_versions / segments / anchors 元数据 | PostgreSQL（RLS 强制） |
| `DerivedRepository` | derived_representations | PostgreSQL |
| `ProvenanceWriter` | **append-only** 事件（I-9） | PostgreSQL |
| `BindingRepository` | 三模式绑定与回流列表 | PostgreSQL |
| `IngestionQueue` | 摄取九态、幂等键、重试（transactional outbox） | 队列 + worker |
| `Hasher` | SHA-256 计算与校验（I-3） | 标准库 |

⚠ `ObjectStore` 的「写一次不覆盖」**不能只是应用层不去覆盖**——I-2 要求对象存储层可断言
（bucket 配置强制），否则灾备/误操作会悄悄毁掉原件而哈希校验才发现。
