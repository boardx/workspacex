# file-first（文件为主导的上下文管理）实施复盘 + 修复 backlog

> 2026-09-28。对照 `docs/architecture/context-engine.md` §2.0 五条 + §3 摄取硬规则 + §4/§5，
> 逐条读代码核对生产链路（不是读测试）。标 ✔ 的条目有 grep/实测复核；其余为读代码结论。
> 本文是**档案层**（「当时查到了什么」），不是现行标准；修复进度以 GitHub issue / PR 为准。
> 跟踪：epic #4594 · 迭代 1 #4595 · 迭代 2 #4596 · 迭代 3 #4597。

## 一、总判断

原则在**纯函数 + fake 仓储**层面写得完整，但生产链路大面积未接通；22-files 的 21 个 feature
全标 `passing`，其门控（F41/F43/F45 等）是跑在 `FakeArtifactRepository` / `FakeObjectStore`
上的单测——「静态痕迹 ≠ 动态事实」（`.harness/instructions/static-trace-vs-live-fact.md`）的又一例。

| 原则 | 现状 |
|---|---|
| ① 每个版本都有真实文件 | 仅 F04 主表 `artifact_versions` 成立；数字访谈版本正文存 DB 列，无对象 key |
| ② 非文件来源物化 | 物化主干（`materializeSource*`/事件总线）无生产调用方 ✔；问卷/研究/画布无生产者 |
| ③ 浏览器是 artifacts 投影 | 另有 `agent_artifacts`、各类附件表、VFS 等并行存储 |
| ④ 派生物是可见文件 | 无派生物列表/下载接口；OCR/ASR 为桩 |
| ⑤ 一套 ACL | SQL 版 `wsx_visible_artifacts` 与 TS 版 `strictestScope` 两份；对话 L3 检索绕开 |

## 二、Backlog（三个迭代）

优先级：P0 = 越权 / 泄露；P1 = 已删除/已撤销内容复活；P2 = 主链路未接通；P3 = 覆盖面与治理。

### 迭代 1 —— 止血：越权、泄露、删除后复活（本迭代只改读/判权谓词，不改数据模型）

| ID | P | 问题（证据） | 修复 | 验收 |
|---|---|---|---|---|
| FF-100 | P0 | 对话项目分支 `resolveVisibility` 不校验 `thread.projectId === 入参 projectId` ✔（实测：项目 B 成员带 `?projectId=B` 读项目 A 的线程 = 200，且 `messages.jsonl` 被物化进 **B** 的文件浏览器） | 项目分支加 mismatch 门，与 `projectId=null` 那道门同一出口（not-found） | 跨项目读线程/取 messages-file ⇒ 404；同项目正样本 200 |
| FF-101 | P0 | 对话 L3 检索 `pg-file-retrieval.ts` 召回 `chat_artifact_landings.content_excerpt` 不看 artifact 的删除态 / ACL | landings 分支加谓词：落地的 artifact 必须存在、未删除，且项目内必须过 `wsx_visible_artifacts()` | 删除 artifact 后同一 query 召回为 0；team-only 对非本组成员召回为 0 |
| FF-102 | P0 | 一次性下载链接兑换（file 分支）只验 token，不再判可见性 ✔（`deliver-artifact.ts` `redeemDownloadUrl`） | 兑换事务内重跑与签发同一个 `resolveVisible`（行门 + authorize） | 签发后删除 / 撤成员 ⇒ 兑换 404 |
| FF-103 | P0 | `messages.jsonl` 每线程只物化一次、内容按**第一个取用者**的角色决定：成员先取 ⇒ 之后每个观察者拿到含原始转写 / 私聊行的完整文件 ✔ | 共享的那一份对所有请求者都套观察者过滤（每个能取它的人都有权读的交集）；代价：成员下载的文件同样不含原始转写行 | 成员先取、观察者后取 ⇒ 文件字节里无原始转写行 |
| FF-104 | P1 | 删除后可重建索引：`PgArtifactIndexTargets/Source/Writer` 与检索 `CANDIDATE_SET` 不看 `artifacts.deleted_at` | target / source / 检索候选集加 `deleted_at` 谓词；writer 在事务内复跑 `source.load`，由同一谓词挡住（其 SQL 受指纹 lint 锁定，不改） | 删除后调 `POST /artifact-versions/:id/index` 不再写回 `segment_text`；检索召回 0 |
| FF-105 | P1 | 幂等查找 `findVersionByIdempotencyKey` 不排除已删除 artifact ✔：删后重传同一文件 ⇒ `duplicate:true` 指向已删除条目，用户看不见 | 查找加 `a.deleted_at IS NULL` | 删后重传 ⇒ 新 artifact 出现在浏览器 |
| FF-107 | P0 | **新发现（修 FF-103 时实测）**：组内共享 / 私聊线程的 `messages.jsonl` 作为**项目级** artifact 物化，项目内**任何**成员都能在文件浏览器看到、检索到（`retrievable:true`）并下载 ✔——文件浏览器的 ACL（项目 + team）比线程可见性（组 / 本人）粗 | ⏸ 需人类裁决：A 只为全场线程物化，受限线程返回 FILE_NOT_MATERIALIZED（改变 I-12 已签的「第二组的人取得到」）；B 给 artifact 引入线程级 ACL（改数据模型）；C 受限线程物化为不进项目树的个人/组级 artifact | 别组成员在浏览器 / 检索 / 下载三处都看不到 |

