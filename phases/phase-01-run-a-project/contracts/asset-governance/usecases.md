# 契约束 `asset-governance` — 签核②：用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 覆盖 feature 与依据 UC 见 `design-signoff.md`（权威）。
>
> ⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
> 本束的原型材料**极度偏向 happy path**：六道关的截图里没有一关是失败态，
> 试跑台的自动校验四条全 PASS，第 3 步的三项治理配置全都已填。
> **八份 UC 里的 60 余条异常流程（E1…En × 8）在原型上一条都没有。别继承这个缺陷。**
>
> ⚠ **本文的端口数量刻意保守。** `OPEN-QUESTIONS.md` 的 **Q-0 未裁**，
> 本束是否整体进 phase-1 都还没定。**在裁决前把端口写满，是把未定的范围伪装成已定。**
> 因此本文只写「无论 Q-0 怎么裁都需要的端口」＋ 明确标出「随裁决结果增删的端口」。

---

## 零、统一失败枚举 `AssetGovernanceError`

前端据此渲染七态之一（D-36）。
⚠ **凡是已签核束已有的错误码，本束一律复用、不新建**——这是第一批要被审的地方。

### 复用（**不新建**）

| 码 | 来自 | 本束什么时候用 |
|---|---|---|
| `GATE_NOT_PASSED` | `skills`（已签核） | 六道关有阻断却调发布（I-5） |
| `SELF_REVIEW_FORBIDDEN` | `skills` | 提交人 ＝ 六道关的裁决人 |
| `NO_SECOND_REVIEWER` | `skills` | 组织内无第二名审核人（组织配置问题，与上一条区分） |
| `REVIEWER_FUNCTION_MISMATCH` | `skills` | 方法论审核人裁 02/03 关，或安全评审人裁 04 关 |
| `SECURITY_SCAN_REJECTED` | `skills` | 02 关判 `reject` |
| `CONTRACT_VALIDATION_FAILED` | `skills` | 编辑器保存时 frontmatter 不可解析/必填缺 |
| `DATA_SCOPE_EXCEEDS_SUBMITTER` | `skills` | 03 关权限越界的一个具名情形 |

### 本束新增（每一条都附「为什么不能用既有码」）

| 码 | 场景 | 前端应显示 | 为什么必须新增 |
|---|---|---|---|
| `ASSET_TYPE_UNRECOGNIZED` | 上传材料既非 `SKILL.md`/`OpenAPI`/`mcp.json`/`.wsxtpl` 也非可拉取仓库 | 「识别不出这是什么」+ 手动指定类型出口 | 既有码都假设已知类型；**不猜**是这里的规则 |
| `ASSET_TYPE_MISMATCH` | 识别出的类型 ≠ 进入向导时选的类型 | 显式提示 + 用户裁决 | **不得静默改道**——静默改道会让第 3 步的权限继承落错资产类型 |
| `GOVERNANCE_INCOMPLETE` | 三项治理配置＋周期未齐（I-10） | 逐项指出缺哪个 | 与 `GATE_NOT_PASSED` 是**两条独立的发布禁用条件**（原型明写两句话） |
| `PREFLIGHT_HAS_BLOCKING_ITEM` | 发布前检查存在红色未完成项 | 该项内容 + `[去处理]` | 同上，**第三条独立禁用条件** |
| `ROOT_FILE_UNDELETABLE` | 删 `SKILL.md` / `AGENT.md`（I-7） | 根文件不可删除 | 目录形态特有 |
| `SOURCE_CREDENTIAL_EXPIRED` | 源凭据过期（原型实存：Codex 社区） | 失败原因 + `[修复]` | 与 `SOURCE_UNREACHABLE` **必须区分**：凭据能修，源没了不能 |
| `SOURCE_UNREACHABLE` | 源不可达 / 上游 404 / 超时 | 保留上次清单 + 显式报错 | 同上 |
| `SOURCE_KIND_VIOLATION` | 同步返回的条目类型 ∉ 源的 `providesKinds`（I-17） | 拒收该条目并留痕 | 否则 MCP Registry 能塞进来一个 skill |
| `DEDUP_CONFLICT_UNRESOLVED` | 04 关阻断未裁决 | 并排对照 + 三个出口 | 阻断的**具名子类**，因界面完全不同故单列 |
| `ASSET_NOT_EDITABLE` | 调用方不在 `editableBy` 集合内 | 只读态（无 `[保存]`） | 与「不可见」不同：这是可见但不可改 |
| `ASSET_DOWNGRADED_OWNER_MISSING` | 降级终态但 `ownerId` 已停用 | 无主资产提示 + 接管入口 | ⚠ **`uc-23-6` E1 的洞**；`[待确认]` 兜底接管人 |

