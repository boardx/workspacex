---
bundle: files
phase: "01"
covers: [F31, F32, F33, F34, F35, F36, F37, F38, F39, F40, F41, F42, F43, F44, F45, F46, F47]   # 束↔feature 映射的权威（ADR-023 决策三）；改它等于改评审范围
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:             # 确认人（姓名/邮箱）
confirmed_at:             # ISO 8601，且不得晚于签核当下
---

# 契约束 `files` 设计签核

依据 UC：`22-files/uc-22-1 项目文件浏览器` · `uc-22-2 上传材料与摄取` ·
`uc-22-3 非文件来源物化为文件` · `uc-22-4 版本、派生物与删除传播`（四份全读，含 `00-index.md`）

**这个束在做什么（一句话）**：给这个项目的**全部上下文**一个唯一的、可浏览的、可下载的、
**能真删**的物理形态——它是 Context Engine 证据平面的用户界面，也是「我们已经删了」这句话的**验收面**。

⚠ **本束与 phase-00 `artifact` 束高度耦合，但不重复它。**
原件不可变 / 版本 / SHA-256 / 摄取九态 / file-first 的**权威定义在 phase-00**
（`phases/phase-00-shared-kernel/contracts/artifact/domain.md` 的 I-1…I-14）。
本束 `domain.md` 第零节逐条列出继承关系，只声明 **phase-01 新增或收紧了什么**（N-1…N-25）。
phase-00 `artifact/coverage.md` 的缺口 **4 / 6 / 7** 明写「契约桩在 phase-01 先行」——那是本轮的输入，
处置见下文「对 phase-00 缺口的交代」。

---

## ① UI —— 人看到的界面对不对

→ 本束 `ui.md`（10 块屏、7 屏已建成、真实 `data-testid` 逐组件核对、12 张截图已在 `ui-preview/files/`）

⚠ **本模块原型确认缺失**（不是「未探明」）：项目工作台 7 标签 + 项目设置 6 子标签均已完整抽取，
其中没有任何文件浏览 / 目录树 / 版本列表 / 删除确认的界面。原型只有四处**计数钩子**，都无下钻目标。
⇒ **界面的每一处都是原创设计**，没有「原型就长这样」可以援引。

### 签核前请重点确认

- [ ] **删除确认与待删除队列这两屏，你看过图了吗** —— 它们**目前没有截图**（`ui.md` G-1）。
      而 `uc-22-4-trash-partial`（**部分失败**态）是 UC-22.4 R8 唯一要求「逐屏设计」的态。
      **半完成的删除比不删更危险**——这一张不看就签，等于没签 F45/F46。
- [ ] **「物化失败」这个态在界面上不存在**（G-3 🔴）。现有 `files-ingestion-failure` 是**摄取**失败，
      与「业务对象存在但没变成文件」不是同一件事。而 UC-22.3 自称**静默失败是它最危险的缺陷模式**，
      V9 明写「不存在业务对象存在但浏览器什么都没有的静默态」——它恰好无法被表达。
- [ ] **界面上的三个数字是占位不是裁决**：2 GB / 20 份 / 3 层（`ui.md` README-files 三·9）。
      别把它们当成已定值签进去。
- [ ] **界面比契约走得快的两处**：`files-trash-revoke`（撤销删除，T-5 未裁决）、
      观察者视角下载按钮仍按 happy path 显示（T-6 未裁决）。签核时须一并裁定。
- [ ] **S-02 你怎么裁** —— 合规负责人不在 UC-0.3 的四值项目角色里（裁决 O-03），
      而本束的待删除队列 / legal hold / 回执 / 恶意留痕处置全要它。
      ① 补第五个项目角色（**推翻 O-03**）还是 ② 归到组织角色层？

---

## ② 用例 —— 用例接口与失败模式穷举对不对

→ 本束 `usecases.md`（**26 个用例** + 复用 phase-00 的 10 个错误码 + **新增 18 码** + 14 个端口）
→ 支撑：`domain.md`（**25 条新增不变量 N-1…N-25** + 10 条 **[待定]** T-1…T-10）
→ 支撑：`coverage.md`（**50 条 R12** 逐条映射 + **15 个缺口** + **3 条跨束真冲突**）

### 签核前请重点确认

- [ ] **不变量是真的不变量吗** —— 判据「任何时刻都为真，违反即数据损坏」且**能写成断言**。
      重点看 **N-1**（浏览器可见集合 ≡ 检索可见集合，跨三束）、**N-17**（六类级联全成功才可完成）、
      **N-18**（逻辑失效 ≤300s 的硬 SLA）、**N-21**（物理删除须清版本化桶全部历史版本）。
