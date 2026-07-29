# 契约束 `files` — ④ UC 覆盖证明（支撑材料）

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，如果有一条 UC 的验收线索找不到对应的接口，业务就是跑不通的。
>
> 覆盖 feature：F31 F32 F33 F34 F35 F36 F37 F38 F39 F40 F41 F42 F43 F44 F45 F46 F47（17 个，48 点）
> ⚠ **这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三）。
> 验收线索来源：四份 UC 的 R12，共 **50 条**（22-1 的 V1–V11、22-2 的 V1–V13、22-3 的 V1–V12、22-4 的 V1–V14）

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**（`/projects/[projectId]/files`）里的真实 `data-testid` 或路由；
填不出来的标 `—（API 层验收）`，**但不能空着**。

---

## 一、uc-22-1 R12（11 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 四角色的浏览器可见集合 ≡ Context API 检索可见集合，逐一比对全相等 | `listProjectArtifacts` × `searchContext`（context-pack 束）集合比对 | `files-list` + `files-role-switch` | ⚠ **缺口 2**（跨束判定面） |
| V2 | 遍历每个节点下载，全部 200 且 SHA-256 与元数据一致，零个失败 | `listProjectArtifacts` + `issueDownloadUrl` | `files-row` + `files-preview-download` | ✅ 见 N-2 |
| V3 | 3 上传 + 1 问卷 + 1 对话物化后来源类型分布为 `file:3, survey:2, conversation:1` | `listProjectArtifacts` → `sourceCounts` | `files-tree-source` + `files-tree-node` | ✅ |
| V4 | zip 导出 round-trip：目录同构 + manifest sha256 一致 + 文件数 == 条目数（无静默截断） | `createExportJob` + `getArtifactTree` | `files-export-zip` + `files-batch-zip` | ✅ 见 N-23 |
| V5 | 新建空项目返回八个来源节点 `count:0`，真实空态，不生成示例数据 | `listProjectArtifacts` → `sourceCounts` 全 0 | `files-tree-empty-source` + `files-list`（`?state=empty`） | ✅ |
| V6 | 无权 id 与不存在 id 的状态码/响应体/响应头**完全一致** | `listProjectArtifacts` / `previewArtifactVersion` → `ARTIFACT_NOT_FOUND` | `files-list`（`?state=denied`） | ✅ 见 N-25 |
| V7 | 断开对象存储：列表仍 200，下载返明确依赖失败码（非 500 裸错），按钮置灰并显示原因 | `issueDownloadUrl` → `DEPENDENCY_UNAVAILABLE` | `files-preview-download`（`?state=dep-failed`） | ✅ |
| V8 | 篡改对象字节 ⇒ 该行标「完整性校验失败」、禁下载、告警 + 审计 | `previewArtifactVersion` → `INTEGRITY_CHECK_FAILED` | `files-integrity-badge` | ✅ |
| V9 | 一次下载 + 一次导出后，按操作者/时间/对象三维均可检索到 `provenance_events` | `queryProvenance`（phase-00 artifact 束的**统一**查询面） | —（API 层验收；`/admin` 活动流属 identity 束） | ⚠ **缺口 1**（provenance 查询面跨束未统一） |
| V10 | agent 生成的 artifact `uploader.type=="agent"` 且 `agent_run_id` 非空；不存在 human 却带 run_id | `listProjectArtifacts` → `uploader` | `files-row-agent` | ✅ 见 N-5 |
| V11 | 改名后旧路径引用仍可解析（重定向/别名），变更被记录，不存在改名即 404 | `renameArtifact` + `resolveArtifactAlias` | —（API 层验收；**改名入口界面未建**） | ⚠ **缺口 6** |

---

