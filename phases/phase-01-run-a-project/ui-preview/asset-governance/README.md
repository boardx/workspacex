# asset-governance · UI 先行原型（phase-01 第 11 个契约束）

> 外来资产的**导入与生命周期治理**。这是一整块新东西：`六道关` / `查重` / `灰度发布` /
> `复核周期降级` / `文件树编辑器` / `试跑台` 在现有 `feature_list.json` 与原型代码里
> **全部 0 命中**（除了运行态 HTML 的两个 JS 数据区）。
>
> 路由：`/asset-governance`（顶层，并行安全）。组件：`apps/web/components/asset-governance/`，
> mock：`apps/web/lib/mock/asset-governance.ts`。视角/状态：`?as=` / `?screen=` / `?state=`（仅开发可达）。
>
> ⚠ 本 README 是**截图索引**，供另一个 agent 在 `contracts/asset-governance/ui.md` 里引用。
> 我不写那份 ui.md。截图目录已在 `.harness/scripts/ui-material-map.json` 声明为
> `asset-governance → ui-preview/asset-governance`。
>
> 本文件引用 **64** 张截图，目录实际 **64** 张。

## 数据从哪来（都不是我编的）

人类给了 9 张截图（转录见任务书），我又去运行态原型
`WorkspaceX Standalone.html` 的 JS 数据区**逐字挖**，补全了截图里没有的部分：

- 六种资产枚举、后台九项计数：`AN_META` / `AD_META`（16.65M）
- 六道关 / 查重分歧 / 改写对照 / 治理与发布 / 发布前检查 / 灰度发布：16.60–17.05M
- 文件树（Skill / Agent 目录与正文）：`SK_FILES` / `AG_FILES`（16.66M）
- 试跑台（场景 / 轨迹 / 输出 / 自动校验）：**15.70M**（另一个区，左栏点不到）
- 蓝本库 5 张卡片 + 组织额度：15.66M / 15.83M

---

## 一、截图 → 屏 → UC 映射

八块屏 × 七态（default / loading / empty / invalid / dep-failed / denied / success）= 56 张，
外加两块最能体现角色差异的屏各 4 个视角对照 = 8 张。共 64 张。
`admin` 视角即各屏的 `-default`（后台默认视角），不再单列。

| 屏 | 编号 | 数据来源（原型 JS 区） | 七态截图前缀 |
|---|---|---|---|
| 后台外壳 · 六资产 IA + 数据总览 | ⑦ | `AD_META` / 组织额度 15.66M | `uc-ag-dashboard-<state>.png` |
| 项目蓝本列表 | ⑧ | 蓝本库 15.83M | `uc-ag-blueprint-<state>.png` |
| 新建 Skill · 三条路径 + 市场三源卡片 | ① | 新建 Skill 页 15.72M | `uc-ag-newskill-<state>.png` |
| 导入向导 · 第 2 步「落地检查六道关」 | ② | 六道关 16.65M | `uc-ag-gates-<state>.png` |
| 导入向导 · 第 3 步「治理与发布」 | ③ | 治理与发布 16.71M | `uc-ag-governance-<state>.png` |
| Skill 编辑器 · 文件树 + 编辑器 | ④ | `SK_FILES` 16.66M | `uc-ag-skill-editor-<state>.png` |
| Agent 编辑器（同构） | ⑤ | `AG_FILES` 16.66M | `uc-ag-agent-editor-<state>.png` |
| 试跑台 | ⑥ | 试跑台 15.70M | `uc-ag-tryrun-<state>.png` |

### 视角对照（8 张）

| 屏 | 视角 | 截图 |
|---|---|---|
| dashboard | 能力维护者 | `uc-ag-dashboard-view-maintainer.png` |
| dashboard | 方法论审核人 | `uc-ag-dashboard-view-reviewer.png` |
| dashboard | 领域负责人 | `uc-ag-dashboard-view-owner.png` |
| dashboard | 普通成员（后台投影不可见）| `uc-ag-dashboard-view-member.png` |
| governance | 能力维护者 | `uc-ag-governance-view-maintainer.png` |
| governance | 方法论审核人 | `uc-ag-governance-view-reviewer.png` |
| governance | 领域负责人 | `uc-ag-governance-view-owner.png` |
| governance | 普通成员（后台投影不可见）| `uc-ag-governance-view-member.png` |

### 全部 64 张（供 ui.md 逐张引用）

