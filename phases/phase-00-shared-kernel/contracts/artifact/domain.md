# 契约束 `artifact` — ① 领域模型与不变量

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 S3、不知道 PostgreSQL。
> 覆盖 feature：**F04 F05 F06 F07 F08**（phase-00，合计 21 点）
> 依据：`uc-0-1 把 Studio 产出保存回项目`
> 裁决：D-30（引用必须指向不可变快照）· O-01（快照不可删不受留存期约束）· O-39（法定留存清单，外部输入）
> 架构对齐：`docs/architecture/context-engine.md` 第二节（六表）、第 2.0 节（file-first）、第三节（摄取九态）、第六节（S3/PG 双 canonical）

> ⚠ **[待确认]**：原型说明页把本协议定义指向「UML 文档第 13 节」，该文档不在仓库中。
> 本设计是依据原型证据链反推，D-38 已裁定反推设计为权威；若该 UML 文档出现需校对本设计。

---

## 一、实体与值对象

### `Artifact`（实体）—— 逻辑对象

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `ArtifactId` | |
| `orgId` | `OrgId` | 租户隔离键（RLS） |
| `projectId` | `ProjectId \| null` | **可空**：Studio 可独立发起、不依赖项目（A1「不属于任何项目」） |
| `source` | 7 类枚举 | survey / conversation / interview / prototype-run / research-run / upload / ai-generated |
| `synthesized` | `boolean` | **AI 生成醒目标记**，不得在检索中伪装成一手证据（architecture 187 行） |
| `scope` | `"org-wide" \| "team-only"` | 资源可见性范围，**必须沿数据链路传播**（见 I-13，跨束） |

### `ArtifactVersion`（实体）—— **不可变版本**，S3/PG 双 canonical 的落地点

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `artifactId` / `versionNumber` | | 版本号在一个 artifact 内单调唯一 |
| `objectStorageKey` | `string` | **S3 原件 canonical**，写入后永不覆盖 |
| `contentHash` | `string` | **SHA-256**，可校验（I-3） |
| `mime` / `sizeBytes` | | |
| `pinnedBy` / `pinnedAt` | | 定版人 / 定版时间 |
| `contextPackId` | `ContextPackId \| null` | 定版时的引用清单（见 UC-0.2） |

⚠ **「固定快照」= 一条 `ArtifactVersion` 记录**（S3 key + SHA-256 + MIME + 版本号），
写入后永不覆盖——**不是应用层的一个布尔标记**（R7 / AC2 的技术实现即此）。
PG 里只有指针 + 哈希，**没有文件体**：PG 无法从指针恢复丢失的文件（架构第六节）。

> **草稿缓冲 ≠ 版本**：R3 步骤1 的 `[保存]` 只写 Artifact 的**可变草稿缓冲**，
> 自动保存也只碰它，**不产生 `ArtifactVersion`**（R7）。
> `pinVersion`（定版）才把当前内容冻结成一条不可变版本。
> 上传/摄取来源的原件在 `STORED` 即产生 v1（原件天然不可变）。

### `Segment` / `Anchor`（实体）—— 可引用最小单元与回溯锚点

`Segment` 挂在某个 `artifactVersionId` 下（不是挂在可变的 Artifact 上）。
每个 `Segment` 必须至少有一个 `Anchor` 回到原件的页码 / 时间码 / 消息 ID / 题号 / 图片区域（I-7）。
`segments` / `anchors` 的**填充由摄取流水线承担**，本束只定义模型与不变量。

### `DerivedRepresentation`（实体）—— 派生物是独立文件

OCR / ASR / 摘要 / embedding / 视觉描述。带 `derivedFrom` 指回某个 `ArtifactVersion`，
**是独立文件、不覆盖原件**（I-6）；都记录 `model` 与 `modelVersion`。

### `ProvenanceEvent`（实体）—— **append-only** 血缘 + 安全审计

10 类事件（见 `artifact.ts` 的 `ProvenanceEventType`）。除摄取/转换/生成/编辑/定版/绑定等血缘外，
`unauthorized-attempt`（越权修改/删除快照的尝试）也写这里（F08 安全审计，V7/V8）。

### `Binding`（实体）—— 三模式绑定

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `artifactId` / `projectId` / `stepId` | | |
| `mode` | `"draft" \| "live" \| "pinned"` | 三模式（D-30） |
| `pinnedVersionId` | `ArtifactVersionId \| null` | **pinned 时非空**（冻结到该不可变版本）；live 时为 null（解析当前最新版） |

⚠ **绑定必须存 `pinnedVersionId`（版本）而非仅 `artifactId`**——否则固定快照会随源漂移，
D-30「引用必须指向不可变快照」就落空了。`draft` 模式**不产生项目侧绑定行**。

### `IngestionRun`（值对象）—— 摄取九态

```
RECEIVED → QUARANTINED → SCANNED → STORED → EXTRACTED
        → SEGMENTED → ENRICHED → INDEXED → REVIEW_PENDING / READY
```
幂等键 = `content_hash + pipeline_version + parser_version`。重跑摄取只生成新派生版本，不改旧结果。
界面已建成于 `/projects/[id]/files` 的摄取抽屉（`files-ingestion-ladder`）。

---

## 二、不变量