## 二、uc-22-2 R12（13 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 同 PDF 连传两次 segments 差值 0 + 幂等命中标识 + versions 不新增；parser 升版后新增派生版本而旧 Segment 未改 | `uploadArtifact` → `duplicateHit`；`replayIngestionRun` | `files-upload-duplicate` + `files-upload-duplicate-choice` + `files-ingestion-duplicate` | ✅ 见 N-6 |
| V2 | 状态序列是九态合法子序列，每个出现过的态都有非空 `label` 与非空 `exits`；无空 `exits` 的非终态 | `getIngestionRun` + `getIngestionUiState` | `files-ingestion-ladder` + `files-ingestion-legend-row` + `files-ingestion-detail-panel` | ✅ 见 N-8 |
| V3 | 加密 PDF 停在 EXTRACTED 失败态，但 download 仍 200 哈希正确、浏览器标「不参与检索」、检索零命中 | `uploadArtifact` → `EXTRACTION_FAILED`；`getIngestionRun` 的两个独立布尔 | `files-ingestion-failure` + `files-ingestion-retry` + `files-ingest-badge` | ✅ 见 N-7 |
| V4 | EICAR 被拒入正式区 + 留一条不可下载的留痕记录 + 安全告警与审计 | `uploadArtifact` → `MALWARE_DETECTED` | `files-upload-precheck-row`（前端预检）；**安全/合规侧留痕屏未建** | ⚠ **缺口 7** |
| V5 | 高压缩比 zip 在 SCANNED 被拒，错误体含实际值与上限值，且未发生完整解压 | `uploadArtifact` → `ARCHIVE_BOMB_DETECTED` | `files-upload-precheck-row` | ⚠ **缺口 4**（五个上限数值待定） |
| V6 | 可执行文件改名 `.pdf` 被拒并提示实际检出类型；扩展名与 `Content-Type` 头均未被信任 | `uploadArtifact` → `MIME_MISMATCH` | `files-upload-precheck-row` | ⚠ **缺口 4**（白名单待定） |
| V7 | 🔴 含注入正文的 PDF：agent 回答不含文件列表、内容以带来源标注的数据块出现、未触发工具调用，红队通过率 100% | `wrapDocumentAsData`（端口）+ agent 侧断言 | —（红队用例层验收；agent 运行时属 04-agent） | ⚠ **缺口 3**（跨束红线） |
| V8 | 入口一 `agenda_segment_id` == 该行；入口二为 null；两表均无 `design_facet_id`/`method_stage_id` | `uploadArtifact{agendaSegmentId}` | `files-tree-segment` + `files-batch-segment` + `files-batch-segment-option` | ✅ 见 N-4 |
| V9 | 组员本组材料对他组返 404、引导师可见；观察者调上传接口 403 | `uploadArtifact` → `ARTIFACT_NOT_FOUND` / `NO_PROJECT_ROLE` | `files-role-switch` | ✅ |
| V10 | 停 ASR 后上传音频：原件正常 STORED 可下载，转录派生物标失败可重试，整单未失败并如实告知 | `getIngestionRun`；`retryIngestionStep` | `files-ingestion-retry-status` + `files-ingestion-manual-status` | ✅ |
| V11 | 对象存储写失败不产生 `artifact_versions`；PG 提交失败则临时对象被清理（无孤儿） | `uploadArtifact` 事务 + outbox | —（API 层验收） | ✅ |
| V12 | SEGMENTED 阶段 kill worker 后重放，最终 READY 且 segments 无重复行 | `replayIngestionRun` | `files-ingestion-run` | ✅ 见 N-6 |
| V13 | AI 补料产物 `generated` + `synthesized` + `provenance.json` + 状态 `REVIEW_PENDING`，人接受前不召回 | `requestAiFillMissingMaterial`；`resolveReviewPending` | `files-review-synth` + `files-ingestion-review` + `files-review-accept` | ✅ 见 N-12 |

---

