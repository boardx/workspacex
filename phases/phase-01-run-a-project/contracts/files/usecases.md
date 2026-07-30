# 契约束 `files` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 S3、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（权威）。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
本模块**原型确认缺失**（四份 UC 的 R8 一致判定：项目工作台 7 标签 + 项目设置 6 子标签已完整抽取，
其中没有任何文件浏览 / 目录树 / 版本列表 / 删除确认的界面）。**没有 happy-path 原型可以继承，
也就没有借口只写 happy path。**

---

## 统一失败枚举 `FilesError`

### 复用 phase-00 `artifact` 束的 `ArtifactError`（**不重复定义**）

`NO_PROJECT_ROLE` · `PROJECT_ROLE_INSUFFICIENT` · `VERSION_CHANGED` · `REQUIRES_PINNED` ·
`CANNOT_DOWNGRADE` · `SNAPSHOT_IMMUTABLE` · `ARTIFACT_NOT_FOUND` · `MATERIALIZATION_FAILED` ·
`INGESTION_FAILED` · `DEPENDENCY_UNAVAILABLE`
（权威：`phases/phase-00-shared-kernel/contracts/artifact/usecases.md`）

⚠ `ARTIFACT_NOT_FOUND` 在本束**收紧**：不仅是「404 非 403」，而是与「真的不存在」**逐字节同响应**
（状态码 + 响应体 + 响应头，N-25 / V6·22-1）。任何差异都是资源存在性泄露。

### 本束新增 18 码

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `FILE_TYPE_REJECTED` | 扩展名/MIME 不在白名单 | 逐个列出「哪个文件、哪一项、实际是什么」 | ⚠ 白名单本身 **[待定 T-2]** |
| `FILE_TOO_LARGE` | 单文件超上限 | 必须同时给**当前值与上限值** | 数值 **[待定 T-1]** |
| `BATCH_LIMIT_EXCEEDED` | 单次批量超上限 | 同上；出口：拆分 / 申请提额 | 提额路径是否提供 **[待定]** |
| `ARCHIVE_BOMB_DETECTED` | 解压后总量/层数/条目数超限 | 同上，且**未发生完整解压** | V5·22-2 |
| `MALWARE_DETECTED` | 恶意扫描不通过 | 已拒绝并留痕；仅安全/合规角色可处置 | **不得抹掉痕迹**（N-9） |
| `MIME_MISMATCH` | 实际字节类型 ≠ 扩展名 | 提示实际检出类型；有权者可「按检出类型继续」（写审计） | **不信任扩展名与 `Content-Type` 头** |
| `INTEGRITY_CHECK_FAILED` | SHA-256 与对象字节不符 | 该行标「完整性校验失败」+ 禁止下载 + 告警 | **不得悄悄给出损坏文件**（V8·22-1） |
| `EXPORT_LIMIT_EXCEEDED` | 批量导出超阈值 | 改为分批 / 转后台生成 | **不得静默截断**（E2·22-1）；阈值 **[待定 T-10]** |
| `DOWNLOAD_URL_EXPIRED` | 短时效 URL 过期 | 重新签发 | N-24 |
| `DOWNLOAD_URL_CONSUMED` | 一次性 URL 已用 | 重新签发 | N-24；**不得签发可转发的长期公开链接** |
| `EXTRACTION_FAILED` | 加密/损坏/编码不支持 | 三段式「在哪步失败 + 为什么 + 能做什么」 | 🔴 **原件仍可见可下载**（N-7 / AC3·22-2） |
| `REVIEW_REQUIRED` | 命中机密 ∨ PII 五类 ∨ 解析质量低 | 等待人工确认（附原因）+ 接受/拒绝/查看检出详情 | **不得静默入库**；阈值与审核人 **[待定 T-9]** |
| `PROVENANCE_MISSING` | 生成物缺 `provenance.json` 七键之一 | 溯源信息缺失，停在 `REVIEW_PENDING` | 🔴 N-12，**不得进 READY** |
| `MATERIALIZATION_SPEC_VIOLATION` | 产出文件名集合 ≠ 七类清单该行 | 物化失败，内容未入库 + 原因 + 重试 | N-10；⚠ 与 `MATERIALIZATION_FAILED` 分开——前者是**契约违反**，后者是**执行失败** |
| `LEGAL_HOLD_ACTIVE` | 对象处于 legal hold | 明确说明原因；若为受访者撤回触发，**如实告知存在法定留存** | 🔴 **不得出具虚假回执**（N-19） |
| `DELETION_PARTIAL_FAILURE` | 六类级联部分失败 | 「部分失败 · 未出回执 · 重试级联」 | 🔴 N-17，本束最危险的态 |
| `CASCADE_TARGET_UNAVAILABLE` | 下游失效接口不可用（09-kg / 10-report / pgvector / 缓存） | 同上，标出**哪一类**未完成 | 跨阶段依赖，见 coverage 缺口 |
| `AGENT_CANNOT_DELETE` | agent 身份调删除 | — （不面向用户） | 🔴 agent **不得**发起删除（D-39 同源） |