> 迭代 1 调整：FF-103 原附带的「`downloadUrl` 死链」不是泄露，移到迭代 2（FF-210）；
> FF-106（`listDerived` 不看 `deleted_at`）单独加过滤会让 PII 复核在已删 artifact 上 fail-open，
> 移到迭代 3 与「暴露派生物」一起做（FF-311）。

### 迭代 2 —— 接通主链路与可靠性

| ID | P | 问题 | 修复方向 |
|---|---|---|---|
| FF-201 | P2 | 无生产 worker 消费 ingestion outbox ✔（`runIngestionWorkerTick` 无调用方）；上传永远停在 STORED | API 进程内（或独立进程）按间隔 tick，带开关与优雅停机 |
| FF-202 | P2 | 物理删除无调度（仅手动 `files:purge`）；导出 zip 不在清理范围 | 定时 `maintainPhysicalDeletion`；`purgeableObjectsFor` 纳入 exports |
| FF-203 | P2 | 录音结束不自动物化 ✔（前端 `materializeRecordingFiles` 无调用方） | 会话结束路径触发物化（服务端），失败可见可重试 |
| FF-204 | P2 | `context_packs` 无写入方 ✔；`context_pack_invalidations` 无读方 | 对话 run 组装后写 `ContextPackStore.record`；serve/replay 读失效表 |
| FF-205 | P2 | 物化主干（`materializeSource`/`MaterializeEventBus`/失败记录/source_ref 索引）只有 fake 实现 | 补 Pg 实现并接入生产事件源 |
| FF-206 | P2 | 物化先建 artifact 行再写对象、部分失败不回滚 ⇒ 孤儿行；每次物化新建 artifact（版本号恒 1）；多文件版本只登记 `written[0]` | 同 source_ref 追加版本；失败补偿；多部件登记 |
| FF-207 | P2 | EXTRACTED 步崩溃重放时 `ObjectExistsError` 直接 return ⇒ 派生记录永远缺失；`pipelineVersion` 写死 `"1"`；派生键不含 parser 版本 | 已存在时补写派生行；用常量；键含 parser 版本 |
| FF-208 | P2 | PII 复核读不到字节 `continue`（fail-open），且扫全部版本 | fail-closed；只扫当前版本 |
| FF-209 | P2 | L3 附件分支与 landings 摘录不随删除级联清理（迭代 1 只在读侧挡住） | 删除级联清 `content_excerpt`/`search_tsv` |
| FF-210 | P2 | `messages.jsonl` 返回的 `downloadUrl` 用 artifactId 拼了一条不存在的路由 ✔ | 实现经 `resolveVisibility` 的下载路由并改正 URL |
| FF-211 | P2 | FF-103 修复前已物化的 `messages.jsonl`（可能含原始转写行）仍作为唯一登记文件 | 清理 `chat_thread_files` 指针并按新规则重物化；旧版本走删除流程 |

### 迭代 3 —— 覆盖面与治理

| ID | P | 问题 | 修复方向 |
|---|---|---|---|
| FF-301 | P3 | 问卷 / 深度研究 / 画布无物化生产者；工作坊白板照片不在允许文件名内 | 各来源接入物化主干 |
| FF-302 | P3 | 数字访谈产物正文存 DB 列、无对象 key（违反原则 ①） | 迁移到 artifact_versions（或 ADR 豁免） |
| FF-303 | P3 | `agent_artifacts`、各类 `*_attachments`、VFS 为并行存储 | 物化进 artifacts，或逐项 ADR 豁免 |
| FF-304 | P3 | 判权两份实现（SQL / TS）；`acl_bindings.subject_*` 从不读取 | 收敛为单一事实源 + 机械门；决定 subject 授权语义 |
| FF-305 | P3 | 派生物无列表/下载接口（原则 ④） | 暴露派生物（依赖 FF-106） |
| FF-306 | P3 | 前端文件页以 mock 为主；列表不返回 `versionId` 致预览/下载未接；过期注释 | 接真实 API |
| FF-307 | P3 | OCR/ASR/PDF 抽取为桩；恶意扫描只认 EICAR | 真实适配器 / ClamAV（或显式降级标记） |
| FF-308 | P3 | `messages.jsonl` 两套字段格式（`build-conversation-file.ts` vs 生产） | 收敛单一格式 |
| FF-309 | P3 | F41/F43/F45 的门控是 fake 单测；无真库「业务对象 − 文件」缺口扫描 | 真库总闸测试；相关 passing 状态请人类复核（agent 不改状态） |
| FF-310 | P3 | 草稿不带字节（`saveDraft.in` 无内容，D-2 未落地） | 按 D-2 实现预签名直传 |
| FF-311 | P3 | `listDerived` 不看 `deleted_at`（今天只被 PII 复核用；暴露派生物前必须先修，且复核侧要同时改为 fail-closed） | 与 FF-305 一起做 |