## 三、uc-22-3 R12（12 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 🔴 每类业务对象各一个后，每个 `source_ref` 都返回非空、文件名集合 == 契约表该行、每个可下载，缺文件数 0 | `materializeSource` + `getMaterializationSpec` + `listProjectArtifacts?sourceRef` | `files-tree-source` + `files-preview-sourceref` | ✅ 见 N-10 |
| V2 | 50 条消息会话：`messages.jsonl` 文件数 == 1（不是 50）、行数 == 50、segments == 50 且 anchor.messageId 唯一非空 | `materializeSource(conversation)` | `files-tree-source`（对话节点）+ `files-preview-jsonl` | ✅ 见 N-11 |
| V3 | 提交问卷回收后在**约定时限内** `responses.csv` 行数 +1，全程未调任何导出接口 | `materializeSource` 的 SLA | —（API 层验收） | ⚠ **缺口 5**（五个时限数值待定） |
| V4 | 画布 round-trip：两次 mermaid 源码逐字符相等（或规范化后相等） | `materializeSource(canvas)` | —（API 层验收；画布屏属 canvas 束 `/projects/[id]/canvas`） | ✅ 见 D-08 |
| V5 | 🔴 `primary-only` 检索不含 generated segment；`all` 含且带 `synthesized:true`；篡改 `evidencePolicy` 服务端仍按最严执行 | `searchContext{evidencePolicy}`（context-pack 束，**服务端强制**） | `files-synthesized-badge` + `files-preview-synth-banner` | ⚠ **缺口 8**（判定面归属跨束） |
| V6 | 每个 generated 都有同组 `provenance.json` 且七键齐全；缺溯源数为 0；缺 `model` 者停在 REVIEW_PENDING | `materializeSource` → `PROVENANCE_MISSING`；`resolveReviewPending` | `files-review-synth` + `files-review-detail` | ✅ 见 N-12 |
| V7 | 对话引用机密材料时其 `messages.jsonl` 敏感级 ≥ 该材料；只能看对话不能看材料的会话请求被拒 | `materializeSource` 的可见性求交（fail-closed） | —（API 层验收） | ⚠ **缺口 2**（与 phase-00 🔗I-13 同源） |
| V8 | 工作坊 transcript 每行含 speaker/start_ms/end_ms/text；反对意见行 tags 含 objection；schema 题号与 csv 列头一一对应 | `getMaterializationSpec` 的格式契约 | `files-preview-jsonl` + `files-preview-csv` | ✅ 见 N-11 |
| V9 | 注入序列化错误：业务对象仍可用、浏览器出现「物化失败」记录带原因与重试、不存在静默态 | `listMaterializationFailures`；`MATERIALIZATION_FAILED` | ⚠ **「物化失败」行态未建**（`files-ingestion-failure` 是摄取失败，两者不是同一件事） | ⚠ **缺口 9** |
| V10 | 同 `source_ref` 连触两次且数据未变：`artifact_versions` 不新增，只增一条 `provenance_events` | `materializeSource`（content_hash 相同分支） | `files-version-row` + `files-version-current` | ✅ |
| V11 | 观察者请求 `messages.jsonl` / `transcript.jsonl` 默认返 404（与不存在同响应）；脱敏发布后可见 | `listProjectArtifacts` → `ARTIFACT_NOT_FOUND` | `files-role-switch`（observer）+ `files-list`（`?state=denied`） | ✅ 见 N-25 |
| V12 | 物化文件表中不存在 `design_facet_id` / `method_stage_id`，环节字段严格为 `agenda_segment_id` | schema 断言（information_schema） | —（DB 层验收） | ✅ 见 N-4 |

---