⚠ **拒绝响应不得泄露资源是否存在**——凡涉及可见性的拒绝一律折叠为 `ARTIFACT_NOT_FOUND`。
⚠ **失败态不显示裸错误码**：统一「在哪一步失败 + 为什么 + 能做什么」三段式（R8·22-2）。

---

## 用例

### A 组 · 浏览与交付（uc-22-1）

#### `listProjectArtifacts` —— 列表/树的唯一读入口

```
UC: 列出项目文件（RLS 过滤后）
  in:  { projectId, view: "tree"|"list", filters?: { sourceType[], agendaSegmentId[],
         timeRange?, uploader?: {type,id}, confidential?: boolean, ingestionState[] },
         cursor?, pageSize? }
  out: { nodes: FileNode[], sourceCounts: Record<SourceType, number>, cursor? }
  pre: 调用者在该项目持有至少一个项目角色（或走 UC-0.3 A1 的受审计读取路径）
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE
```

- **权限过滤在 SQL/RLS 层完成**，不在应用层；应用连接**不得使用表 owner 身份**
  （PG 表 owner 默认不受 RLS 限制 ⇒ 用 owner 连接等于 RLS 形同虚设）。
- 无权见到的**不出现、不占位、不显示「已隐藏 N 项」**——计数本身即信息泄露。
- 但**八类来源节点恒显示**（空的标为空，A5·22-1）。两条不冲突：前者是权限过滤后不留占位，
  后者是枚举恒显示。⚠ 这一条 ui-preview S 清单第四节第 2 条已替 UC 做了区分，须签核确认。
- 空态返回八节点 `count:0`，**不生成任何示例数据**（V5·22-1）。
- 对象存储不可用时**仍 200 返回元数据**（元数据来自 PG），仅下载/预览降级（V7·22-1）。
- **筛选条件必须可组合、可从 URL 还原**（把一个视图发给同事）。

#### `getArtifactTree` —— zip 导出 round-trip 的比对基准

```
UC: 取目录树结构
  in:  { projectId, filters? }
  out: { tree: TreeNode[] }        // 一级=来源类型，二级=agenda_segment（含「未归入环节」）
  pre: 同上
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE
```
⚠ **「未归入环节」节点必须存在且不可隐藏**——否则通用上传的文件会从树上消失。

#### `searchArtifacts` —— FTS 一等检索通道

```
UC: 搜索文件名与已抽取文本
  in:  { projectId, q, filters? }
  out: { hits: { node: FileNode, snippet?: string, anchor?: Anchor }[] }
  pre: 同上
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE
```
⚠ **含机密标记文件的命中片段是否展示 [待定 T-6]**——展示则片段脱离「整份走本地模型」的路由约束；
不展示则搜索对机密材料等于失效。本契约暂按 **fail-closed（不展示片段，只出文件名）**，需人类裁决。

⚠ **界面已先表了一半态**（`ui-preview/files/README.md` 二·4）：搜索框 `files-search` 已建成，
但**没有第八种状态可切**来表达「机密文件命中的正文片段给不给非授权者看」。
⇒ 这条不定，搜索对机密材料**要么失效、要么泄露，而且两种情况在界面上都不可见地存在**。
`out.hits[].snippet` 是否可空、何时可空，**签核前不要当成已定**。

#### `previewArtifactVersion`