> 判据：**它在任何时刻都为真，违反即数据损坏。** 写不成断言的是「规则」，赶到 usecases 的前置条件里。
> **跨束不变量**用 🔗 标注——它们不能在本束单独实现，须提到**阶段一致性复核**统一设计。

| # | 不变量 | 断言方式 |
|---|---|---|
| **I-1** | `ArtifactVersion` 一经写入，其 `contentHash` / `objectStorageKey` **永不改变** | 断言对已写版本的 UPDATE 被拒；改源后再读该版本，`contentHash` 不变 |
| **I-2** | S3 上 `objectStorageKey` 指向的对象**永不覆盖**（写一次） | **对象存储层**断言（bucket 版本化 / object-lock）：PUT 到已存在 key 被拒。⚠ 这是部署形态约束，非 API 保证 |
| **I-3** | `contentHash` 恒等于 `objectStorageKey` 处字节的 SHA-256 | 下载字节重算 SHA-256，断言相等 |
| **I-4** | `artifact_versions` 表**不含文件体列**；PG 只存指针 + 哈希（S3 canonical） | 查表结构断言无 blob/content 列；灾备演练断言「只恢复 PG」= 数据损坏 |
| **I-5** | 每个 `ArtifactVersion` 在对象存储里都有**真实可下载文件**（file-first） | 对每个版本 HEAD 对象，断言 200 且 `size > 0`；非文件来源已物化（responses.csv/messages.jsonl/…） |
| **I-6** | 每个 `DerivedRepresentation.derivedFrom` 指向存在的版本，且写派生**不改原件** | 写派生后断言原件 `contentHash` 不变；`derivedFrom` 外键有效 |
| **I-7** | 每个 `Segment` 至少有一个可解析回原件的 `Anchor` | 遍历 segment 断言 `anchors ≥ 1` 且 locator 可定位 |
| **I-8** | `pinned` 绑定的 `pinnedVersionId` 非空且指向不可变版本；定版后源改动不影响它 | 定版生成 v1 → 改源 → 断言 pinned 绑定解析出的字节仍是 v1（AC2 round-trip） |
| **I-9** | `provenance_events` **append-only**：无 UPDATE、无 DELETE | 断言 UPDATE/DELETE 被拒（触发器/权限）；行数单调不减 |
| **I-10** | 一个 artifact 内版本号**单调唯一**；并发定版只产生一个新版本号 | 唯一索引 `(artifactId, versionNumber)`；并发定版一方成功、另一方得 `VERSION_CHANGED`（V6） |
| **I-11** | 固定快照**不可降级、不可删除、不可修改**（任何接口） | 断言 pinned→live/draft 被拒（`CANNOT_DOWNGRADE`）；修改/删除端点对已定版返回 `SNAPSHOT_IMMUTABLE`（V8） |
| **I-12** | `draft` 模式产出**仅创建者可见**，不在回流列表，管理员亦不可见 | 用非创建者（含 admin）查 `listBackflow` 断言 0 条 draft；越权直读返回 `ARTIFACT_NOT_FOUND`（404 非 403，V4） |
| 🔗 **I-13** | `Segment` / `DerivedRepresentation` / embedding 的有效可见性范围 = 其原件 `Artifact.scope`（**只收紧不放宽**） | 构造 team-only 原件，断言其 segment/embedding 的 scope = team-only（**跨束**：artifact + identity + context-pack） |
| 🔗 **I-14** | 任何下游引用（claim_evidence / 报告正式版 / 图谱写回 / 大脑晋升）**只能指向 `pinned` 版本** | 断言 live/draft 引用被拒 `REQUIRES_PINNED`；扫描下游引用表无非 pinned 指针（**跨束**：context-pack / 13-deliv / 10-report / 09-kg / 14-brain） |

### 为什么 I-2 与 I-1 是两条

I-1 是**领域/数据库层**的不变量（版本行不可改），可用 API/SQL 断言。
I-2 是**对象存储层**的保证（S3 对象 write-once）——契约管不到它，必须靠 bucket 配置
（版本化 + object-lock）落地。**只做 I-1 不做 I-2**：数据库说「这版哈希是 X」，
但有人从 S3 把那个对象覆盖了，哈希校验会失败却已丢原件。两条都要。

### 为什么 I-4 牵动灾备

原件 canonical 在 S3、元数据/状态/版本谱系/权限 canonical 在 PG，**两者互不能重建对方**。
故灾备必须同时恢复 **PG + 对象存储 + 事件日志**的一致性时间点；只恢复其一即数据损坏
（架构第六节修正）。这条不是 API 契约，是**部署与备份演练约束**——见 coverage 缺口。

---

## 三、这个域不负责什么

- **权限判定**：两层交集鉴权属 `identity` 束。本束用例的前置条件只写「调用者在该项目该环节
  有写权限」，**不重设计鉴权**。但 I-13（可见性沿链路传播）横跨三束，须一致性复核统一设计。
- **Context Pack 装配**：属 `context-pack` 束。本束只负责「artifact 能被它引用」。
- **删除级联**：22-files/uc-22-4 的删除传播在 phase-01（契约桩 phase-01 先行）。
  本束只定义 I-11「固定快照不可删」；「合规撤回删除」如何与不可变共存见 coverage 缺口。
- **摄取流水线的执行**：本束定义九态模型与幂等键，`segments`/`anchors`/派生物的**填充**由下游流水线承担。