## 四、uc-22-4 R12（14 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 同名两版：versions 2 行、v1 哈希与下载体一致、v2 哈希正确、v1 对象字节未变（ETag/LastModified 不变） | `uploadNewVersion` + `listVersions` | `files-version-row` + `files-version-download` + `files-version-copy-sha` | ✅ 继承 phase-00 I-1/I-2 |
| V2 | 第三次上传相同内容 B，versions **仍为 2 行**（不新增） | `uploadNewVersion` → `duplicateHit` | `files-version-current` | ✅ |
| V3 | 🔴 重跑 OCR：原件 sha256 不变、derived 新增行而非更新、两个派生物都可下载可见、`derived_from` 指 version_id、generator 元数据非空 | `rerunDerivation` + `listDerived` | `files-derived-row` + `files-derived-download` | ✅ 见 N-15 |
| V4 | 🔴 删除后 ≤5 分钟：列表不含它（任何版本任何派生物）、每个版本与派生物的 download 均 404（与不存在同响应） | `requestDeletion` + `listProjectArtifacts` + `issueDownloadUrl` | `files-delete-confirm` + `files-delete-stats` | ✅ 见 N-16 |
| V5 | 🔴 六类级联全部可验证失效（浏览器/派生入队/向量零召回/FTS 零召回/图边 invalidated/新旧 Context Pack）+ 报告段落标「证据已撤回」 | `requestDeletion` 的 `CascadeInvalidator` + F47 两个出站桩 | `files-delete-cascade-row` + `files-trash-steps` | ⚠ **缺口 10**（③④⑥ 属 context-pack、⑤ 属 09-kg、报告段落属 10-report） |
| V6 | 逻辑失效 ≤300s；宽限期调 0 后物理删除执行、对象 key 含全部历史版本与删除标记均不存在、生成回执 | `getDeletionTask` + 物理删除 worker + `getDeletionReceipt` | `files-trash-step` + `files-trash-receipt` + `files-trash-receipt-body` | ⚠ **缺口 11**（与 phase-00 I-2 object-lock 的部署面冲突） |
| V7 | 注入图边失效故障：任务「部分失败」而非完成、未生成回执、产生告警、重试后收敛 | `retryCascade` → `DELETION_PARTIAL_FAILURE` | `files-trash-partial` + `files-trash-partial-badge` + `files-trash-retry` | ✅ 见 N-17 |
| V8 | legal hold：人工删除被拒并给原因、保留期到期不进队列、解除后再扫描进队列 | `applyLegalHold` / `releaseLegalHold` → `LEGAL_HOLD_ACTIVE` | `files-trash-legalhold` + `files-delete-legalhold` + `files-trash-release-hold` + `files-trash-hold-released` | ✅ 见 N-19 |
| V9 | 回执含该次导出记录（时间/操作者/导出包 ID）与「已出域无法回收」说明；不存在声称「已完全删除」的回执 | `getDeletionReceipt`（消费 `createExportJob` 的审计） | `files-trash-receipt-body` + `files-delete-exported` | ⚠ **缺口 12**（回执格式与签名 O-39 待外部输入） |
| V10 | 撤回「AI 分析」不撤录音：音频仍可下载、其 embedding 与 Segment 退出检索、音频未进待删除队列 | `requestDeletion{scope}` 的级联裁剪 | —（API 层验收；受访者侧撤回屏属 17-gov `/consent`） | ⚠ **缺口 13**（撤回项→级联子集映射表未定） |
| V11 | 项目级保留期 180→30 后第 31 天入队、其它项目仍 180、`grep -r "180"` 不出现在留存判定逻辑里 | `getRetentionPolicy` / `setRetentionPolicy` | —（API 层验收；留存参数配置屏属 17-gov `/admin`） | ⚠ **缺口 14**（单点配置的归属未定） |
| V12 | 删除被固定快照引用的 artifact：快照仍存在，其引用项标「证据已撤回」，不是静默 404 或空白 | `markEvidenceWithdrawn`（phase-00 artifact 束，**复用不重造**） | —（API 层验收；引用屏在下游模块） | ✅ 见 N-22（phase-00 缺口 6 的落点） |
| V13 | 组员/观察者/agent 调删除接口均 403；待删除队列仅合规负责人可读 | `requestDeletion` → `AGENT_CANNOT_DELETE` / `PROJECT_ROLE_INSUFFICIENT`；`listTrashQueue` | `files-trash-denied` | ⚠ **缺口 15**（合规负责人角色缺位，S-02） |
| V14 | 一次删除的四类事件（发起/级联失效/物理删除/回执）均可按操作者、时间、对象三维检索 | `queryProvenance`（统一查询面） | —（API 层验收） | ⚠ **缺口 1**（同 22-1 V9） |

---

## 五、缺口清单（这一件的真正价值所在）