```
UC: 打开预览面板
  in:  { versionId }
  out: { kind: "pdf"|"image"|"audio"|"text"|"jsonl"|"unsupported",
         renderMode: "inline"|"isolated-attachment", meta, anchorSupport: boolean }
  pre: 调用者对该 artifact 可见
  err: ARTIFACT_NOT_FOUND | INTEGRITY_CHECK_FAILED | DEPENDENCY_UNAVAILABLE
```
- `unsupported` **必须**明确显示「此类型不支持预览，请下载查看」+ 下载按钮，
  **不得显示空白或转圈**。
- 未知类型一律 `Content-Disposition: attachment` + **隔离域名**，不在主域内联渲染
  （防 XSS / SVG 脚本注入 / HTML 直接渲染）。
- 派生物未就绪时标「生成中」，并如实说明检索侧尚未可召回（E5·22-1）。

#### `issueDownloadUrl`

```
UC: 签发单个下载 URL
  in:  { versionId, purpose: "download"|"export" }
  out: { url, expiresAt, permissionDecisionId, oneTime: true }
  pre: 调用者对该 artifact 可见；对象存储可用
  err: ARTIFACT_NOT_FOUND | INTEGRITY_CHECK_FAILED | DEPENDENCY_UNAVAILABLE
     | DOWNLOAD_URL_EXPIRED | DOWNLOAD_URL_CONSUMED
```
⚠ **短时效 + 绑定 principal + 一次性**，不得签发可转发的长期公开链接（N-24）。
下载动作写 `provenance_events`（17-gov/UC-17.1 四类事件之一）。
⚠ **观察者是否有下载权 [待定 T-6]**——`pre` 的完整形式取决于该裁决。
⚠ **界面已先表了一半态**（`ui-preview/files/README.md` 二·3、四·1）：`uc-22-1-browser-denied.png`
画的是「观察者只见已发布已脱敏，含机密/未发布不进结果集」，但**下载按钮的结构被保留**，
原型 agent 明确说明「没有把『观察者不能下载』硬编码进组件逻辑，等裁决后只改一处 gate」。
⇒ **界面看起来像已经定了，其实没有**。这条不定，F31/F32 的 RLS 验收断言写不出。

#### `createExportJob` / `getExportJob`

```
UC: 批量导出为 zip
  in:  { projectId, selection: { artifactIds[] } | { treeNodeId } }
  out: { jobId, status: "queued"|"running"|"done"|"failed", downloadUrl?, expiresAt? }
  pre: 调用者对选中集合全部可见
  err: NO_PROJECT_ROLE | EXPORT_LIMIT_EXCEEDED | DEPENDENCY_UNAVAILABLE
```
- zip 内部目录结构 **≡ `getArtifactTree` 的结构**；根目录附 `manifest.json`
  （每条含 `artifact_id` / `version` / `sha256` / 来源类型 / 生成时间 / 机密标记）。
- **导出本身写审计**——它是 N-19「回执须如实说明已出域内容」的数据来源（V9·22-4）。
- 失败**不产生半截 zip**；临时对象被清理。**超阈值拒绝，不静默截断**。

#### `renameArtifact` / `resolveArtifactAlias`

```
UC: 改名（目录与文件名是契约）
  in:  { artifactId, newName, reason }
  out: { aliasFrom: string, aliasTo: string, changeLogId }
  pre: 调用者有写权限
  err: ARTIFACT_NOT_FOUND | PROJECT_ROLE_INSUFFICIENT
```
⚠ **禁止随手重构**：改名/改目录层级必须走迁移——保留旧路径的重定向或别名并记入变更日志。
理由：客户已下载的 zip、已发出的引用链接、已归档的交付物都依赖它（N-23 / V11·22-1）。

---

### B 组 · 上传与摄取（uc-22-2）

#### `uploadArtifact`

