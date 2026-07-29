# 契约束 `artifact` — ④ UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，如果有一条 UC 的验收线索找不到对应的接口，业务就是跑不通的。
>
> 覆盖 feature：F04 F05 F06 F07 F08（uc-0-1），合计 **21 点**
> 验收线索来源：`uc-0-1` 的 R12 共 **8 条**（V1–V8）+ F04 的 file-first/摄取九态**结构性验收**（架构对齐，R12 未编号）

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**（`/projects/[id]/files`）里的真实 `data-testid` 或路由；
填不出来的标 `—（API 层验收）`，**但不能空着**。

---

## 一、`uc-0-1` R12（8 条）

| R12 | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：实时/草稿调「加入报告正式版/提交验收/引用为决策依据」全被拒指向「需先定版」；固定快照全成功 | `referenceForDownstream` → `REQUIRES_PINNED` / 成功 | —（下游引用屏在 phase-01，见缺口③） | ⚠ **缺口 3** |
| V2 | AC2：定版生成 `artifact@v1` 后改源再读 v1，**内容字节一致** | `pinVersion` → `contentHash`；重读断言相等 | `/projects/[id]/files` `files-version-row` + `files-version-copy-sha` | ✅ |
| V3 | AC3：项目侧列表每条返回 `mode/version/pinnedBy/pinnedAt` 四字段且非空（草稿除外） | `listBackflow` → `BackflowEntry[]` | ⚠ **「已回流的产出与版本」屏未建**（仅说明页文字） | ⚠ **缺口 4** |
| V4 | 六角色遍历；草稿仅创建者可读，其余（含管理员）返回 **404 而非 403** | `bindToProjectStep`/读 → `ARTIFACT_NOT_FOUND` | `files-role-switch`（角色预览切换器） | ✅ |
| V5 | 项目无已回流产出时显示真实空态，不生成伪数据 | `listBackflow` → `[]` | ⚠ 同 V3（回流屏未建）；文件浏览器空态 `files-list` 已有 | ⚠ **缺口 4** |
| V6 | 并发定版只产生一个新版本号，另一方收到「版本已变化」 | `pinVersion` → `VERSION_CHANGED`（`expectedHeadVersion` 乐观并发） | —（定版流未建，API 层验收） | ✅ 见 domain I-10 |
| V7 | 每次定版与绑定可按操作者/时间/Artifact/模式检索；越权尝试也有安全审计 | `queryProvenance`；`ProvenanceEventType.unauthorized-attempt` | `/admin` 活动流（identity 束）；本束无独立屏 | ⚠ **缺口 1** |
| V8 | 任何接口试图修改/删除已定版快照全被拒并记录审计 | `referenceForDownstream`/写路径 → `SNAPSHOT_IMMUTABLE` + provenance | `/projects/[id]/files` `files-trash-denied` + `files-delete-legalhold` | ✅ 见 domain I-1/I-11 |

## 二、F04 结构性验收（架构对齐，R12 未编号——但不验就没人验）

| 验收点 | API / 断言 | 前端消费点 | 状态 |
|---|---|---|---|
| file-first：非文件来源物化为真实可下载文件（responses.csv/messages.jsonl/…） | `saveDraft` → `materializedKeys`；HEAD 对象 size>0（I-5） | `files-preview-csv` / `files-preview-jsonl` / `files-preview-audio` | ✅ |
| 派生物是独立文件、带 `derivedFrom`、不覆盖原件 | domain I-6 断言 | `files-derived-row` + `files-derived-download` + `files-origin-badge` | ✅ |
| 每个 Segment 能回到原件页码/时间码/消息/题号锚点 | domain I-7 断言 | `files-preview-sourceref` + `brain-retrieval-segments` | ✅ |
| 摄取九态（+REVIEW_PENDING）可重放、幂等 | `getIngestionStatus`；幂等键断言 | `files-ingestion-ladder` + `files-ingestion-detail` + `files-ingestion-review` | ✅（但 REVIEW_PENDING 触发判据见缺口⑦） |
| S3/PG 双 canonical：PG 只存指针+哈希 | domain I-3/I-4 断言 | `files-integrity-badge`（SHA 校验态） | ✅（灾备三源一致见缺口⑤） |

---

## 三、缺口清单（这一件的真正价值所在）