**dashboard**：`uc-ag-dashboard-default.png` · `uc-ag-dashboard-loading.png` · `uc-ag-dashboard-empty.png` · `uc-ag-dashboard-invalid.png` · `uc-ag-dashboard-dep-failed.png` · `uc-ag-dashboard-denied.png` · `uc-ag-dashboard-success.png` · `uc-ag-dashboard-view-maintainer.png` · `uc-ag-dashboard-view-reviewer.png` · `uc-ag-dashboard-view-owner.png` · `uc-ag-dashboard-view-member.png`

**blueprint**：`uc-ag-blueprint-default.png` · `uc-ag-blueprint-loading.png` · `uc-ag-blueprint-empty.png` · `uc-ag-blueprint-invalid.png` · `uc-ag-blueprint-dep-failed.png` · `uc-ag-blueprint-denied.png` · `uc-ag-blueprint-success.png`

**newskill**：`uc-ag-newskill-default.png` · `uc-ag-newskill-loading.png` · `uc-ag-newskill-empty.png` · `uc-ag-newskill-invalid.png` · `uc-ag-newskill-dep-failed.png` · `uc-ag-newskill-denied.png` · `uc-ag-newskill-success.png`

**gates**：`uc-ag-gates-default.png` · `uc-ag-gates-loading.png` · `uc-ag-gates-empty.png` · `uc-ag-gates-invalid.png` · `uc-ag-gates-dep-failed.png` · `uc-ag-gates-denied.png` · `uc-ag-gates-success.png`

**governance**：`uc-ag-governance-default.png` · `uc-ag-governance-loading.png` · `uc-ag-governance-empty.png` · `uc-ag-governance-invalid.png` · `uc-ag-governance-dep-failed.png` · `uc-ag-governance-denied.png` · `uc-ag-governance-success.png` · `uc-ag-governance-view-maintainer.png` · `uc-ag-governance-view-reviewer.png` · `uc-ag-governance-view-owner.png` · `uc-ag-governance-view-member.png`

**skill-editor**：`uc-ag-skill-editor-default.png` · `uc-ag-skill-editor-loading.png` · `uc-ag-skill-editor-empty.png` · `uc-ag-skill-editor-invalid.png` · `uc-ag-skill-editor-dep-failed.png` · `uc-ag-skill-editor-denied.png` · `uc-ag-skill-editor-success.png`

**agent-editor**：`uc-ag-agent-editor-default.png` · `uc-ag-agent-editor-loading.png` · `uc-ag-agent-editor-empty.png` · `uc-ag-agent-editor-invalid.png` · `uc-ag-agent-editor-dep-failed.png` · `uc-ag-agent-editor-denied.png` · `uc-ag-agent-editor-success.png`

**tryrun**：`uc-ag-tryrun-default.png` · `uc-ag-tryrun-loading.png` · `uc-ag-tryrun-empty.png` · `uc-ag-tryrun-invalid.png` · `uc-ag-tryrun-dep-failed.png` · `uc-ag-tryrun-denied.png` · `uc-ag-tryrun-success.png`

---

## 二、界面上无法自洽的点（原型自身的矛盾，我如实保留、没有抹平）

1. **市场源两个面数据打架**。
   - 「新建 Skill」页三源卡片（人类截图）：`Codex 社区 903 个 · 已同步 12`。
   - 后台 Skill 导入「添加源」表（原型 16.6M）：`Codex 社区 · Skill · 903 · 失败 · 凭据过期 · 修复`。
   同一个源，一处说「已同步 12」，一处说「凭据过期同步失败」。两面我都留了
   （mock 里 `AG_MARKET_CARDS` 与 `AG_MARKET_SOURCES`），**没有强行取一个**。sign-off 时需裁决哪面为准。
2. **蓝本计数 5 ≠ 渲染 5、页头写 7**。页头「7 个蓝本 · 5 已发布 · 2 草稿」，chips「已发布 5 / 草稿 2」=7，
   但原型运行态只渲染出 5 张卡片（4 已发布 + 1 草稿）。差的 2 张原型没画。我只放 5 张**真实**卡片，
   **不发明**另外 2 张，在此标注这处不一致。
3. **`open claw` 查无此源**。人类口头提到 open claw，原型 JS 数据区 **0 命中**。我没有发明它，
   放进 `AG_MARKET_UNCONFIRMED` 标 `[待确认]`，界面上明写「原型运行态里没有，等确认」。
   查到了它长什么样，落地时补进 `AG_MARKET_SOURCES`。