```
UC: 上传材料（两个入口）
  in:  { projectId, agendaSegmentId?: AgendaSegmentId | null, files: FilePart[],
         confidential: boolean, visibilityScope, onDuplicate?: "use-existing"|"as-new-version" }
  out: { runs: { ingestionRunId, artifactId?, duplicateHit?: DuplicateInfo }[] }
  pre: 调用者在该项目持有可写角色；`agendaSegmentId` 归属该项目（服务端校验，不信任客户端）
  err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT | FILE_TYPE_REJECTED | FILE_TOO_LARGE
     | BATCH_LIMIT_EXCEEDED | ARCHIVE_BOMB_DETECTED | MALWARE_DETECTED | MIME_MISMATCH
     | DEPENDENCY_UNAVAILABLE
```
- ⚠ **前端预检只是体验优化，服务端必须完整重做全部校验**。观察者调此接口 403。
- **入口一**（材料准备某行）自动绑该行 `agendaSegmentId`；**入口二**（文件页/拖拽）为 `null`。
- 机密勾选**默认继承项目级默认值**，界面须显示继承来的值而非空白复选框（O-17）。
- **幂等命中不得静默**：既不静默去重、也不静默重复入库，必须给二选一，
  **默认「使用已有」**（A3·22-2）。
- 先写 PG 元数据 + **transactional outbox**，再由 worker 消费——
  不允许「边传边处理、失败就丢」的同步实现。
- 对象存储写入失败 ⇒ 事务不提交，**不产生幽灵版本**；反向 PG 提交失败 ⇒ 临时对象被清理（V11·22-2）。

#### `getIngestionRun` / `getIngestionUiState`

```
UC: 查摄取九态与它的界面出口
  in:  { ingestionRunId }
  out: { state, history: State[], uiState: { label: NonEmpty, exits: Exit[] },
         originalDownloadable: boolean, retrievable: boolean }
  pre: 调用者对该 artifact 可见
  err: ARTIFACT_NOT_FOUND | INGESTION_FAILED
```
⚠ `originalDownloadable` 与 `retrievable` 是**两个独立布尔**（N-7）：
`STORED` 之后原件即可下载，`READY` 之前不进检索召回。**合成一个布尔就说不清了。**

#### `retryIngestionStep` / `replayIngestionRun`

```
UC: 失败重试 / worker 崩溃后重放
  in:  { ingestionRunId, step?: IngestionState }
  out: { ingestionRunId, state }
  pre: 该 run 处于失败态或积压态
  err: ARTIFACT_NOT_FOUND | INGESTION_FAILED | DEPENDENCY_UNAVAILABLE
```
⚠ **重试必须幂等**：不得产生多份重复转录；重放不产生重复 Segment（N-6 / V12·22-2）。
⚠ **重跑摄取只生成新派生版本，不修改旧结果**（旧行 `updated_at` 不变）。

#### `resolveReviewPending`

```
UC: 人工复核 REVIEW_PENDING
  in:  { artifactId, decision: "accept"|"reject", note }
  out: { state: "READY"|"rejected", provenanceEventId }
  pre: 调用者是审核人角色 —— ⚠ 具体是谁 [待定 T-9]
  err: ARTIFACT_NOT_FOUND | PROJECT_ROLE_INSUFFICIENT | REVIEW_REQUIRED | PROVENANCE_MISSING
```
⚠ **触发判据（结构性，本束已定）**：机密标记 ∨ PII 五类（邮箱/手机号/身份证号/银行卡号/详细住址，O-39）
∨ 解析质量低于阈值 ⇒ **必入 `REVIEW_PENDING`，不得静默入库**。**阈值数值 [待定 T-9]**。
这正是 phase-00 `artifact` 束 coverage 缺口 ⑦ 说的「先做结构性断言，阈值后填」的落地。

#### `requestAiFillMissingMaterial`

```
UC: [让 AI 补齐缺料]
  in:  { projectId, agendaSegmentId, requirement }
  out: { artifactId, ingestionRunId, state: "REVIEW_PENDING" }
  pre: 调用者有写权限；该环节在「材料要求」列有缺料标记
  err: NO_PROJECT_ROLE | PROVENANCE_MISSING | DEPENDENCY_UNAVAILABLE
```
⚠ 产物**强制** `sourceType="generated"` + `synthesized` + `provenance.json`，
**默认落 `REVIEW_PENDING`，人接受前不召回**（D-27 同源）。
agent **不得**绕过扫描与限制，**不得**自行把机密标记勾为否。

#### `wrapDocumentAsData`（🔴 端口，不是 HTTP 操作）