- [ ] **失败模式穷举了吗** —— 七类（并发/越权/依赖失败/幂等重放/**部分成功**/超时/撤回中）
      在 `usecases.md` 末尾有自查表。尤其：`DELETION_PARTIAL_FAILURE`（🔴 最危险）、
      `MATERIALIZATION_SPEC_VIOLATION`（**契约违反**，与执行失败 `MATERIALIZATION_FAILED` 刻意分开）、
      `EXTRACTION_FAILED` 时**原件仍可下载**（file-first 底线：解析失败 ≠ 文件丢失）。
- [ ] **`ARTIFACT_NOT_FOUND` 的收紧你认可吗** —— phase-00 只要求「404 非 403」，
      本束 N-25 升级为**状态码/响应体/响应头逐字节相同**。任何差异都是存在性泄露。
- [ ] **10 条 [待定] 你能定几条** —— T-1 五个上限 / T-2 类型白名单（`.html`/`.svg`）/
      🔴 T-3 五个物化时限 / 🔴 T-4 能否删单个中间版本 / T-5 宽限期可否撤销 /
      🔴 T-6 观察者下载权 + 机密片段是否展示 / T-7 回执格式与签名（O-39 待外部输入）/
      T-8 撤回项→级联子集映射 / T-9 复核阈值与审核人 / T-10 导出上限与有效期。
      **T-3 定不下来，「物化是同步契约」就写不出断言，file-first 与「事后导出」的分界线失守。**
- [ ] **唯一一个可能多余的操作**：`revokeDeletion`（`coverage.md` 反向检查）。
      若裁定不提供撤销出口，须连同 `files-trash-revoke` / `files-trash-revoked` 一并删除。

---

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面**（列表/搜索/预览/下载/导出/上传/摄取/物化/版本/删除/队列/回执/留存参数）。
按 ADR-023 决策一，第 ③ 件的落点是：

```
packages/contracts/src/files.ts      ← zod 单一事实源
```

⚠ **该文件尚未创建。本轮只是骨架**——它是**签核通过后、开工时的第一件产出**，
且必须同时在 `packages/contracts/src/index.ts` 导出、由它生成前端 mock
（**mock 不许手写**：本仓已五次因「同一事实两处声明」而漂移，手写 mock 是第六次）。

### 签核前请重点确认

- [ ] 🔴 **`workshop` 和 `canvas` 要不要进契约？** —— 这是本节**最必须当场回答的一个问题**。
      磁盘上现存**两份**来源类型定义，**不是同一份的两种写法**：
      `packages/contracts/src/artifact.ts` 的 `ArtifactSource` 是 **7 值**；
      `apps/web/lib/mock/files.ts` 的 `SourceType` 与四份 UC 是 **8 值**。
      **3 对同义异名**（`file↔upload` / `research↔research-run` / `generated↔ai-generated`）、
      **2 个契约缺失值**（`workshop`、`canvas` —— 而**已建成界面已经把它们当一等来源画进左树**，
      UC-22.3 也逐行给了它们的固定文件清单）、**1 个反向孤儿**（契约的 `prototype-run` 在八类里没位置）。
      逐值对照表见 `domain.md` 第二·五节（T-11）。裁决须回答三件事：
      **① 哪套词表是权威 ② `workshop`/`canvas` 进不进（不进则归并到哪、左树怎么改）③ `prototype-run` 归到哪**。
      🔴 **在这三条定下来之前，不要创建 `files.ts` 的 `sourceType` 枚举——那会是第三份副本。**
      ⚠ 同形状的第二处：mock 的 `IngestState` 也是摄取九态的本地副本，**今天值恰好一致，改一处即漂**，
      建议同一次动作一并收敛。
- [ ] **本束新增的 18 个错误码你认可吗** —— 尤其携带**当前值与上限值**的四个
      （`FILE_TOO_LARGE` / `BATCH_LIMIT_EXCEEDED` / `ARCHIVE_BOMB_DETECTED` / `EXPORT_LIMIT_EXCEEDED`）：
      契约要求错误体**必须同时给两个数**，否则用户只知道「失败了」不知道「差多少」。
- [ ] **`queryProvenance` 本束刻意不定义**，复用 phase-00 artifact 束（缺口 1）。
      请确认这是对的——本束的四类审计事件（上传/下载/导出/删除）写同一张表，
      **再造一个查询面就是第七次同一事实多处声明**。
- [ ] **F47 的两个出站桩**（`ontology_edges` 失效、报告段落标失效）形状你认可吗？
      ⚠ 第二个与 phase-00 的 `markEvidenceWithdrawn` **形状高度相似，极可能是同一个操作**（C-3）。