⚠ **`ASSET_NOT_FOUND` 不新增**：不可见资产一律走 `skills` I-14 既有的「404 非 403」形状，
判定函数归 phase-00 `identity`（I-26）。

---

## 一、无论 Q-0 怎么裁都需要的端口（**可先做**）

> 判据：这些端口**不涉及**外部导入、不涉及沙箱执行、不涉及多文件包解析
> ——即 D-06 逐字排除的三件之外。`OPEN-QUESTIONS.md` Q-0 的推荐方案 C 保留的就是这一组。

### `ListAdminNav` —— 后台左栏 IA（`uc-23-8`）

```
ListAdminNav() -> {
  org: { name, orgId, quotaPct, quotaUsedWan, quotaTotalWan, daysLeft },
  groups: [ { group, items: [ { key, label, href, count?: int | "—", statusDot?: bool } ] } ]
}
```
- **不变量**：返回的资产项集合 **＝** `AssetKind` 六值（I-2，**双向**）。
- `count` 为 `"—"` 表示取不到（I-24），**不得返回 0 代替**。
- 失败：某类计数查询失败 ⇒ 该项 `count = "—"`，**其余项照常返回**（不整体失败）。
- ⚠ 分组与顺序**待 Q-11**；本端口的形状不依赖裁决结果，故可先定。

### `GetAssetGovernance` / `SetAssetGovernance` —— 三项治理配置（`uc-23-4`）

```
GetAssetGovernance(assetKind, assetId) -> AssetGovernance | null
SetAssetGovernance(assetKind, assetId, {
  visibility: 指定团队 | 全组织 | 仅自己-私有草稿,
  teamIds?: TeamId[],           // visibility = 指定团队 时必填非空
  editableBy: (RoleRef | UserId)[],
  ownerId: UserId,
  reviewCycle: 6m | 12m | 24m,
}) -> AssetGovernance
```
- **不变量**：对六个 `AssetKind` **逐一**成立，且字段与取值集合**完全相同**（I-10 / I-11）。
  ⚠ **精确范围待 Q-1b**：代码侧现状是 3/6（MCP 走 `McpAuthScope`，模型与蓝本无字段）。
  **本端口按「六类统一」定义，但它是否能落地取决于 Q-1b 的裁决。**
- 失败：`GOVERNANCE_INCOMPLETE`（任一字段缺）· `visibility = 全组织` ⇒ 触发领域负责人联签
  （⚠ 联签流程 `[待确认]`，本端口只返回「需联签」这一态，**不发明审批流**）。
- ⚠ `负责人 ∈ editableBy` 是否为不变量 → **Q-9**。**本端口不擅自强制。**

### `RunPreflightChecks` —— 发布前检查（`uc-23-4`）

```
RunPreflightChecks(assetKind, assetId) -> {
  items: [ { label, detail, passed, blocking, sourceRef } ],
  blockingCount: int,
}
```
- **不变量**：每一条都带 `sourceRef`，可追回它的来源（I-22）——
  清单是**派生视图**，不是手写的固定清单。
- ⚠ 清单内容**按资产类型可变**（原型的「四栏配置完整」是 Agent 专属）→ Q-1b。

### `PublishAsset` —— 发布（`uc-23-4`）