```
UC: 把抽取文本包裹为不可信数据后再进模型调用
  in:  { versionId, text, filename }
  out: { block: DataBlock }        // 带来源标注的 <document> 边界或等价结构
  pre: —
  err: —
```
🔴 **文档内容与文件名都是不可信数据，不得被 agent 当作系统指令**（架构第三节）：
① 必须包裹为数据，**不得直接拼进 system prompt**；②**文件名同样是攻击面**；
③「忽略以上指令」「你现在是…」等模式不改变 agent 行为；
④ agent 依据文档内容发起的高影响操作走 R2/R3 风险分级的人工确认（D-27/D-28）。
**红队样本通过率必须 100%**——这是一组红队用例，不是普通单测。

---

### C 组 · 物化（uc-22-3）

#### `materializeSource`（系统事件驱动，**不是**用户点导出）

```
UC: 把非文件来源物化为文件
  in:  { event: SourceEvent, sourceType, sourceRef, projectId,
         agendaSegmentId?, trigger: "created"|"changed"|"closed"|"manual-rerun" }
  out: { artifactIds: string[], fileNames: string[], versionBumped: boolean }
  pre: UC-22.2 的摄取链路可用；业务对象已产生数据
  err: MATERIALIZATION_FAILED | MATERIALIZATION_SPEC_VIOLATION | PROVENANCE_MISSING
     | DEPENDENCY_UNAVAILABLE
```
- 🔴 **物化是同步契约，不是事后导出**——业务对象产生即生成/更新对应文件版本，
  **不需要用户点任何「导出」按钮**。时限 **[待定 T-3]**。
  ⚠ **界面上是空缺，不是占位**（`ui-preview/files/README.md` 二·5、五·6）：
  上传弹层与摄取抽屉里**没有把「多久算物化完成」显示出来**，因为没有权威数值。
  ⇒ 别把「界面上没有这个字段」误读成「不需要这个字段」——AC2 的验收断言直接依赖那五个数。
- ⚠ **原件同步 ≠ 派生物同步**（README 四·2 处理的那条表观冲突）：
  「物化是同步契约」约束的是**原件可见性**（`STORED` 即可见可下载），
  **派生物允许异步**并标 `generating`（转录后到，A4·22-3）。两者不冲突，但契约必须分开说。
- 产出**送入 UC-22.2 的同一条持久队列**，**不另建入库路径**；优先级**低于**用户主动上传。
- 新建 / 新版本 / 不新增版本三分支：`content_hash` 相同 ⇒ **不新增版本**，
  只更新 `provenance_events` 的最后核对时间（V10·22-3）。
- 可见性**继承业务对象并与全部引用来源取最严结果**；无法判定时 **fail-closed**（N-14）。
- 🔴 **物化失败不阻断业务**，但必须产生**可见的失败记录**（出现在文件浏览器对应位置，
  带原因与重试）。**静默失败是本 UC 最危险的缺陷模式**——用户会以为都在文件里了，
  交付时才发现缺（V9·22-3）。
- 物化风暴：进同一持久队列，有背压与优先级，积压超阈值给**可见告警，不丢事件**。
- 部分成功：深度研究某个网页快照抓取失败 ⇒ `citations.json` 仍产出并标 `snapshot_failed`，
  **不因为一个来源抓不到就整场不物化**（A5·22-3）。

#### `getMaterializationSpec`

```
UC: 取某来源类型的固定文件清单（契约自查）
  in:  { sourceType }
  out: { requiredFileNames: string[], granularity: "per-version"|"per-session"|"per-run" }
  err: —
```
⚠ 七个固定文件名是契约，**实现不得少产出任何一个**（N-10）。
产物格式必须是**开放可归档**的（JSONL / JSON / CSV / 音频 / 图片），
**不得**用私有二进制或需本产品才能打开的格式——「对象存储里那棵树本身就是一份可离线打开的交付物」。

#### `listMaterializationFailures`

```
UC: 列出物化失败记录
  in:  { projectId, sourceType? }
  out: { failures: { sourceRef, sourceType, reason, occurredAt, retryable: true }[] }
  pre: 调用者对该项目可见
  err: NO_PROJECT_ROLE
```
⚠ **不存在「业务对象存在但浏览器里什么都没有」的静默态**（V9·22-3）。

---

### D 组 · 版本、派生物、删除传播（uc-22-4）