> 这 15 条是**这一轮设计的产出，不是失败**。四件套的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **provenance 查询面仍未统一**。本束新增四类审计事件（上传/下载/导出/删除，17-gov/UC-17.1）写 `provenance_events`；phase-00 artifact 束缺口①与 identity 束缺口①说的是同一件事，**至今未收敛** | 跨束（**复发**） | 提一致性复核：**一个** `queryProvenance` 查询面。本束**不新造**查询接口。这已是同一问题第三次出现——再各造一个就是第七次「同一事实声明在多处」 |
| **2** | **可见性沿链路传播 + 「浏览器可见集合 ≡ 检索可见集合」**（N-1 / N-14）横跨 files + identity + context-pack | 跨束（**继承 phase-00 缺口②**） | 六条路径（列表/搜索/预览/下载/导出/物化）**必须共用同一个判定**，不能各查各的。N-1 是这条约束第一次有了**可执行的双向断言**（V1·22-1），建议把它做成一致性复核的验收物 |
| **3** | **prompt injection 防线的另一半不在本束**。`wrapDocumentAsData` 是包裹端口，但「agent 不把它当指令」的断言在 agent 运行时（04-agent） | 跨束 🔴 | 一致性复核确认：**所有**进模型的文档文本都过同一个包裹端口，不许有旁路。红队样本集须跨束共用一份，通过率 100% |
| **4** | **五个上限数值 + 类型白名单未定**（T-1/T-2）。`.html` / `.svg` 是否允许直接决定预览渲染的安全设计 | 需裁决（含数值） | 契约已把错误码与「必须同时给当前值与上限值」定死，**数值是配置不是契约**。但没有它 V5/V6 的断言只能写一半。UI 原型的 2 GB / 20 份 / 3 层是**占位不是裁决** |
| **5** | **五个物化时限未定**（T-3）。AC2「物化是同步契约」的断言写不出 | 需裁决（含数值）🔴 | 这是 file-first 与「事后导出」的**分界线**。参考 phase-00 对 O-13 的处理：先做结构性断言（「不需用户点导出」可测），数值后填。但 V3·22-3 在数值到位前**无法执行** |
| **6** | **改名入口界面未建**。N-23 的契约有了，界面无处发起改名 | 界面缺口 | 低优先。可先做 API 层验收；若 phase-01 不提供改名入口，须显式声明「改名仅走迁移脚本」 |
| **7** | **恶意文件留痕的处置屏未建**。E2 要求保留不可下载记录且「仅安全/合规角色可见与处置」 | 界面缺口 + 角色缺位 | 与缺口 15 同源（合规角色缺位）。可先并入待删除队列屏的同一合规视图 |
| **8** | **`evidencePolicy` 的判定面归属未定**。N-13 要求服务端强制，但 `searchContext` 属 context-pack 束 | 跨束 | 一致性复核确认：`synthesized` 的**产生**在本束（N-12），**过滤**在 context-pack。两侧不得各写一份策略——这正是 D-25 的两端 |
| **9** | **「物化失败」的行态在界面上不存在**。现有 `files-ingestion-failure` 是**摄取**失败，物化失败是另一件事（业务对象存在但没变成文件） | 界面缺口 🔴 | 必须补。V9·22-3 明写「不存在业务对象存在但浏览器什么都没有的静默态」——**静默失败是 UC-22.3 最危险的缺陷模式**，而当前界面恰好无法表达它 |
| **10** | **六类级联的 ③④⑤⑥ 依赖他模块提供失效接口**：pgvector / FTS-Segment / `ontology_edges`(09-kg) / 缓存与 `context_packs`(00-core) / 报告段落(10-report·13-deliv) | 跨束 + 跨阶段 🔴 | **任一模块不提供失效接口，AC2 就无法达成**——uc-22-4 R10 自称这是本模块最大的外部风险。F47 已把 ⑤ 与报告段落做成契约先行桩（+1 点）；③④⑥ 须在一致性复核上确认归属与就绪顺序 |
| **11** | **N-21（物理删除须清版本化桶全部历史版本与删除标记）与 phase-00 I-2（bucket object-lock 写一次）在部署面上直接冲突** | **契约管不到** 🔴 | 契约两边都写得出，**同一个 bucket 不可能既 object-lock 又能物理清除**。须在一致性复核裁定分桶策略（如：快照桶 object-lock + 可删桶保留期），并写进 `architecture.md` 的部署形态约束。**这是本轮最硬的一条新发现** |
| **12** | **删除回执格式 / 送达方式 / 可验证签名 + 法定留存清单未定**（O-39 ①②③，明标「必须等外部输入」） | 需外部输入 | 契约已把「不得虚假、必须列已出域记录」定死；形状待外部合规输入。与 phase-00 artifact 缺口⑤同类 |
| **13** | **撤回项 → 级联子集的映射表未定**（T-8）。部分撤回（撤 AI 分析不删录音）说明级联清单是**按撤回项裁剪**的，不是无差别全删 | 需裁决 | 与 17-gov/UC-17.2 的四项独立同意一一对应。定不下来，V10·22-4 无法穷举，实现只能猜 |
| **14** | **O-01 留存五参数的单点配置归属未定**。本束消费它，17-gov 定义它，05-rec/06-itv/04-agent/21-mcp 也消费 | 跨束 | 一致性复核确认唯一事实源位置。⚠ 这是典型的「同一事实多处声明」高发点——V11 的 `grep -r "180"` 断言就是防它 |
| **15** | 🔴 **合规负责人不在角色模型里**（ui-preview **S-02**）。UC-0.3 的项目角色**恒为四值**（裁决 O-03），但本束的待删除队列、legal hold、回执、恶意留痕处置**全部**要求这个角色 | 跨束 + 动摇既有裁决 | 两条出路：① 补第五个项目角色（**推翻 O-03**）；② 把合规职能归到**组织角色层**（不动项目角色）。UI 原型用 `?as=compliance` 临时投影，**这是预览手段不是角色模型**。V13·22-4 在此定案前无法验收 |