4. **AD_META 副标题 vs chips 又不一致**：AD_META 蓝本副标题写「5 已发布 · 1 草稿」，
   而列表 chips 写「已发布 5 / 草稿 2」。我取 chips（更细）。

---

## 三、我替 UC / 人类做的设计判断（sign-off 请逐条看）

1. **「六种资产」= Agent / Skill / 模型 / MCP 服务器 / 画布模板 / 项目蓝本**。
   截图只说「六种资产完全一样」没列举；我在原型 `AN_META` 里挖到这六个键（证据在
   `lib/mock/asset-governance.ts` 顶部注释）。后经人类第三张截图确认，一致。
2. **后台左栏 IA 分三组**：数据总览 / AI 能力（六资产）/ 组织（成员与配额、反馈与迭代）。
   顺序按人类截图（Agent → Skill → 模型 → MCP → 画布模板 → 项目蓝本）。
3. **视角模型**：本域 R5 我定为五种——组织管理员 / 能力维护者 / 方法论审核人 / 领域负责人 / 普通成员。
   前四是**组织级职能**（在后台）；**普通成员对整个后台投影为不可见**（`ag-role-denied`，
   与七态 `denied` 区分）。UC 没写全角色清单，这是我按「导入需维护者提交、审核人批准、
   全组织需负责人联签」推出来的。
4. **七态是我加的，不是原型的**。原型是 happy path、零异常态。八屏一律经共享 `StateShell`
   渲染七态，并给了各屏**具体**的 empty / invalid / dep-failed 文案（例：gates 的 dep-failed =
   「沙箱试跑依赖的评测服务不可用——第 05 关无法完成」）。这些异常文案 UC 全没写，是我补的。
5. **危险动作二次确认**（R8）：删除蓝本 / 放弃导入 / 灰度发布 / 保存并发布 都做成
   「点一下展开影响范围说明 + 二次确认」，不是孤零零红按钮。影响范围文案（例：删除蓝本
   「已开过的项目锁在自己的版本上、不受影响」）是我按治理语义补写的。
6. **进度条颜色阈值**：16/16 绿、15/16 与 12/16 橙、9/16 红——原型给了颜色但没给规则，
   我归纳为 `100%→success / ≥10 环节→warning / <10→danger`，集中在
   `blueprintProgressTone()` 一处，不散落。
7. **编辑器「非根文件」占位**：原型只逐字给了 SKILL.md / AGENT.md 的完整正文，其余文件
   （references/ scripts/ prompts/ tools/ evals/）只有文件名与大小。我让文件树可点、根文件展示
   完整内容，其余文件以显式占位呈现——**不编造**它们的正文。
8. **产品定值单点声明**：30 天降级、6/12/24 月复核、5 人灰度、一周试用、68% 查重、16 环节——
   都是**原型给定的产品值**（不是待定阈值），集中在 `AG_PRODUCT_VALUES`，每条带 `source`。

---

## 四、（略）

## 五、我明确**没做**的部分（边界，避免与已签核束重叠）

- **各资产自身的领域界面不在本域**：
  - 蓝本设计器 16 面板 → `ui-preview/tpl-v2/`（另一 agent，41 张）。本域只画后台**宿主 + 列表**。
  - skill 绑定到环节 / 对话临时加减 → `ui-preview/skill-v2/`。
  - agent 编排 / MCP 逐工具授权规则 → `ui-preview/agent-runtime-v2/`。
- **模型 / MCP / 画布模板的列表页**本轮**未单独画**（左栏可点、有计数，但点进去暂指向数据总览）。
  本轮聚焦人类点名的痛点（导入六道关、治理机制、文件树、试跑台、蓝本列表）。这三张列表页与
  蓝本列表同构，是明确的后续增量——不假装已完成。
- **`contracts/asset-governance/ui.md` 不是我写的**（另一个 agent 在建）。我只把截图与索引备好。
- 真实权限、真实查重算法、真实沙箱、真实灰度回退都是**后端**，本域一律不碰——界面是投影。

---

## 六、契约缺口（待迁入 `packages/contracts`）

`AssetKind`（六资产封闭枚举）/ `GateVerdict`（三级结论）/ `Visibility` / `ReviewCycle` /
`MarketSource` / 灰度发布语义（发给谁、怎么回退）——目前只在 `lib/mock/asset-governance.ts`。
该 mock 已登记进 `apps/api/tests/kernel/no-builtin-capability-lists.test.ts` 的
`DECLARED_MOCK_DEBT`（命中项：`AG_AGENT_MAIN` 的 `name: "Ava"`）。