#### `listVersions` / `uploadNewVersion`

```
UC: 版本线
  in:  { artifactId }
  out: { versions: { versionNumber, createdAt, creator: {type,id,agentRunId?}, sizeBytes,
                     sha256, changeSource: "upload"|"materialize"|"rerun", downloadable: true }[] }
  pre: 调用者对该 artifact 可见
  err: ARTIFACT_NOT_FOUND | NO_PROJECT_ROLE
```
```
UC: 上传新版本
  in:  { artifactId, file, expectedHeadVersion }
  out: { versionId, versionNumber, duplicateHit?: true }
  pre: 调用者有写权限
  err: VERSION_CHANGED | FILE_TYPE_REJECTED | FILE_TOO_LARGE | MALWARE_DETECTED
     | MIME_MISMATCH | SNAPSHOT_IMMUTABLE | DEPENDENCY_UNAVAILABLE
```
- 🔴 **旧版仍可下载**——这是证据平面不可变性的用户可见形式；
  旧版本对象在新版本上传后**字节未变**（`ETag`/`LastModified` 不变，V1·22-4）。
- **版本回滚 = 把旧版内容作为新版本再上传**（新建 v4 内容等同 v2），
  **不是**把 v2 重新置为当前版（A1·22-4，与 O-18 同构）。
- 上传新版本时旧版本正在被下载 ⇒ 下载正常完成（永不覆盖，E7·22-4）。
- **能否删除单个中间版本 [待定 T-4]**。
  ⚠ **界面已替 UC 取了保守默认**（`ui-preview/files/README.md` 二·6）：
  `uc-22-4-versions.png` 每个历史版本都给了「下载」但**没给「删除此版本」**——
  即默认取「不能删中间版本」。**这是原型 agent 取的保守解，不是裁决。**
  裁决若反向（可删单版本），本契约须补一个 `deleteVersion` 用例，
  并处理「v2 曾被某条 Claim 引用则该 Claim 悬空」的证据链完整性问题。

#### `listDerived` / `rerunDerivation`

```
UC: 派生物
  in:  { artifactId } / { versionId, kind: "ocr"|"asr"|"summary"|"vision"|"embedding" }
  out: { derived: { id, kind, derivedFrom: ArtifactVersionId, generatorModel,
                    generatorVersion, pipelineVersion, materialized: boolean }[] }
  pre: 调用者对原件可见
  err: ARTIFACT_NOT_FOUND | EXTRACTION_FAILED | DEPENDENCY_UNAVAILABLE
```
⚠ `derivedFrom` 指向**具体 `artifactVersionId`**，不是 `artifactId`（N-15）。
⚠ 除 embedding 外**都必须物化为独立可下载文件**；重跑产生**新派生版本**，
旧派生版本保留可下载（便于对比 OCR 质量改进）；**原件哈希不变**（V3·22-4）。

#### `previewDeleteImpact`

```
UC: 删除影响面预览（删除前必须让人看见代价）
  in:  { artifactId }
  out: { versionCount, derivedCount, segmentCount, referencingClaims: Ref[],
         referencingReportSections: Ref[], legalHold: boolean, exportedOutOfOrg: ExportRecord[] }
  pre: 调用者有删除权
  err: ARTIFACT_NOT_FOUND | PROJECT_ROLE_INSUFFICIENT | AGENT_CANNOT_DELETE
```

#### `requestDeletion`

```
UC: 发起删除
  in:  { artifactId, reason: string(>=4), scope?: WithdrawalScope, confirmedImpact: true }
  out: { taskId, logicalInvalidationDeadline, physicalDeletionDeadline }
  pre: 调用者是项目负责人（引导师/组长能否发起 [待定]）；已二次确认；已填原因
  err: ARTIFACT_NOT_FOUND | PROJECT_ROLE_INSUFFICIENT | AGENT_CANNOT_DELETE
     | LEGAL_HOLD_ACTIVE | SNAPSHOT_IMMUTABLE | DEPENDENCY_UNAVAILABLE
```
- 🔴 **agent 不得发起删除**（D-39 同源）；组员/观察者 403。
- **六类级联**：① 浏览器条目消失 ② 派生文件进队列 ③ embedding 退出 pgvector
  ④ FTS/Segment 退出召回 ⑤ `ontology_edges` 相关边失效 ⑥ 缓存与已构建 Context Pack 失效。
  **缺一即验收不通过**（架构首批门槛第 4 条）。外加：引用它的报告段落标「证据已撤回」
  （D-19：对内可见，对外不自动改写，需人工确认后替换）。