> 这 8 条是**这一轮设计的产出**，不是失败。四件套的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **provenance 查询面跨束**。本束 `queryProvenance` 与 identity 束 `mutateCapability` 都写 `provenance_events`；V7「按操作者/时间/对象检索」若各束各造一个查询面就是第七次「同一事实声明在多处」 | 跨束 | 提到**阶段一致性复核**：统一一个 provenance 查询面（本束与 identity 束缺口①是同一件事）。17-gov/uc-17-1 全链路审计是它的下游消费者 |
| **2** | **可见性沿数据链路传播（UC-0.3 R7）**。domain I-13 要求 Artifact 的 `scope` 传播到 Segment/embedding/图节点/缓存/Context Pack——**横跨 artifact、identity、context-pack 三束** | 跨束 | 提到一致性复核：**六条路径必须共用同一个判定**，不能各查各的。与 identity 束缺口②是**同一条 R7**的两侧，必须合并设计 |
| **3** | **下游引用门控 I-14 的下游桩不在本束**。`referenceForDownstream` 是门，但被门控的引用表（claim_evidence / 报告正式版 / 图谱写回 / 大脑晋升）在 context-pack、13-deliv、10-report、09-kg、14-brain | 跨束 | 一致性复核确认：**每个下游都必须过同一个 `referenceForDownstream` 门**，不各判各的「是不是快照」。否则 AC1 会被某个下游绕过 |
| **4** | **项目侧「已回流的产出与版本」屏 + 三模式选择器未建**。V3/V5 的 `listBackflow` 有契约无界面；三模式选择流点进去无任何屏（原型只有 `[挂到项目环节…]` `[保存]` 两按钮） | 界面缺口 | F06 已标 `needs_ui_signoff: true`。随 phase-01 承载它的 Studio 底栏交付；本束绑定服务与列表契约用 API 断言可先行开工。⚠ 三模式选择必须**并列展示各自后果**（能否被引用/是否随源变动），不是三个裸单选（R8） |
| **5** | **I-2 对象写一次 + 灾备三源一致，契约管不到**。「S3 对象永不覆盖」是 bucket object-lock；「灾备须同时恢复 PG+对象存储+事件日志的一致性时间点」是备份演练 | **契约管不到** | 落成**部署形态约束**写进 `architecture.md`（bucket 版本化+object-lock；三源一致性时间点恢复演练），并在一致性复核确认有人负责。⚠ 只恢复其一即数据损坏——PG 无法从指针恢复丢失的文件 |
| **6** | **快照不可删 vs 合规撤回删除 边界**。本束 I-11「固定快照不可删」；但 22-files/uc-22-4 有真实删除流（`files-trash-*` / `files-delete-cascade`）、17-gov 有撤回删除。二者如何共存？ | 跨阶段 + 需裁决 | 边界：**撤回删除是不可变原则的唯一合规豁口**，且必须**同时作用 S3+PG**（file-first：删除后文件浏览器那份必须真消失）。契约桩在 phase-01 先行。O-01 已裁：不可删对象不受 180 天留存期约束，走 O-39 法定留存清单——**O-39 是外部合规输入缺口**（同缺口⑧类） |
| **7** | **REVIEW_PENDING 触发判据未定**。九态里有 REVIEW_PENDING 岔路、界面有 `files-review-pii` / `files-review-synth`，但「什么把 artifact 送去人工复核」（PII / synthesized / 低置信阈值）无契约 | 需裁决（含数值） | 参考 O-13 的处理：**先做结构性断言**——「命中即进 REVIEW_PENDING、不得静默入库」，具体阈值后填。跨 artifact + 17-gov 合规，提一致性复核 |
| **8** | **[待确认] UML 第 13 节缺失**。整套六表模型是依据原型证据链**反推**，原型说明页指向的「UML 文档第 13 节」不在仓库 | 需人类确认 | D-38 已裁定反推设计为权威；若该 UML 文档出现须**逐条校对本设计**。签核时请确认 D-38 覆盖本束 |

---

## 四、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `saveDraft` | R3 步骤1（保存/自动保存草稿）+ file-first 物化 | ✅ |
| `pinVersion` | V2 V6（定版 / 并发） | ✅ |
| `bindToProjectStep` | R3 步骤2-4 · V4（三模式绑定 / 权限） | ✅ |
| `upgradeBinding` | A2 / A3（升级 / 禁止降级） | ✅ |
| `listBackflow` | V3 V5（回流列表 / 空态） | ✅ |
| `referenceForDownstream` | V1（F07 引用资格门控 / AC1） | ✅ |
| `getIngestionStatus` | F04 摄取九态（架构结构性验收） | ✅ |
| `queryProvenance` | V7（审计检索） | ✅ |
| `markEvidenceWithdrawn` | E5（F08 证据撤回不改快照 + 通知复核） | ✅ |

**9 个操作全部有 UC 要求，无孤儿接口。**

---

## 五、签核时请重点看这三处

1. **缺口 1/2/3 都是跨束的，且缺口 2 与 identity 束缺口②是同一条 UC-0.3 R7** —— 它们不该在本束解决，
   而应在**阶段一致性复核**统一设计。若每束各造一套 provenance 查询 / 权限传播 / 引用门控，就是第七次漂移。
2. **缺口 5 是契约管不到的东西** —— 「S3 对象写一次」和「灾备三源一致」是部署与备份演练的保证，
   不是 API 的保证。请确认这一条有人负责，否则原件会在两边的缝里悄悄丢失而只在校验时才发现。
3. **缺口 6 需要你确认边界** —— 「固定快照不可删」（I-11）与「合规撤回删除」（22-files/17-gov）看似矛盾，
   实为「默认不可删 + 唯一合规豁口」。请确认这个边界，以及 O-39 法定留存清单作为外部输入的归属。