### 三条**跨束真冲突**（不是缺口，是两处已经写得不一样）

| # | 冲突 | 两处怎么写的 | 处置 |
|---|---|---|---|
| **C-1** 🔴 | **`sourceType` 枚举的值与基数不一致** | `packages/contracts/src/artifact.ts` 的 `ArtifactSource`：**7 值**；`apps/web/lib/mock/files.ts` 的 `SourceType` 与四份 UC：**8 值** | 差异不只是命名（3 对同义异名），**基数也不同**：mock/UC 多出 `workshop` 与 `canvas`（**契约里根本没有对应值，而界面已把它们当一等来源画进左树七节点**），契约多出 `prototype-run`（UC 侧无位置）。**同一个字段的两份定义，且已经漂了。** 逐值对照表与裁决要求见 `domain.md` 第二·五节（T-11）。⚠ 在收敛前，`packages/contracts/src/files.ts` **不应**先固化任何一套——那是第三份副本。⚠ 同形状第二处：mock 的 `IngestState` 是摄取九态的本地副本，**今天值一致，改一处即漂** |
| **C-2** | **快照不可删 vs 合规删除** | phase-00 I-11「固定快照不可删」；本束 N-16「删除后全部版本 download 404」 | **不是矛盾，是「默认不可删 + 唯一合规豁口」**。本束 N-22 给出共存形态（快照行仍在，引用项标「证据已撤回」）。这正是 phase-00 缺口⑥说的「契约桩在 phase-01 先行」，**本轮已交付**。请人类确认该边界 |
| **C-3** | **`markEvidenceWithdrawn`（phase-00）vs F47 的报告段落失效桩** | 两者形状高度相似（都是「标注引用处 + 通知拍板人 + 不改快照」） | 极可能**是同一个操作**。一致性复核须裁定：若相同则本束**不新造**，直接调 phase-00 的；否则说清差异。否则就是第 N 次同一事实两处声明 |

---