- **部分撤回**按 `scope` 裁剪级联子集（撤回「AI 分析」不删录音）。**映射表 [待定 T-8]**。
- 逻辑失效**不能等 worker**——必须在同步事务或极短异步内完成，否则 300s SLA 无法保证。

#### `getDeletionTask` / `listTrashQueue` / `retryCascade` / `revokeDeletion`

```
UC: 待删除队列与其五步流程
  in:  { projectId?, status? }
  out: { tasks: { taskId, artifactRef, step: 1|2|3|4|5, stepTimestamps, status,
                  cascadeResults: Record<CascadeKind, "ok"|"failed"|"pending">,
                  receiptId?, overdue: boolean }[] }
  pre: 调用者是合规负责人 —— ⚠ 该角色在 UC-0.3 四值项目角色枚举中**缺位**，见缺口
  err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT
```
```
UC: 重试级联 / 撤销删除
  in:  { taskId } / { taskId, reason }
  out: { status }
  pre: 合规负责人；撤销仅限宽限期内、物理删除执行前
  err: DELETION_PARTIAL_FAILURE | CASCADE_TARGET_UNAVAILABLE | LEGAL_HOLD_ACTIVE
```
🔴 **部分失败的删除不得标为完成、不得出回执**（N-17）；超 30 天未完成触发升级告警。
⚠ **是否提供撤销出口 [待定 T-5]**——它与对受访者的「已删除」承诺可能直接冲突。
⚠ **界面在这条上自相矛盾，须一并裁定**：`uc-22-4-delete-impact.png` 的确认按钮写
「逻辑失效 ≤5 分钟」但**没有「撤销删除」入口**（原型 agent 取的保守默认：
「宽限期由后台物理删除计时，前端不提供撤销」，README 二·6）；
而待删除队列组件里**已经有** `files-trash-revoke` / `files-trash-revoked` 两个 testid。
⇒ **同一件事在两个屏上表了相反的态**。裁决为「不提供撤销」时，
须同时删除本用例、那两个 testid、以及 `coverage.md` 反向检查里标出的那个孤儿操作。

#### `applyLegalHold` / `releaseLegalHold`

```
UC: legal hold
  in:  { artifactId, reason }
  out: { holdId, appliedBy, appliedAt }
  pre: **只有**合规负责人；全程留痕
  err: PROJECT_ROLE_INSUFFICIENT | ARTIFACT_NOT_FOUND
```

#### `getDeletionReceipt`

```
UC: 删除回执
  in:  { taskId }
  out: { objectRefs, hashes, deletedAt, executor, coverage,
         exportedOutOfOrg: ExportRecord[], uncoverableStatement: string }
  pre: 物理删除已完成（N-18：receiptId 非空 ⟺ 物理删除完成）
  err: DELETION_PARTIAL_FAILURE | LEGAL_HOLD_ACTIVE
```
🔴 **不得出具虚假回执**：已导出到组织外的内容无法回收时，回执必须**如实说明该边界**
并列出导出记录（来自 `createExportJob` 的审计，V9·22-4）。
⚠ **回执格式与是否需可验证签名 [待定 T-7]**（O-39 明标「必须等外部输入」）。

#### `getRetentionPolicy` / `setRetentionPolicy`

```
UC: O-01 留存五参数（单点配置，项目级可覆盖）
  in:  { orgId, projectId? } / { projectId, params: Partial<RetentionParams> }
  out: RetentionParams
  pre: 组织默认由管理员配；项目级覆盖由项目负责人配（D-14）
  err: PROJECT_ROLE_INSUFFICIENT | RETENTION_PARAM_INVALID
```
⚠ **不得硬编码**：05-rec / 06-itv / 04-agent / 17-gov / 21-mcp 共同消费同一份配置（N-20）。

---

### E 组 · 契约先行桩（F47，**出站端口**，正式实现属 phase-02）