```
PublishAsset(assetKind, assetId, mode: direct | staged) -> { publishedAt, publishedBy, reviewDueAt }
```
- **不变量**：`reviewDueAt = publishedAt + reviewCycle`。
- **三条独立的禁用条件**（缺一条就漏一条路径）：
  `GATE_NOT_PASSED`（I-5）· `GOVERNANCE_INCOMPLETE`（I-10）· `PREFLIGHT_HAS_BLOCKING_ITEM`。
- 发布必须写审计（谁 / 什么资产 / 什么可见范围 / 什么时间）。
- ⚠ `mode = staged`（灰度）的**语义待 Q-3**。
  **本端口保留参数但不定义行为**——定义它就是替人类裁 Q-3。

### `ReviewClock` 相关（`uc-23-6`）

```
ScanReviewClocks(now) -> { transitionedToPending: AssetRef[], downgraded: AssetRef[] }
ReviewAsset(assetKind, assetId, { conclusion, by, at }) -> ReviewClock
GetReviewClock(assetKind, assetId) -> ReviewClock
```
- **不变量**：`ScanReviewClocks` 是**主动扫描**（I-15）。
  ⚠ 惰性判定会让「30 天无人复核」对**无人调用的资产永不触发**，而那正是最该降级的。
  故本端口是 `Scan…`（主动）而非 `EvaluateOnRead…`（惰性）——**这个命名本身是契约**。
- 降级必须走与 `SetAssetGovernance` **相同的可见性写入路径**（I-14），不得有第二条后门。
- 「最近一次扫描时间」必须可观测（扫描停摆时该指标变旧，而不是静默）。
- 失败：`ASSET_DOWNGRADED_OWNER_MISSING`（`uc-23-6` E1）。
- ⚠ **`ReviewAsset` 的 `conclusion` 取值集合无依据**（`uc-23-6` R7 规则 8 是本束最大空白：
  「复核」这个动作具体做什么，原型 0 命中）。**本端口不发明取值集合。**
- ⚠ **计时规则的定义处待 Q-7**——本端口只是它的**消费面**，
  三档周期与 30 天的语义**不在本文定义**（I-27）。

### `AssetDirectory` 相关（`uc-23-3`）

```
GetAssetDirectory(assetKind, assetId) -> { rootFile, tree: TreeNode[], files: AssetFile[] }
ReadAssetFile(assetKind, assetId, path) -> { path, sizeBytes, body, badge }
WriteAssetFile(assetKind, assetId, path, body) -> { sizeBytes, dirty: true }
CreateAssetFile / RenameAssetFile / DeleteAssetFile(...)
```
- **不变量**：`DeleteAssetFile(rootFile)` ⇒ `ROOT_FILE_UNDELETABLE`（I-7）。
- **不变量**：发布后运行时装载的文件集合 ＝ 本端口返回的集合（I-6，**双向相等**）。
- `badge` 由扩展名派生，未知扩展名 ⇒ `MD`（**fallback 不报错**）。
- 失败：`ASSET_NOT_EDITABLE`（不在 `editableBy` 内 ⇒ 只读，**无写端口**）·
  `CONTRACT_VALIDATION_FAILED`（frontmatter 坏了，**不入库**）。
- ⚠ **`WriteAssetFile` 是否触发 02 关重扫** → **I-25，依赖人类确认**。
  不做这条，六道关**在导入之后即可绕过**（在编辑器里加一段提示注入就行）。
  **本端口现在没有这个副作用，这是一个已知的洞，不是遗漏。**
- ⚠ **并发编辑**（两人同改）`[待确认]`——**本端口不擅自选「后写覆盖」**。
  这是一个会静默丢数据的默认值，不该由实现者定。

---

## 二、依赖 Q-0 裁决的端口（**裁决前不得实现**）

> 下面每一个端口都落在 D-06 逐字排除的范围内。
> **列出来是为了让「推迟掉的是什么」可见，不是为了让它看起来已经定了。**