---

## 覆盖 feature 一览

> ⚠ **派生视图，不是权威。** 权威是本文件 frontmatter 的 `covers:`（ADR-023 决策三）。

| feature | 一句话 | 点 | 主要依据 |
|---|---|---:|---|
| F31 | 列表 API + RLS 过滤（可见集合≡检索可见集合）+ 树/列表双视图 + 行元数据 | 5 | uc-22-1 R3 |
| F32 | 五类预览器 + 单个下载（短时效一次性、写审计） | 3 | uc-22-1 R9 |
| F33 | 批量 zip 导出 round-trip + manifest + FTS 搜索与六项筛选 | 3 | uc-22-1 R7 |
| F34 | 空态/依赖失败/无权限/完整性失败 + 契约态（改名重定向） | 2 | uc-22-1 R4 |
| F35 | 上传接口 + 服务端校验 + 三项安全检查 + 对象存储写入 | 4 | uc-22-2 R3 |
| F36 | 摄取九态（每态可见态与出口）+ outbox+worker + 重放 | 3 | uc-22-2 R8 |
| F37 | 幂等键去重 + 四类 adapter + Segment 与 anchor | 3 | uc-22-2 R7 |
| F38 | 🔴 prompt injection 防线（红队用例，通过率 100%） | 1 | uc-22-2 R7 |
| F39 | `REVIEW_PENDING` 人工复核 + AI 补齐缺料 + 失败出口 | 2 | uc-22-2 R4 |
| F40 | 物化事件总线 + 去抖 + 持久队列（复用摄取链路） | 2 | uc-22-3 R4 |
| F41 | 七类来源物化为文件（固定文件清单契约） | 5 | uc-22-3 R3 |
| F42 | `synthesized` 与 `evidencePolicy` 服务端强制 | 3 | uc-22-3 R7 |
| F43 | 零个业务对象缺文件 + 物化失败可见 + 溯源完整拒 READY | 3 | uc-22-3 R7 |
| F44 | 版本列表（永不覆盖、每版 SHA-256）+ 派生物模型 | 2 | uc-22-4 R3 |
| F45 | 删除影响面 + 二次确认 + **六类级联** + 两级 SLA | 4 | uc-22-4 R7 |
| F46 | 待删除队列 + legal hold + 留存参数 + 物理删除与回执 | 2 | uc-22-4 R10 |
| F47 | 契约先行桩：`ontology_edges` 失效 + 报告段落标失效 | 1 | uc-22-4 R10 |
| | | **48** | |

⚠ **估点重复计入风险**（00-index 七·1）：D-13 已把 UC-17.2 最小切片（+8 点）前置进 phase-1，
它与 F45/F46 **在实现上是同一批工作**（同一套待删除队列、同一套级联失效）。
两处须核对，**不要重复计入 phase-1 总点数**。

---

## 对 phase-00 `artifact` 束三个缺口的交代

| phase-00 缺口 | 原文说法 | 本轮的处置 |
|---|---|---|
| **④** 项目侧「已回流的产出与版本」屏 + 三模式选择器未建 | 「随 phase-01 承载它的 Studio 底栏交付」 | **未消除**。本束的 `files-version-drawer` 只承载**版本线**（版本号/时间/创建者/SHA-256/独立下载），**不承载三模式绑定视图**（mode/version/pinnedBy/pinnedAt）。那属 artifact 束与 Studio 底栏，不在本束。⚠ 请勿把本束的版本抽屉误当成缺口④已补 |
| **⑥** 快照不可删 vs 合规撤回删除 | 「契约桩在 phase-01 先行」 | ✅ **本轮交付**。`domain.md` **N-22**：被删对象的固定快照**仍存在**，其引用项标「证据已撤回」——不是静默 404、不是空白。即「默认不可删 + 唯一合规豁口」的具体形态，配合 N-16（浏览器与 download 真消失）与 N-19（不出虚假回执）。见 `coverage.md` C-2 |
| **⑦** `REVIEW_PENDING` 触发判据未定 | 「先做结构性断言，阈值后填」 | ✅ **结构性部分交付**：机密标记 ∨ PII 五类（O-39）∨ 解析质量低 ⇒ **必入 `REVIEW_PENDING`，不得静默入库**（`usecases.md` `resolveReviewPending`）。⚠ **阈值数值与审核人角色仍缺**（T-9） |

---

## 本束与哪些束有交叉约束（留给阶段一致性复核）

### 三条**跨束真冲突**（不是缺口——两处已经写得不一样）