```
UC: 失效图边（09-kg 提供）
  in:  { artifactId, versionIds[] }
  out: { invalidatedEdgeIds: string[] }
  err: CASCADE_TARGET_UNAVAILABLE
```
```
UC: 标记报告段落「证据已撤回」（10-report / 13-deliv 提供）
  in:  { versionIds[], reason }
  out: { annotatedSectionIds: string[], notifiedApprovers: string[] }
  err: CASCADE_TARGET_UNAVAILABLE
```
⚠ 两者是**本束调用、他模块实现**的出站端口。**任一模块不提供失效接口，AC2 就无法达成**——
这是本模块最大的外部风险（uc-22-4 R10 逐字）。第 ② 个端口与 phase-00 `artifact` 束的
`markEvidenceWithdrawn` **形状高度相似**，须一致性复核确认是不是同一个（见 coverage 缺口 3）。

---

## 失败模式穷举自查（对照契约设计执行书的七类）

| 类别 | 本束覆盖 |
|---|---|
| **并发** | `VERSION_CHANGED`（`expectedHeadVersion` 乐观并发）；并发删除同一 artifact ⇒ 第二次幂等收敛到同一 `taskId` |
| **越权** | `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT` / `AGENT_CANNOT_DELETE`；可见性拒绝一律折叠为 `ARTIFACT_NOT_FOUND`（逐字节同响应，N-25） |
| **依赖失败** | `DEPENDENCY_UNAVAILABLE`（对象存储/扫描服务/ASR）、`CASCADE_TARGET_UNAVAILABLE`（09-kg/10-report/pgvector/缓存）。⚠ 列表仍 200、下载降级；ASR 挂 ⇒ 原件仍 `STORED`，**整单不失败** |
| **幂等重放** | `duplicateHit`（内容级）；`replayIngestionRun`（worker 崩溃）；`materializeSource` 同 hash 不新增版本；重复删除不报错 |
| **部分成功** | 🔴 `DELETION_PARTIAL_FAILURE`（六类级联）；研究快照部分抓取失败标 `snapshot_failed`；多文件上传逐行独立重试 |
| **超时** | `RECEIVED→STORED` P95 <10s（100MB 内）；`STORED→READY` 异步且超时阈值可配 + 可见告警**而非无限转圈**；物理删除超 30 天升级告警；逻辑失效硬 SLA 300s |
| **撤回中 / 已删除** | 宽限期内对象**在浏览器中不再出现**，仅合规负责人在待删除队列可见（E6·22-1）；被引用的固定快照标「证据已撤回」而非静默 404（N-22） |
| **中途失权** | 上传者被移出项目/小组 ⇒ 已入库不回滚，但立即失去访问；进行中的上传中止（E8·22-2） |

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 复用 phase-00？ |
|---|---|---|
| `ObjectStore` | 原件/派生物读写；写一次不覆盖 | ✅ 复用 artifact 束 |
| `ArtifactRepository` / `DerivedRepository` / `ProvenanceWriter` | 元数据、派生物、append-only 事件 | ✅ 复用 |
| `IngestionQueue` | 九态、幂等键、outbox + worker、重放、背压 | ✅ 复用（物化**共用同一队列**） |
| `Hasher` | SHA-256 | ✅ 复用 |
| `MalwareScanner` | 恶意文件扫描 | 🆕 本束 |
| `MimeSniffer` | 以实际字节判定类型 | 🆕 本束 |
| `ArchiveInspector` | 解压后总量/层数/条目数（**不完整解压**） | 🆕 本束 |
| `PiiDetector` | O-39 五类最小集 | 🆕 本束（跨 17-gov） |
| `FullTextIndex` | PG FTS（一等检索通道） | 🆕 本束 |
| `ExportPackager` | zip + `manifest.json` | 🆕 本束 |
| `SignedUrlIssuer` | 短时效/绑 principal/一次性 | 🆕 本束 |
| `MaterializerRegistry` | 七类来源 → 固定文件清单 | 🆕 本束 |
| `CascadeInvalidator` | 六类失效的统一编排 + 部分失败语义 | 🆕 本束（③④⑥ 跨 context-pack，⑤ 跨 09-kg） |
| `RetentionConfig` | O-01 五参数单点读取 | 🆕 本束（跨 17-gov） |