## 六、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `listProjectArtifacts` | 22-1 V1 V2 V3 V5 V6 V10 · 22-3 V1 V11 · 22-4 V4 | ✅ |
| `getArtifactTree` | 22-1 V4（round-trip 比对基准） | ✅ |
| `searchArtifacts` | 22-1 R3 步骤7 FTS + 六项筛选（F33） | ✅ |
| `previewArtifactVersion` | 22-1 V7 V8 · F32 五类预览器 | ✅ |
| `issueDownloadUrl` | 22-1 V2 V7 V9 · 22-4 V4 | ✅ |
| `createExportJob` / `getExportJob` | 22-1 V4 · 22-4 V9（回执需导出记录） | ✅ |
| `renameArtifact` / `resolveArtifactAlias` | 22-1 V11 | ✅ |
| `uploadArtifact` | 22-2 V1 V4 V5 V6 V8 V9 V11 | ✅ |
| `getIngestionRun` / `getIngestionUiState` | 22-2 V2 V3 V10 | ✅ |
| `retryIngestionStep` / `replayIngestionRun` | 22-2 V10 V12 | ✅ |
| `resolveReviewPending` | 22-2 V13 · 22-3 V6 | ✅ |
| `requestAiFillMissingMaterial` | 22-2 V13 | ✅ |
| `wrapDocumentAsData` | 22-2 V7 🔴 | ✅ |
| `materializeSource` | 22-3 V1 V2 V3 V4 V7 V10 | ✅ |
| `getMaterializationSpec` | 22-3 V1 V8 | ✅ |
| `listMaterializationFailures` | 22-3 V9 | ✅ |
| `listVersions` / `uploadNewVersion` | 22-4 V1 V2 | ✅ |
| `listDerived` / `rerunDerivation` | 22-4 V3 | ✅ |
| `previewDeleteImpact` | 22-4 R7「删除前必须显示影响面预览」（F45） | ✅ |
| `requestDeletion` | 22-4 V4 V5 V6 V10 V13 | ✅ |
| `getDeletionTask` / `listTrashQueue` / `retryCascade` / `revokeDeletion` | 22-4 V6 V7 V13；`revokeDeletion` 见下 | ⚠ `revokeDeletion` **暂无 UC 强制**（A5 是 `[待确认]` T-5）——**它是本束唯一一个可能多余的操作**，人类若裁定不提供撤销，须删除 |
| `applyLegalHold` / `releaseLegalHold` | 22-4 V8 | ✅ |
| `getDeletionReceipt` | 22-4 V6 V9 | ✅ |
| `getRetentionPolicy` / `setRetentionPolicy` | 22-4 V11 | ✅ |
| F47 出站桩 ×2 | 22-4 V5 第 ⑤ 项 + 报告段落 | ✅（⚠ 见 C-3） |

**除 `revokeDeletion` 外，全部操作均有 UC 要求，无孤儿接口。**
反向另有一条：`queryProvenance`（22-1 V9 / 22-4 V14 要它）**本束不定义**，
复用 phase-00 artifact 束——这是缺口 1 的直接后果，写在这里以免被当成遗漏。

---

## 七、签核时请重点看这三处

1. **C-1 是一个真冲突，不是缺口**——`sourceType` 在两个阶段有两份不同的定义（7 值 vs 8 值，
   命名也对不上）。这不是「phase-01 还没定」，是「已经定了两遍且不一样」。
   **在收敛前不要写 `packages/contracts/src/files.ts` 的枚举**，否则第三份副本就诞生了。
2. **缺口 11 是契约管不到的东西**——「物理删除必须清版本化桶的全部历史版本」与
   phase-00「bucket object-lock 保证写一次」**不能在同一个桶上同时成立**。
   请确认分桶策略有人负责，否则要么删不干净（回执是假的），要么原件可被覆盖（I-2 落空）。
3. **缺口 15 + 缺口 9 是两个「界面上无法表达」的洞**——合规负责人这个角色在角色模型里不存在，
   而「物化失败」这个态在界面上不存在。前者让 F46 的验收无处落脚，
   后者让 UC-22.3 自称最危险的缺陷模式（静默失败）恰好无法被看见。