| # | 冲突 | 必须裁定什么 |
|---|---|---|
| 🔴 **C-1** | **`sourceType` 枚举两份定义**：phase-00 artifact 束 **7 值**（`survey/conversation/interview/prototype-run/research-run/upload/ai-generated`）vs 本束 **8 值**（`file/survey/interview/workshop/research/conversation/canvas/generated`）。命名对不上（`upload`↔`file`、`ai-generated`↔`generated`、`research-run`↔`research`），**基数也不同**（phase-01 多 `workshop`/`canvas`，phase-00 多 `prototype-run`） | 收敛为**一份**封闭枚举，裁定 `prototype-run` 归属。**在此之前不要写 `files.ts` 的枚举** |
| **C-2** | phase-00 I-11「固定快照不可删」vs 本束 N-16「删除后全部版本 404」 | 不是矛盾，是「默认不可删 + 唯一合规豁口」。N-22 已给形态，**请人类确认该边界** |
| **C-3** | F47 的「报告段落标失效」桩 vs phase-00 的 `markEvidenceWithdrawn` | 极可能是**同一个操作**。若相同则本束不新造 |

### 跨束不变量（不能本束单独实现）

- 🔗 **N-1** 浏览器可见集合 ≡ 检索可见集合（同 principal 同时刻）—— 跨 **files + identity + context-pack**。
  这是 phase-00 缺口② / identity 束缺口② 那条 UC-0.3 R7 第一次有了**可执行的双向断言**。
- 🔗 **N-13** `evidencePolicy=primary-only` 服务端强制 —— `synthesized` 的**产生**在本束，**过滤**在 context-pack。
  两侧不得各写一份策略（D-25 的两端）。
- 🔗 **N-14** 物化产物可见性取全部来源的最严结果、fail-closed —— phase-00 🔗I-13 的物化侧具体化。

### 其它交叉面

| 对方 | 内容 | 方向 |
|---|---|---|
| phase-00 `artifact` | 原件/版本/SHA-256/摄取九态/快照三模式；`queryProvenance` 统一查询面（缺口 1，**已复发三次**） | 强依赖 |
| phase-00 `identity` | 两层角色 + `acl_bindings` + RLS。**本束不自定义任何权限语义**；🔴 合规负责人缺位（S-02，动摇 O-03） | 强依赖 |
| phase-00 `context-pack` | 级联失效第 ⑥ 类（缓存与已构建 pack）；`evidencePolicy` 判定面；「打开原始引用」落点 | 双向 |
| phase-01 `08-chat` | **「会话结束」的定义**决定 `messages.jsonl` 的文件粒度（N-11）——**[待定]**，由 08-chat 给 | 上游 |
| phase-01 `12-survey` / `06-itv` / `05-rec` / `07-canvas` | 物化的数据来源。🔴 **不得自建入库路径**，必须复用本束摄取链路，否则幂等键与权限传播会有多套实现 | 上游 |
| phase-01 `17-gov` | O-01 留存五参数**单点配置**（缺口 14）；五步撤回与两级 SLA（D-15，S-05 有两个推断 SLA）；审计四类事件；机密标记归属 | 双向 |
| phase-01 `04-agent` | 🔴 prompt injection 的另一半：agent 不把文档内容当指令（缺口 3）。红队样本集须**跨束共用一份** | 下游 |
| phase-01 `20-model` / `21-mcp` | 机密标记（O-17 材料级）驱动模型路由；开关 3「机密仅本地模型」不允许关闭（O-19） | 下游 |
| phase-02 `09-kg` / `10-report` / `13-deliv` | 级联失效第 ⑤ 类与报告段落标失效 —— F47 契约先行桩。**任一模块不提供失效接口，AC2 就无法达成** | 下游 |
| **部署形态**（无归属） | 🔴 缺口 11：N-21（物理删除清版本化桶全部历史版本）与 phase-00 I-2（object-lock 写一次）**不能在同一个桶上同时成立**。须裁定分桶策略并写进 `architecture.md` | **契约管不到** |

---

## 确认动作

人类核对上面三节后，把本文件 frontmatter 的 `status` 改为 `confirmed`，
填 `confirmed_by` 与 `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的**（ADR-023 决策五：`design-signoff.md` 受 CODEOWNERS 与 CI 保护）。
⚠ 本束可开工 ⟺ **本文件 `status: confirmed`** ∧ **phase-01 的一致性复核已通过且其
`covers_bundles:` 包含 `files`**（ADR-023 决策四）。两条缺一，`new-sprint` 与 `claim` 都应拒绝。