| 端口 | UC | 被 D-06 排除的部分 |
|---|---|---|
| `CreateDraftFromSource(provenance, payload)` | `uc-23-1` | `provenance = community-import` 时的**仓库导入 / .zip 上传 / 外部社区导入** |
| `DetectAssetKind(payload)` | `uc-23-1` | 多文件包解析 |
| `RunLandingChecks(draftId)` 01–04、06 关 | `uc-23-2` | 只在外来资产上有意义 |
| `RunLandingChecks` **第 05 关** | `uc-23-2` | **沙箱试跑 —— D-06 逐字「phase-1 不做沙箱、不执行任意代码」** |
| `ResolveDedupConflict(draftId, resolution)` | `uc-23-2` | 同上 |
| `DisposeHint(draftId, gate, disposition)` | `uc-23-2` | 同上 |
| `RunTrial(assetKind, assetId, scenario, inputs, params)` | `uc-23-5` | **执行 —— 同 D-06** |
| `SaveRegressionCase` / `RunAllRegressionCases` | `uc-23-5` | 同上 |
| `ListMarketSources` / `AddMarketSource` / `SyncMarketSource` / `RepairMarketSourceCredential` | `uc-23-7` | 外部社区源整体 |
| `DetectUsageCrystallizationCandidates()` | `uc-23-1` A3 | ⚠ **它不涉外部源也不涉沙箱**，Q-0 方案 C 下它的去向需一条子裁决 |

⚠ **`RunAllRegressionCases` 的返回形状特别注意**：回归用例存在 `evals/regression.jsonl`
（**资产目录里的一个文件**，I-19），所以这个端口的输入来自 `GetAssetDirectory`，
**不是另一张回归用例表**。写成表就是第九次「同一事实两处」。

---

## 三、明确**不在本束**的端口（防重叠，逐条点名）

> 归属判据见 `domain.md` 第零节。下面这些端口若在本束出现，就是与已签核束重叠 ⇒ ADR-023 要红。

| 端口 | 归属束（**均已签核**） |
|---|---|
| MCP 的 `AuthorizeToolIndividually` / `EnterIsolationPeriod` / 副作用工具授权上限 | `agent-runtime` **F52 / F53 / F54** |
| Agent 的四栏配置、工具白名单、越权拦截、模型路由与三级降级阈值 | `agent-runtime` |
| Skill 的三段契约校验、四态迁移、双门禁、版本发布、满意度聚合 | `skills` |
| 画布模板的分区结构与围栏语法 | `canvas` |
| 蓝本的 16 项配置、套用、提回 | `templates` |
| 可见性判定函数本体 | phase-00 `identity`（X-1） |
| 组织大脑知识条目的到期规则本体 | `14-brain`（phase-3） |
| 数据总览的指标 / 异常 / 活动流 | `17-gov`（**phase-3**，见 X-I / Q-12） |

⚠ **本束调用它们，不实现它们。** `I-29` 断言的正是这一条：
本束代码与文档中 F52–F54 三条规则的**定义处 0 命中**（只允许引用）。

---

## 四、这份契约现在**不够**的地方（如实登记，不掩饰）

签核时请把下面几条一起裁，不要只看上面写了什么：

1. **端口是保守的，因为范围未定**。Q-0 未裁 ⇒ 第二节那 10 个端口是否存在都不确定。
   把它们写成完整签名会制造「设计已定」的假象。
2. **`ReviewAsset.conclusion` 的取值集合空缺**（`uc-23-6` R7 规则 8）。
   没有它，复核只是一个「点一下就重置计时」的按钮，那这条规则的价值接近零。
   **这是本束最大的单点空白。**
3. **60 余条异常流程只有一部分落成了错误码**。原型全是 happy path，
   剩下的靠 UC 的 R4 逐条兜。签核时请对着八份 UC 的 R4 核，不要只核本文的错误码表。
4. **`AssetDirectory` 只对 2/6 类资产有依据**（skill / agent）。
   另外四类是不是目录形态，`[待确认]`。所以 `uc-23-3` 那一组端口的**适用范围本身是未知的**。
5. **并发编辑无契约**（`uc-23-3` E5）。留空是刻意的——默认「后写覆盖」会静默丢数据。
6. **I-25（保存后重扫安全）尚未成为端口的副作用**。这是一个**已知可绕过的洞**，
   不是遗漏。它需要人类确认后才写进契约。
