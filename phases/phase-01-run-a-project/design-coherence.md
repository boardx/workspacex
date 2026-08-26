---
phase: "01"
# 本次一致性复核**实际看过**哪些束（ADR-023 决策四）。
# ⚠ 门控要求：声明的束集合 ⊇ 本阶段全部束。
#   下面十个是磁盘上的全部束；**新增束必须同时加进这里并重做复核**，
#   否则新束的 feature 会靠一份从没看过它们的复核解锁开工（ADR-023 背景 1 的原样复现）。
#
# 2026-07-30 由九束改为十束：新增 `project`（项目本身，最晚被发现缺失的能力域）。
#   ⚠ 本次**只改了这一个字段**，`status` / `confirmed_by` / `confirmed_at` 一律未动，
#   第二~六节的交叉约束复核**仍未做**（本文 status 仍是 pending）。
#   ⚠ 不要把「covers_bundles 里有 project」读作「project 束已被复核」——
#   ADR-023 决策四那条门控挡的正是相反方向：只改这个字段而不做复核，
#   是把「没复核」谎报成「复核过」。`project` 束自己的 covers 为空、status 为 pending，
#   两道门都还红着，这是预期状态。
#
# 2026-07-30（同日晚些时候）由十束改为**十一束**：新增 `asset-governance`
#   （外来资产的导入与生命周期治理 + 后台外壳这一层公共宿主）。
#   起因：人类当天提出「导入市场上主流使用的 agents / skills」「项目文件的浏览和编辑」
#   「生命周期管理」，并追问「为什么在管理后台看不到项目蓝本」。
#   ⚠ 与上一次一样，本次**只改了 covers_bundles 这一个字段**，
#     `status` / `confirmed_by` / `confirmed_at` 一律未动。上面那段警告**原样适用**：
#     不要把「covers_bundles 里有 asset-governance」读作「该束已被复核」。
#   ⚠ 且本次比上一次更需要重做复核，不是沿用：
#     `asset-governance` 自己提出了 **10 条跨束交叉约束 X-A…X-J**
#     （见 contracts/asset-governance/domain.md 第三节），其中至少四条会**回头触碰
#     已签核的束**（skills 的 D-06 / fileCount / source 枚举；agent-runtime 的 McpAuthScope）。
#     第二~六节的交叉约束章节**仍然留白**，而现在它欠的东西比昨天多了 10 条。
#   ⚠ 该束自己的 covers 为空、status 为 pending，且它有一条 🔴 全束阻塞项
#     （Q-0：本域与已拍板的 D-06 正面冲突）。三道门都红着，这是预期状态。
#
# 2026-07-30（再晚些）由十一束改为**十二束**：新增 `research`（研究 Studio）。
#   起因：D-20 于 2026-07-27 已裁「研究 Studio 立项（新模块 M18，约 21 点）」，
#   三份档案一致（PENDING:337 / FINAL:97 / DELTA:301「维持 A」），而**三个 phase 都没有该模块**
#   ——`REVIEW-REQUIREMENTS.md:102` 早就标了 🔴，那条 🔴 也没触发任何动作。
#   逐条证据与本次未做的事见 `requirements/SCOPE-DELTA-2026-07-30.md`。
#   ⚠ 与前两次一样，本次**只改了 covers_bundles 这一个字段**，
#     `status` / `confirmed_by` / `confirmed_at` 一律未动。上面那段警告**原样适用**：
#     不要把「covers_bundles 里有 research」读作「该束已被复核」。
#   ⚠ 本次同样比上一次更需要重做复核：`research` 自己提出 **10 条跨束交叉约束 X-A…X-J**
#     （见 contracts/research/domain.md 第三节），其中**六条触碰已签核的束**
#     （recording / interview / files / agent-runtime / chat）。尤其两条：
#     · **X-E**：`files`（已签核）的八值来源枚举约束**逐字点名「研究 Studio 的产出侧」**
#       ——即**一个已签核束正在依赖一个当时不存在的束**，与 `project` 束当初同形。
#     · **X-D**：`interview`（已签核）的 `INSIGHT_REPORT_EXPORTS` 里已有「送入综合 Studio」，
#       而「综合 Studio」**在任何 phase 都不存在** ⇒ 已签核束里有一个通往未定义目的地的出口。
#   ⚠ 该束自己的 covers 为空、status 为 pending，且有三条阻塞（Q-2 / Q-8 未裁、feature 未生成、
#     截图目录未产出）。四道门都红着，这是预期状态。
#
# 2026-08-04 新增第十三束 `curated-capability-packs`（F149）。本次**刻意没有**把它追加到
#   covers_bundles：下面的历史 confirmed_at 是 2026-07-30，当时该束不存在，不能被解释为
#   已复核它。只改 covers_bundles 会把“没看过”谎报成“看过”。人类须先签该束，再复核本文
#   新增的 XC-31，最后亲自把该束加入 covers_bundles 并刷新确认时间。在此之前门控红是预期行为。
# 2026-08-11（下午）由十三束改为**十五束**：新增 `chat-file-upload` 与 `chat-context-engine`
#   （V9 文件上传 / V10 上下文引擎；两束 design-signoff 已由人类同日晨逐字签核）。
#   本次**不是只改字段**：交叉约束复核 XC-32…XC-37 已实际做过（coord-main 代核，
#   六条全部无冲突、不触发任何已签核束重签，全文见文末「2026-08-11 增补」一节）。
#   人类采纳裁决（逐字，2026-08-11 于「Chat UI 体验迭代」会话）：「采纳 coherence，开始建 V9-a」
#   ——本次追加即该裁决的代抄落地（#660 先例：agent 代抄 + 来源标注，人类可改）。
covers_bundles: [agent-runtime, asset-governance, canvas, chat, files, interview, org-admin, project, recording, research, skills, templates, curated-capability-packs, chat-file-upload, chat-context-engine, personal-realtime-transcription]
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:   qq13613030605            # 确认人（姓名/邮箱）
confirmed_at:  2026-08-11T23:00:24+08:00          # ISO 8601，且不得晚于签核当下
---

# phase-01 阶段一致性复核（ADR-020 第二级门 / ADR-023 决策四）

> ~~**本文现在是骨架，不是结论。** 2026-07-30 与九个契约束的骨架同时建立。
> 正文的「交叉约束」章节**留白待填**~~
> —— **2026-07-31：第二~六节已填**，共 **31 条**跨束交叉约束（`XC-00` … `XC-30`），
> 每条含证据（文件:行）、两个方向的核对、候选处置、推荐与**人类打勾的裁决块**。
> **正文现在是给人类逐条打勾的清单，不是结论**——勾选框全部留空，
> `status` / `confirmed_by` / `confirmed_at` 一律未动（那是人的动作）。
>
> **只查交叉约束。** 单束内的问题在签该束时已经看过了，这里不重复。
>
> 📍 **从哪读起**：**二·〇**（编号统一，先做这一条）→ **二·一 总表**（含「已有答案？」列，
> 标「已定」的 9 条是**确认动作**不是裁决）→ **六·一**（重签窗口合并，省人类的次数）。

## 〇·2026-08-04 待复核输入：XC-31 · Curated Garden Advisors 不得扩张既有能力边界

**状态**：新束材料已写，尚未进入本文件 frontmatter 的 `covers_bundles`；历史确认不覆盖本条。

**涉及束**：`curated-capability-packs`（待签）· `skills`✅ · `agent-runtime`✅ ·
`asset-governance`✅ · Wave 2 runtime delta✅。

**要核对的四个方向**：

1. **Skill 语义**：四项都是声明式 advisor；不新增 `Skill.source` 取值，不把 Garden/社区来源
   伪装成一个已签枚举成员。provenance 只进现有 version manifest 与 NOTICE/LICENSE 文件。
2. **导入语义**：只复用 `POST /admin/skills/starter-pack-imports` 与 `SKILL_STARTER_PACK_ROOT`；
   不新增字段/错误码/default/recommended/seed/implicit import。
3. **运行时边界**：Web Design、Image Prompt Mode C、Article Planning、Video Planning 均无
   shell/network/browser/image/TTS/fs/secret/tool/MCP/AgentRun；任何可执行模式另立契约。
4. **治理边界**：这是一次性固定 tag/commit/archive 的 curated adapter pack，不接
   `asset-governance` 的社区连接/自动同步/升级流水线，也不跟随上游 `main`。

**机械验收输入**：F149 verification 必须含 deterministic generator check、四项精确集合、
file/pack tamper、non-admin、cross-org、idempotency、attribution、empty-before-explicit-import、
no-builtin 和 executable-mode-unavailable 反证。

**人类动作（agent 不得代做）**：

- [ ] 确认上述四个方向与既有已签束不冲突。
- [ ] 先确认 `contracts/curated-capability-packs/design-signoff.md`。
- [ ] 把 `curated-capability-packs` 加进 frontmatter `covers_bundles`。
- [ ] 刷新本文 `confirmed_by` / `confirmed_at`，明确这次确认发生在新束之后。

裁决人：______   日期（ISO 8601，含时区）：______

## 一、复核范围（**十个束** / 111 个 feature / 361 点 —— ⚠ 已过期，见本节末的更正）

| 束 | 覆盖 feature | 数 | 点 | 依据 UC |
|---|---|---:|---:|---|
| `interview` | F80–F99 | 20 | 68 | `06-itv/uc-6-0` … `uc-6-7`（8 份） |
| `files` | F31–F47 | 17 | 48 | `22-files/uc-22-1` … `uc-22-4`（4 份） |
| `templates` | F17–F30 | 14 | 50 | `02-tpl/uc-2-1` … `uc-2-4`（4 份） |
| `agent-runtime` | F48–F60 | 13 | 53 | `04-agent`(4) + `20-model`(3) + `21-mcp`(2) |
| `org-admin` | F03 F04 F05 F06 F07 F10–F16 | 12 | 30 | `01-auth/uc-1-1 · 1-2 · 1-3 · 1-4 · 1-6` |
| `recording` | F69–F79 | 11 | 31 | `05-rec/uc-5-1` … `uc-5-4`（4 份） |
| `skills` | F61–F68 | 8 | 31 | `03-skill/uc-3-1` … `uc-3-6`（6 份） |
| `canvas` | F100–F107 | 8 | 26 | `07-canvas/uc-7-1` … `uc-7-4`（4 份） |
| `chat` | F108–F115 | 8 | 24 | `08-chat/uc-8-1` … `uc-8-5`（5 份） |
| `project` | **（无）** | **0** | **0** | `00-project/uc-00-1 · 00-2 · 00-3`（3 份） |
| **合计** | **F03–F115** | **111** | **361** | **47 份 UC** |

### ⚠ 第 10 个束 `project`：feature 数为 0，且**这是它的正确状态**

`project`（项目本身）是**最晚被发现缺失**的能力域——九束的切分是在它被发现之前定的。
它在 `feature_list.json` 里**没有任何 feature**（估 8–10 个 / 32–40 点），
因为 `requirements/00-project/OPEN-QUESTIONS.md` 的 **12 条裁决**未完成时，
requirement-author 连「项目这张表有几列」都写不出来，更写不出可执行的 `verification`。

⇒ 它的 `design-signoff.md` frontmatter 是 `covers: []`，
这会让 `verify-uc-coverage.ts` / `doctor` **报红**，报错逐字为
「声明了 `covers: []`（空）—— 一个不覆盖任何 feature 的束不成立，**因此它不可签核**」。
**这条红是故意留的**：空 covers 若被放行，「本束覆盖的 feature 全部已评审」
会因集合为空而**平凡为真**，读起来像绿灯而实际什么都没评审
（本仓九次「全绿但空转」的形状）。

⚠ **本束是 X-6 的归属答案**：下方待议清单 X-6 逐字写着议程环节的状态机
「既不在 `org-admin` 也还不存在」——它属于 `project` 束。
六个束的 feature（F05 F16 F19 F26 F27 F31 F63 F64 F81 F102）已经在议程环节上排工，
而**环节实体本身没有任何 feature**。⇒ 复核时必须处置这个倒置。

> ⚠ **这张表是派生视图，不是权威。** 束↔feature 映射的权威是各束
> `design-signoff.md` 的 frontmatter `covers:`（ADR-023 决策三）。
> 改覆盖范围改那里，**不要**只改这张表。
> 机械证明（无遗漏、无重叠）由 `pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 01` 给出。

> 🔴 **上表已过期，且它过期的方式正是本文 frontmatter 警告过的那一种。**
> 它写的是 2026-07-30 建骨架时的**十个束 / 111 feature / 361 点**；
> 磁盘上现在是 **十二个束 / 144 feature / 513 点**（2026-07-31 实测，逐束 `covers:` 求和）：
>
> | 束 | covers 数 | 束 | covers 数 |
> |---|---:|---|---:|
> | `interview` | 20 | `project` | 13 |
> | `files` | 17 | `asset-governance` | 12 |
> | `agent-runtime` | 16 | `org-admin` | 12 |
> | `templates` | 14 | `recording` | 11 |
> | `canvas` | 8 | `chat` | 8 |
> | `skills` | 8 | `research` | 5 |
>
> **不要修这张表把它变成第二份权威**——权威是各束 `covers:`（ADR-023 决策三）。
> 这条注记只是让读者别照着过期数字做判断。本节标题里的「十个束 / 111 / 361」同此。
> ⚠ `project` 束的 `covers` 已从建骨架时的 `[]` 变为 13 个（F116–F128），
> 因此下方「第 10 个束 `project`：feature 数为 0」那一小节**整节已不成立**，
> 它描述的是一个已经过去的状态；其中唯一仍然有效的内容（议程环节归属）已收进 **XC-01**。

### 与架构师原切分表的一处出入（已按磁盘为准）

原切分表把 `org-admin` 写作 **8 个 feature / 30 点**。磁盘上 `area: auth` 的是 **12 个 / 30 点**
（点数一致，件数不一致）——`F01 F02 F08 F09` 已随 auth 最小可用切片迁入 phase-00，
`feature_list.json` 里的副本已删除，剩下的 12 件全部收进 `org-admin`。
按 8 件切会留下 4 件不属于任何束，`assertDesignSignedOff` 会直接拒绝它们开工。

## 二、交叉约束复核清单（XC-00 … XC-30）

> 查什么（`contract-design.md` §四）：
> ① 同一事实是否在多束中被重复定义（本项目最高发的缺陷）
> ② 跨束的不变量是否互相矛盾
> ③ 跨束的级联是否闭合（每一环都有人接吗）
> ④ 错误语义是否一致（同一种失败在不同束里是不是同一个错误码）
>
> **只查交叉约束。** 单束内的问题在签该束时已经看过了，这里不重复。
>
> ⚠ **每条都做了「仓库里已有答案吗」的穷尽检索**（`AGENTS.md` 纪律 6：本仓已五次
> 「已有答案却在被重新裁决」）。总表的「已有答案？」列就是那次检索的结论：
> 标 **已定** 的，**不是待裁决，是待确认**——人类只需核对出处是否被正确执行，
> 不需要重新想一遍。

---

### 二·〇 先做这一条：X- 编号统一为 `XC-nn`（否则下面的清单没法用）

**问题**：磁盘上「X-」这个前缀现在有 **十套互不相干的命名空间**，一条约束能有三个 ID，
一个 ID 能指两条完全不同的约束。

| 命名空间 | 范围 | 出处 |
|---|---|---|
| phase-00 阶段级 | X-1 … X-6 | `phases/phase-00-shared-kernel/design-coherence.md:48,68,86,101,128,151` |
| phase-01 阶段级（本文旧表） | X-1 … X-14 | 本文件 `:125-138` |
| `chat` 束 | X-1 … X-9 | `contracts/chat/design-signoff.md:183-191` |
| `interview` 束 | X-1 … X-9 | `contracts/interview/design-signoff.md:159-167` · `coverage.md:227-235` |
| `recording` 束 | X-1 … X-10 | `contracts/recording/domain.md:215-224` |
| `templates` 束 | X-1 … X-9 | `contracts/templates/design-signoff.md:161-169` |
| `agent-runtime` 束 | X-1 … X-10 | `contracts/agent-runtime/design-signoff.md:217-226` |
| `project` 束 | X-3' · X-6 · X-15 … X-22（且 X-4 借用 phase-00 的） | `contracts/project/design-signoff.md:303-312` |
| `asset-governance` 束 | X-A … X-J | `contracts/asset-governance/domain.md:293-302` |
| `research` 束 | X-A … X-J | `contracts/research/domain.md:136-145` |

**已经在咬人的两个例子（不是假设）**：

- **`X-4` 指三件事**：phase-00 `X-4` = 快照不可删的合规撤回豁口（`phase-00-shared-kernel/design-coherence.md:101`）；
  phase-01 阶段级 `X-4` = 三层权限求交（本文 `:128`）；`templates` 束 `X-4` = 机密硬路由
  必须在网关侧独立可拒（`contracts/templates/design-signoff.md:164`）。
  而 `contracts/project/usecases.md:98` 与 `contracts/project/domain.md:284,509` 写的 `X-4` 是 phase-00 那个——
  **同一份文件里同时引用了两套命名空间**。
- **`X-D` / `X-E` 各指两件事**：`asset-governance` 的 X-D/X-E 是 `Skill.source` / `Skill.fileCount`
  冲突（`contracts/asset-governance/domain.md:296-297`）；`research` 的 X-D/X-E 是「综合 Studio」出口与
  `files` 八值枚举（`contracts/research/domain.md:139-140`）。**两束在同一个阶段里用同一对字母指四件事。**

⚠ 同型问题在 `Q-` 编号上也已发生：`23-asset` / `24-research` / `00-project` 三份 `OPEN-QUESTIONS.md`
**各有一套 Q-11 / Q-12，六条互不相干**（其中 `00-project` 的两条已裁、另外四条未裁）。
引用时必须带束名。

**推荐**：本文第二节的 `XC-nn` 是 **phase-01 跨束交叉约束的唯一权威编号**。
各束文档里的旧 X- 编号**保留不动**（它们是束内自报的议程，改它们等于改已签核束的正文），
但**引用跨束约束时一律写 `XC-nn`**；本文每条都给出「合并自」，双向可追。
`XC` 前缀与既有十套（`X-数字` / `X-字母`）都不碰撞。

**风险**：出现第十一套编号。缓解 = 本文是唯一新增的一套，且它**只在这一处声明**；
束内旧编号不复制到本文之外。

##### 裁决
- [ ] 采纳推荐（`XC-nn` 为 phase-01 跨束约束唯一权威编号，束内旧编号保留但不再对外引用）
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

### 二·一 总表（**按上游程度排序，不按编号**）

**排序理由**：排在前面的条目**会改变后面条目的形状**——
① `XC-01`/`XC-02` 定的是实体名与实体归属，改一次会重写十几个束的字段名与挂载点；
② `XC-03`…`XC-05` 定的是**词表**（来源类型 / 角色 / 可见性），词表不定，下游任何枚举都写不下去；
③ `XC-06` 是**机制**（错误码没有编译期门控），它决定 `XC-07` 那类「同码同义」能不能真正收住；
④ `XC-08`/`XC-09` 是**记载一致性**（裁决写在哪份文件），不收敛就会有人照错的那份实现；
⑤ 其后是「phase-00 已裁、phase-01 只需确认消费口径」的一批（成本最低，可先清）；
⑥ 最后是**只在本阶段内、不改别条形状**的归属与真冲突。

| # | 一句话 | 涉及束（✅=已签核） | **已有答案？** | 触碰已签束 |
|---|---|---|---|---|
| **XC-00** | X- 编号十套命名空间，先统一为 `XC-nn` | 全部 | 未覆盖 | 否（只加一层引用层） |
| **XC-01** | `agenda_segment` 实体归属 + `stepId`/`stage.*` 改名对齐 | ✅project ✅templates ✅canvas ✅skills ✅org-admin ✅agent-runtime ✅files ✅interview + phase-00 ✅artifact ✅identity | **已定**（D-03a + Q-3 A/B①） | **是 · 10 束** |
| **XC-02** | `projects` 语义改为容器超类型（修订 phase-00 `identity`） | ✅project + phase-00 ✅identity ✅artifact ✅context-pack | **部分**（Q-12 C+D 已裁；U-8/U-9 未覆盖） | **是 · 3 束** |
| **XC-03** | 来源类型词表三方不齐（7 值 / 8 值 / `research` vs `research-run`） | ✅files research(未签) ✅canvas ✅recording ✅chat ✅interview ✅templates + phase-00 ✅artifact | **未覆盖** | **是 · artifact + files** |
| **XC-04** | 角色本体：合规负责人 + 四种新职能落在哪一层 | ✅org-admin ✅files ✅skills ✅agent-runtime ✅interview + phase-00 ✅identity | **部分**（D-U3 已裁合规负责人；O-21 裁了两种职能的分工，未裁落层；「能力维护者」未覆盖） | **是 · 5 束** |
| **XC-05** | 可见性词表四套并存，且**禁止**与 MCP 授权范围合并 | asset-governance ✅agent-runtime ✅chat ✅templates + phase-00 ✅identity | **未覆盖** | **是 · 3 束** |
| **XC-06** | `operations[*].err` 没有任何编译期约束（**全部束**，不只既有束） | 全部 12 束 + phase-00 全部 6 束 | **未覆盖** | 否（加门控不改契约） |
| **XC-07** | 同一种失败在不同束里是两个字面量（**已确证 5 组**） | ✅skills ✅agent-runtime ✅canvas research + phase-00 ✅identity ✅context-pack ✅recording | **未覆盖** | **是 · 4 束** |
| **XC-08** | Q-0 的裁决记在 `DECISION-Q0.md`，而 `OPEN-QUESTIONS.md` 的裁决行仍空白 | asset-governance | **已定**（结论在），但**记载分裂 + 违反该文件自己的规则** | 否 |
| **XC-09** | 试跑台：裁决文写「phase-1 保留」，落地整块在 phase-2、零 feature 零端口 | asset-governance ✅skills ✅templates | **已定**（`DECISION-Q0.md:60` 逐字） | 否（但会新增 feature） |
| **XC-10** | 统一 provenance / 审计查询面 | ✅files ✅chat ✅canvas ✅skills ✅org-admin ✅interview ✅recording ✅agent-runtime ✅templates ✅project + phase-00 ✅artifact ✅identity | **已定**（phase-00 X-2） | 否（消费侧确认） |
| **XC-11** | 机密数据模型路由口径 D-U1 | ✅chat ✅agent-runtime ✅templates | **已定**（D-U1 选 B：整轮全本地） | 否（但要删一个反向错误码） |
| **XC-12** | 可见性沿数据链路传播（六条路径共用一个判定） | ✅files ✅chat ✅recording asset-governance research + phase-00 ✅identity ✅context-pack ✅artifact | **已定**（phase-00 X-1，判定归 `identity`） | 否（消费侧确认） |
| **XC-13** | 快照不可删 vs 保留期到期物理删除（`C_REC_2`） | ✅recording ✅project ✅files + phase-00 ✅artifact | **部分**（phase-00 X-4 已裁豁口只留合规撤回；**O-39 法定留存清单不存在**） | 否（但**硬阻塞**） |
| **XC-14** | 撤回链两级 SLA + 六条级联闭合 | ✅interview ✅recording ✅files ✅org-admin research + phase-00 ✅context-pack ✅artifact | **部分**（D-15 数值已定；单一事实源与六环归属未定） | 否 |
| **XC-15** | 留存策略五参数 / 180 天的**代码级**单一事实源 | ✅files ✅recording ✅interview ✅agent-runtime + phase-00 ✅auth | **部分**（数值已定；代码级单源未指定，`FS7` 逐字无门控） | **是 · auth** |
| **XC-16** | Context API 是唯一通路（不得直查 DB / 向量库 / 对象存储） | ✅canvas ✅skills ✅interview ✅recording ✅agent-runtime ✅chat research + phase-00 ✅context-pack ✅api-kernel | **部分**（规则已声明；**门控脚本存在但没有这条规则**） | 否 |
| **XC-17** | `referenceForDownstream` 引用资格门 + `DownstreamPurpose` 两套词表 | ✅chat ✅interview ✅files + phase-00 ✅artifact | **未覆盖** | **是 · artifact + chat** |
| **XC-18** | 同意项：四项 vs 三项，仓库里三个版本 | ✅interview ✅recording ✅org-admin | **未覆盖** | **是 · 2 束** |
| **XC-19** | 三粒度 AI 写权限求交（模板级 / 项目级 / 画布级） | ✅canvas ✅templates ✅agent-runtime ✅project | **部分**（O-23 裁了「取交集」；模板级与三个默认值未覆盖） | 否 |
| **XC-20** | 任务权限包分级：**R0 存在吗**（原型 vs 档案正面冲突）+ 第③层归属 | ✅agent-runtime ✅org-admin ✅skills | **已定**（D-28 逐字只有 R1/R2/R3），但**原型画的是 R0–R1/R2/R3** | **是 · agent-runtime** |
| **XC-21** | 归档语义在四处各裁一次 + Context Pack 不按项目状态过滤 | ✅project ✅templates ✅canvas ✅skills research + phase-00 ✅context-pack | **部分**（O-10/O-11/O-18 + Q-5 各裁一类；⑵⑶⑷ 未覆盖） | **是 · context-pack** |
| **XC-22** | 快照语义不得分叉（蓝本版本 / 实例固化 / skill 锁定 / 访谈脱钩） | ✅templates ✅skills ✅canvas ✅interview + phase-00 ✅artifact | **已定**（phase-00 I-8/I-11 + D-30） | 否（消费侧确认） |
| **XC-23** | file-first 与删除传播，文件浏览器不是权限旁路 | ✅recording ✅canvas ✅chat ✅files ✅interview + phase-00 ✅artifact | **已定**（判权单源已在 phase-00） | 否（消费侧确认） |
| **XC-24** | 「综合 Studio」——已签核束里一个通往未定义目的地的出口 | ✅interview research | **未覆盖**（六份 DECISIONS 零命中） | **是 · interview** |
| **XC-25** | skill 硬删除落成「提供但恒拒」，与 N-5 先例方向相反；三束三种做法 | ✅skills research ✅project + phase-00 ✅identity | **部分**（N-5 已裁「不提供」，但那是「删除组织」，未对 skill 裁） | **是 · skills** |
| **XC-26** | 资产复核时钟 vs MCP 14 天隔离期（两套计时器）+ 到期规则与 `14-brain` 同一条 | asset-governance ✅agent-runtime + phase-03 `14-brain` | **未覆盖** | **是 · agent-runtime** |
| **XC-27** | Q-0 派生：`AssetDirectory` 多文件 vs `Skill.fileCount` 恒 1；`AssetProvenance` vs `Skill.source` 五值 | asset-governance ✅skills | **部分**（Q-0 已裁方案 C；两条字段级冲突未裁） | 否（推荐 A 一处不动 `skills`） |
| **XC-28** | 资产查重相似度 68% vs O-35「不用分数、改用结构性断言」 | asset-governance ✅skills ✅agent-runtime | **已定**（O-35 裁决方向明确） | 否 |
| **XC-29** | 后台屏落点：「数据总览」屏在 phase-01 / UC 在 phase-03；蓝本管理屏 `/admin/blueprint` vs `/tpl` | asset-governance ✅templates ✅canvas + phase-03 `17-gov` | **未覆盖** | 否（推荐 A 只加链接） |
| **XC-30** | `files` 束的两条判定面都在别束（prompt injection 另一半 / `evidencePolicy`） | ✅files ✅agent-runtime + phase-00 ✅context-pack | **未覆盖** | 否（只加门控与归属） |

**统计**：共 **31 条**（含 XC-00）。
**已有答案**：**已定 9 条**（XC-01 · XC-08 · XC-09 · XC-10 · XC-11 · XC-12 · XC-20 · XC-22 · XC-23 · XC-28
——其中 XC-20 属「档案已定但与原型冲突」，仍须人类拍板；其余 9 条是**确认动作**）；
**部分 9 条**；**未覆盖 12 条**（含 XC-00）。

**触碰已签核束的 12 条**，按束汇总（这是「要重签哪些束」的答案）：

| 束 | 由哪些条目触碰 |
|---|---|
| phase-00 `identity` ✅ | XC-01 · XC-02 · XC-04 · XC-07(第4组) |
| phase-00 `artifact` ✅ | XC-01 · XC-03 · XC-17 |
| phase-00 `context-pack` ✅ | XC-21 |
| phase-00 `auth` ✅ | XC-15 |
| `agent-runtime` ✅ | XC-05 · XC-07 · XC-20 · XC-26 |
| `skills` ✅ | XC-25 |
| `chat` ✅ | XC-05 · XC-11 · XC-17 |
| `templates` ✅ | XC-01 · XC-11 |
| `interview` ✅ | XC-18 · XC-24 |
| `recording` ✅ | XC-18 |
| `files` ✅ | XC-03 |
| `project` ✅ | XC-01 · XC-02 |

⇒ 合并后建议的三个重签窗口见本文 **六·一**。

---

### 二·二 逐条

#### XC-01 · `agenda_segment` 的实体归属与改名对齐

**合并自**：本文旧表 X-6 · `project` X-6 / X-3' / X-22 · `agent-runtime` X-8 · `templates` X-2

**一句话**：议程环节实体归 `project` 束（六个束的 feature 已经挂在它上面而它本身没有 feature），
且 phase-00 的 `step_id`/`stepId`/`stage.*` 必须改名对齐到 D-03a 的权威名。

**涉及束**：`project`✅ `templates`✅ `canvas`✅ `skills`✅ `org-admin`✅ `agent-runtime`✅
`files`✅ `interview`✅ + phase-00 `artifact`✅ `identity`✅
**代价**：触碰 **10 个已签核束**，且动 **5 个已 passing 且已在 main 的 feature 的验收命令**
（F01 / F06 / F07 / F08 / F13）⇒ **必须重签**。

**已有答案：已定。**
- 命名权威：`phases/requirements/DECISIONS-FINAL.md:31`（D-03a，2026-07-28 定稿，逐字给出
  `agenda_segment` / `design_facet` / `method_stage` 三分与事件名）。
- 归属与改名：`phases/phase-01-run-a-project/requirements/00-project/OPEN-QUESTIONS.md:381-395`
  ——A 项已勾（确认 D-03a 有效）、**B 项已勾 ①「改名对齐」**（`step_id`/`stepId` → `agenda_segment_id`，
  `stage.*` → `agendaSegment.*`），裁决人 yanbin shen，2026-07-30。C 项（`templates` 束旧名收敛）**未勾**。

**证据**
- 归属倒置：本文旧表 X-6（`:130`）逐字「它既不在 `org-admin` 也还不存在」；
  `contracts/project/design-signoff.md:303` 逐字「**本束就是它的归属答案**」。
- 残留量（**不写死数字，现场跑**）：
  `grep -rniE 'agenda_?stage' phases/phase-01-run-a-project/contracts/templates/` ——判据 = 输出为空。
  2026-07-30 实测 19 行 / 21 处（`contracts/project/design-signoff.md:304`，该条并记录了
  「此前写 2 处」的错误计数如何被 `OPEN-QUESTIONS.md` 复制了三份）。
- phase-00 侧规模：`contracts/project/MIGRATION-IMPACT.md` 第二节，21 文件 / 109 处 `step_id`·`stepId`
  + 14 处 `stage.*`；`contracts/project/design-signoff.md:307`（X-22）另点名三处特殊项：
  新迁移序号应为 `0018-*`（`0016`/`0017` 已占用，Q-8 推荐里写的 `0016` 已过期）；
  `rbac-two-layer.test.ts` 里那条**故意不存在**的 `"stage.selfDestruct"` 反证必须一起改，
  否则它变成永远通过的空转断言；前端 5 处旧名全在注释/文案里 `typecheck` 一处都不会红
  ⇒ grep 门控范围必须包含 `apps/web`。
- 契约侧已写死门控：`contracts/project/domain.md:259`（I-P20）。

**双向核对**
- **UC → API**：六束 UC 的验收线索都指向「切换议程环节」，而 `agenda_segment` 的状态机在
  `project` 束出现之前**不属于任何束** ⇒ 有验收线索、无 API 归属 ⇒ 业务跑不通。（已由 `project` 束补上。）
- **API → UC**：`packages/contracts/src/project.ts:779`（`P5`）逐字
  「`AgendaSegment.duration` has **no documented unit**; the prototype only shows a duration tier」
  ⇒ 一个 UC 没有明确要求其单位的字段形状。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 确认归属 + **执行改名**（`templates` 束 21 处 + phase-00 21 文件 / 123 处），并加 grep 门控（含 `apps/web`） | 大：重签 10 束，改 5 个已 passing feature 的验收命令 | 改名迁移期间 `main` 上的 feature 命令会红一次 |
| B | 只确认归属，改名推迟到 phase-02 | 小 | 第七次「同一事实两处」继续存在，且随 phase-01 屏数增长放大 |

**推荐**：**A**。B 的代价随时间单调上升（残留处数已从「2 处」的错误计数涨到实测 21 处），
且 D-03a 是定稿裁决、Q-3 的 B① 已经勾了——推迟只是让一条**已经裁过两次**的规则继续不落地。

**风险**：改名会让 5 个已 passing feature 的 `verification` 命令暂时失败；
必须在同一个 PR 里改完契约 + SQL + 前端 + 验收命令，不许分批。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-02 · `projects` 的语义从「工作坊」变为容器超类型（修订 phase-00 `identity`）

**合并自**：`project` X-21 / X-19 / U-7 / U-8 / U-9 · `project.ts` `P2` `P4`

**一句话**：`projects` 表要承载工作坊 / 研究项目 / 用户洞察三类容器，
这是对一个**已签核束**的语义变更，而**没有任何门控会因此变红**。

**涉及束**：`project`✅ + phase-00 `identity`✅（覆盖 F01 F02 F03 F15 F16 F17）· `artifact`✅ · `context-pack`✅
**代价**：触碰 **3 个已签核束** ⇒ 需重签 phase-00 `identity`。

**已有答案：部分。**
- **已定**：`00-project/OPEN-QUESTIONS.md:1018-1022` —— 人类逐字裁 Q-12 为 **C + 连带 4 D（超类型）**，
  「三类各建 1:1 子类型表」。
- **未覆盖**：`acl_bindings.object_kind` 加不加值（**U-8**，`contracts/project/domain.md:337`
  逐字「**人类逐字裁决里没有出现 `object_kind`**」）；`projects.kind` 判别列可不可接受
  （**U-9**，`domain.md:336` 逐字「六份 DECISIONS 全文无 `kind 判别列`」）；
  `admin_project_access` 的审计语义是否按 kind 区分（**无出处**）。

**证据**
- `contracts/project/design-signoff.md:306`（X-21）逐字：「表结构上 `projects(id)` 的 7 条外键一条不改，
  所以**没有任何门控会因语义变更变红**——正因如此它必须走签核」。
- 逐条影响面：`contracts/project/MIGRATION-IMPACT.md` 第一节。
- 连带缺口：`contracts/project/design-signoff.md:311`（X-19）——`groups.project_id` 指向超类型，
  而分组是**工作坊机件** ⇒ 研究项目 / 用户洞察下可以插分组，**外键层不可表达为禁止**（U-7）；
  且三张新子表**不在 F22 冻结策略的写死表清单里**（`0014:165-184`），组织停用后子类型行仍可写。
- `packages/contracts/src/project.ts:759`（`P2`）：U-1 已裁两类容器的成员模型
  （`owner|collaborator`），但 `usecases.md` UC-P9 仍写「pending U-1」，且**两类容器都没有任何成员操作**。

**双向核对**
- **UC → API**：UC-P9 有成员模型的验收线索、无对应 operation（`P2`）⇒ 业务跑不通。
- **API → UC**：`createProject.in` 对三类 kind 都接受 `blueprintVersionId`，而「非工作坊能不能带蓝本」
  无裁决（`project.ts:773` `P4` 逐字「the input currently accepts it for all three kinds」）⇒ 接口面比 UC 宽。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 采纳 `domain.md` §八 的三条推荐：**U-9 = A（接受判别列 + 复合外键）· U-8 = B（不加值，维持三值闭集）· U-7 = A（两者都禁，靠复合外键下沉到 DB）**，并在重签 `identity` 的记录里**写死「`object_kind='project'` 现在意味着三类容器」** | 中：重签 phase-00 `identity`；新增一张迁移 | 判别列被误用为行为分支（那正是被否决的候选 A 的形状） |
| B | U-8 加值（`research_project` / `user_insight`），不用判别列 | 改 phase-00 已签核束的 CHECK 闭集 | 触发器 `acl_binding_same_org()` 的逻辑要重写 |

**推荐**：**A**（与 `contracts/project/domain.md:336-339` 四条 `V 采纳推荐` 一致）。
⚠ **必须同时补一条正向断言**：三类容器各建一个、各授一条 `object_kind='project'` 绑定，
断言三条都通过同一触发器（`domain.md:450` ③）——否则「语义变了但没门控」原样保留。

**风险**：U-9 若被否决，U-7 的禁止只能落到测试层，DB 层无法表达。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-03 · 来源类型词表三方不齐（7 值 / 8 值 / `research` vs `research-run`）

**合并自**：本文旧表 X-3 · `research` X-E · `files/domain.md` 二·五 · `files.ts` `FS1` · `research.ts` `R3`

**一句话**：同一个字段在磁盘上有三份定义，三方两两都不相等，而**两个独立的束各自撞到了它**。

**涉及束**：phase-00 `artifact`✅（7 值，zod 单一事实源）· `files`✅ · `research`（未签）·
`canvas`✅ · `recording`✅ · `chat`✅ · `interview`✅ · `templates`✅
**代价**：触碰 phase-00 `artifact`（改名）或 `files` + 界面（改两处）⇒ 两边都要重签。

**已有答案：未覆盖。**
六份 `phases/requirements/DECISIONS-*.md` 全文**零命中** `sourceType` / `ArtifactSource` /
`research-run` / `prototype-run`；`00-project/OPEN-QUESTIONS.md` 与 `23-asset/DECISION-Q0.md` 亦无。
唯一登记处是本文旧表 X-3（`:127`），处置栏空白。

**证据**
- 逐值对照表：`contracts/files/domain.md:154-164`
  ——3 对同义异名（`file↔upload` · `research↔research-run` · `generated↔ai-generated`）、
  2 个契约缺失值（`workshop` `canvas`，而**已建成界面已经把它们当一等来源画进左树**，
  UC-22.3 的七类物化清单也逐行给了它们的固定文件）、
  1 个反向孤儿（`prototype-run` 在四份 UC 的八类里没有位置）。
- **两束独立撞到**（这本身就是它真实存在的证据）：`files` 侧 `contracts/files/domain.md:142` 起整节；
  `research` 侧 `contracts/research/domain.md:140`（X-E）。
- 已被钉成编译期事实：`packages/contracts/src/research.ts:326`
  `RESEARCH_ARTIFACT_SOURCE = ["research-run"] as const satisfies readonly ArtifactSourceT[]`
  ——**若 `artifact` 束改名，这一行立刻不通过类型检查**（`:309-325` 的注释逐字说明这是刻意的）。
- 已经付出的代价：`packages/contracts/src/files.ts:1195`（`FS1`）逐字
  「every source-type field is `z.string()` plus `SOURCE_TYPE_VOCABULARY_DISPUTED`」
  ——**`files` 束整束的来源类型字段都退化成了字符串**。
- 要求早就写了、没有脚本所以没落地：`contracts/files/domain.md:178`
  「来源类型八值枚举必须与 12-survey / 06-itv / 05-rec / 08-chat / 07-canvas /
  **研究 Studio** 的产出侧同一份定义，不得各建各的」
  ——**`files` 是已签核束，它一直在依赖一个当时不存在的 `research` 束**（与 `project` 束当初同形）。

**双向核对**
- **UC → API**：UC 侧的 `workshop` / `canvas` 两类有完整验收（UC-22.3 逐行给了固定文件），
  而契约里**没有这两个值** ⇒ 业务跑不通。
- **API → UC**：`prototype-run` 在契约里、在四份 UC 的八类里没有位置 ⇒ **接口多余**（或归属未定）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **以界面 8 值为权威**：`artifact.ArtifactSource` 改名（`upload→file` · `research-run→research` · `ai-generated→generated`）+ 扩容 `workshop` `canvas`；`prototype-run` 并入 `generated` | 大：重签 phase-00 `artifact`；`research.ts:326` 会红（**这是设计好的**） | 已 passing 的 artifact feature 验收命令受影响 |
| B | 以契约 7 值为权威：界面与 `research` 束改用 `research-run`，`workshop`/`canvas` 扩容进契约 | 中：改两处 + **仍要改 phase-00**（扩容） | 界面左树八节点文案与值不一致，用户可见 |
| C | 保持 `z.string()` + 争议标记，推迟到 phase-02 | 零 | 第三份副本迟早出现；`files` 束整束无枚举约束 |

**推荐**：**A**。理由：⑴ 三方里**两方**（界面 + `research` 束）已经用 `research`；
⑵ `workshop` / `canvas` 无论选哪边都要扩容 phase-00 ⇒ **B 并不能避免动 `artifact`**；
⑶ 界面是原型侧的既成事实（`COORDINATOR-LOOP.md` 纪律 7：原型是权威）。
⚠ **C 不可取**：`AGENTS.md` 逐字「凡出现第二份副本，一律收敛为单一事实源 + 机械门控」，
而这里已经是第二份且**已经漂了**。

**风险**：`ArtifactSource` 改名会波及 `project.ts:271,597` 的 `acceptedSources`
——那两处是**引用**不是副本（`:596` 注释逐字「引用 `artifact.ArtifactSource`，不抄一份」），改名后自动跟随，属可控。
`prototype-run` 的归属若不同时裁，A 会留一个悬空值。

##### 裁决
- [ ] 采纳推荐（A：以 8 值为权威，`prototype-run` 并入 `generated`）
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-04 · 角色本体：合规负责人 + 四种新职能落在哪一层

**合并自**：本文旧表 X-5 · `files` 缺口 15 / `FS9` · `org-admin` `OA2` · `skills` 缺口 12 ·
`agent-runtime` X-2 · `interview` X-9

**一句话**：五个束各自需要一个**项目四值角色装不下**的职能，而只有其中一个有裁决。

**涉及束**：`org-admin`✅ · `files`✅ · `skills`✅ · `agent-runtime`✅ · `interview`✅ + phase-00 `identity`✅
**代价**：若要加第五个项目角色 ⇒ 推翻 O-03 并重签 phase-00 `identity` + 5 个 phase-01 束。

**已有答案：部分。**
- **已定（合规负责人）**：`phases/requirements/DECISIONS-UI-ROUND.md:90`（D-U3）逐字
  「**选择：B** — **不加第三层**：合规负责人归**组织角色**；受访者走已有的一次性令牌身份；
  研究员/参与者是引导师/组员在访谈场景下的**展示别名**，不落库。」
  执行落点：`identity.ts` 组织角色增加第四种 `compliance`，「O-03『项目角色恒为四种』得以保住」。
  ⇒ 本文旧表 X-5 说的「`ui-preview/README.md` 的 S-02/S-03 是**过期表述**」**成立**。
- **部分（两种审核职能）**：`phases/requirements/DECISIONS-OPEN.md:599`（O-21）逐字裁
  「**拆成两种职能**：① 方法论审核人（skill 内容 + 知识晋升）；② 安全评审人…
  两者均由组织管理员指派，**不得自审自批**」。**裁了分工，没裁落在哪一层。**
- **未覆盖**：「**能力维护者**」在六份 DECISIONS 里零命中。

**证据**
- 两束独立撞到同一件事，且其中一个逐字点名另一个：
  `packages/contracts/src/files.ts:1262`（`FS9`）逐字「…has no home in the closed four-value
  `identity.ProjectRole`; `identity.OrgRole` has `compliance` but that is an org role.
  **Same gap as org-admin OA2**」；
  `packages/contracts/src/org-admin.ts:1075`（`OA2`）逐字「whether it is an org role or a project role
  is **unsourced**」。
- 阻塞验收：`contracts/files/coverage.md:119`（缺口 15）逐字「**V13·22-4 在此定案前无法验收**」；
  UI 原型用 `?as=compliance` **临时投影**，「这是预览手段不是角色模型」。
- 另三种职能：`contracts/agent-runtime/design-signoff.md:218`（X-2）·
  `contracts/skills/coverage.md:160`（缺口 12，「建议合并裁决」）· `contracts/skills/ui.md:339`。
- 受访者主体：`contracts/interview/design-signoff.md:165`（X-9）逐字
  「受访者是**非注册主体**（令牌即身份）…这条鉴权路径**目前没有任何束认领**」
  ——D-U3 定了语义，**没定归属**。

**双向核对**
- **UC → API**：`files` 束五个操作要求「合规负责人」这个 actor，而契约里没有能表达它的角色值
  ⇒ 前置条件不可满足。
- **API → UC**：`identity.OrgRole.compliance` 已存在于契约，但 phase-01 **没有任何 UC 说它怎么被授予/撤销**
  ⇒ 半悬空。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **确认 D-U3 的原则覆盖全部五种**：合规负责人 / 安全评审人 / 方法论审核人 / 能力维护者 / 场景角色**一律归组织角色层**（`OrgRole` 扩值），项目四值不动；并补一条 UC 说明授予/撤销路径；受访者令牌主体**归 `org-admin` 束**（它是唯一有身份面的 phase-01 束） | 中：`identity.OrgRole` 扩值 = 修订 phase-00 已签核束 | `OrgRole` 变成杂物抽屉 |
| B | 只确认合规负责人（D-U3 原文范围），另三种单列裁决 | 小 | `skills`/`agent-runtime` 的前置条件仍不可满足 |
| C | 加第五个项目角色 | 推翻 O-03，重签 6 束 | O-03「项目角色恒为四种」是多份 UC 权限矩阵的基座 |

**推荐**：**A**。D-U3 的裁决理由逐字是「**不加第三层**」——那是一条**关于层数的原则**，
把四种新职能也放进组织角色层与该原则一致；C 直接违背它。
⚠ A 必须同时回答一个**没有出处**的问题：「能力维护者」是不是就是 O-21 的「方法论审核人」？
若是，则不扩值，只是命名统一。

**风险**：`OrgRole` 扩值触碰 phase-00 `identity`（已签核，覆盖 F01 F02 F03 F15 F16 F17）。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______  （「能力维护者」= 方法论审核人？ ☐ 是 ☐ 否）

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-05 · 可见性词表四套并存，且**禁止**与 MCP 授权范围合并

**合并自**：本文旧表 X-14 · `asset-governance` X-C / `AG8` · `chat` `C_CHAT_1` · `templates` X-8

**一句话**：仓库里同时存在四套可见性取值域，其中两套已签核；而另有一条约束要求
**可见性范围与 MCP 授权范围绝不能合并成同一字段**——这是「两件事一处声明」，
与「一件事两处声明」同样有害。

**涉及束**：`asset-governance`（未签）· `agent-runtime`✅ · `chat`✅ · `templates`✅ + phase-00 `identity`✅
**代价**：统一即修订已签核字段 ⇒ 至少重签 `agent-runtime` + `chat`。

**已有答案：未覆盖。** 六份 DECISIONS 无对应裁决。

**证据（四套，逐个有出处）**
| 词表 | 值数 | 出处 | 状态 |
|---|---:|---|---|
| `identity.VisibilityScope` | 2 | phase-00 契约 | ✅ 已签核 |
| `McpAuthScope`（`lead\|team\|all`） | 3 | `agent-runtime` | ✅ 已签核 |
| `AssetVisibility` | 3 | `packages/contracts/src/asset-governance.ts:662`（`AG8`） | 未签 |
| `ChatVisibility` | 5 | `packages/contracts/src/chat.ts:994`（`C_CHAT_1`） | ✅ 已签核 |

- `AG8` 逐字：「two coexisting visibility vocabularies (domain X-C); deliberately not same-named,
  but **which one governs an asset is unanswered until Q-1b**」。
- `C_CHAT_1` 逐字：「**no defined mapping** from `ChatVisibility` (5) to
  `artifact`/`identity` `VisibilityScope` (2) when a thread output lands as an Artifact」
  ⇒ **对话产出落成 Artifact 时无法确定它的可见性**。
- 反向约束：`contracts/templates/design-signoff.md:168`（X-8）逐字
  「可见性范围与 MCP 授权范围**禁止合并成同一字段**（I-27），`uc-0-3` R7 已明写二者不是同一维度。
  ⚠ 这是『同一事实两处声明』的**反面**——两件不同的事被合成一处，同样有害」；本文旧表 X-14（`:138`）同。
- `contracts/asset-governance/domain.md:295`（X-C）逐字「⚠ 若要统一，动的是已签核字段」。

**双向核对**
- **UC → API**：`chat` 的 5 值在 UC 里有完整验收，但**落 Artifact 那一步没有 API 能表达它** ⇒ 级联断裂。
- **API → UC**：`AssetVisibility` 三值目前没有任何 UC 要求它必须区别于 `McpAuthScope` ⇒ 形状未被 UC 约束。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **`identity.VisibilityScope` 是唯一的「可见性」权威**；`ChatVisibility` / `AssetVisibility` 降级为**展示层分档**，各补一张**显式收敛映射表**（多档 → 2 值，**取最严**）；`McpAuthScope` **保持独立**（它不是可见性，是授权范围，按 X-8 禁止合并） | 中：两处补映射表 + 加编译期断言 | 映射表本身成为第五份声明（缓解：用 `satisfies Record<>` 钉住完整性） |
| B | 把 `ChatVisibility` 收窄到 2 值 | 界面已建成的五档要重画 | 用户可见的能力缩水 |
| C | 推迟 | 零 | `C_CHAT_1` 的洞会被实现者随手补一个默认值 |

**推荐**：**A**。它同时满足两条相反方向的约束：可见性收敛为单源，MCP 授权范围保持独立。
**映射必须取最严**（与 `chat` 的 uc-8-5 R7「摘要取所有来源最严格结果，**防信息洗白**」同向）。

**风险**：映射表若只写在文档里就是第五份副本——必须落成
`as const satisfies Record<ChatVisibilityT, VisibilityScopeT>`，让漏一档时 `typecheck` 变红。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-06 · `operations[*].err` 没有任何编译期约束（**全部束，不只既有束**）

**一句话**：所有束的 `err` 都是裸字符串字面量数组，与本束的错误码枚举**没有任何联系**——
改名时一条都不会红。这是 XC-07 那类「同码同义」问题**收不住的根因**。

**涉及束**：phase-01 全部 12 束 + phase-00 全部 6 束
**代价**：加门控不改契约形状 ⇒ **不触碰任何签核**（这是它值得先做的理由）。

**已有答案：未覆盖。**

**证据**
- `packages/contracts/tests/contract-shape.test.ts:52` 逐字 `err?: readonly string[]`；
  该文件对 `err` 的全部检查只有两条：`:66`「每个操作都有 err（可为空数组，但不能没有）」、
  `:96-99`「错误码全大写下划线，且束内不重复」。**没有任何检查把 `err` 绑到枚举上。**
- 既有束：`packages/contracts/src/artifact.ts:265`
  `err: ["MATERIALIZATION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const`；
  `operations`（`:244` 起）以 `} as const;` 收尾，**无 `satisfies`**。
- **新写的束也一样**：`packages/contracts/src/research.ts:585`
  `err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"] as const`；
  `operations`（`:553` 起）同样以 `} as const;` 收尾。
  ⇒ ⚠ **「红的只有新写的束」不成立**：新束里有门控的只是**跨束共享码**那几行
  （`research.ts:289,296` 的 `satisfies readonly (PermissionReasonT & ResearchErrorT)[]`），
  `operations` 内部的 `err` **一条都没被约束**。
- 已经存在的正确形状（可直接照抄）：`packages/contracts/src/agent-runtime.ts:126,140`
  `} as const satisfies Record<ToolAuthScopeT, number>`，`:116` 注释逐字称它为
  「这张表的**编译期完整性门控**」。

**双向核对**
- **UC → API**：多个束的 UC 声称某个码「与 X 束同码同义」，而磁盘上无从验证
  ——`research.ts:997`（`R1`）逐字：**5 条「复用」声明里 4 条是假的**。
- **API → UC**：`templates.ts:1443`（`T10`）逐字「a **knowingly unreachable** member of the error enum」
  ——错误枚举里有 UC 明令今天不得触发的成员，且没有任何东西能检出这种成员。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 每个束导出 `<Bundle>Error` zod 枚举（多数已有），把 `operations` 改成 `} as const satisfies OperationsOf<<Bundle>ErrorT>`；跨束共享码继续用现有交集 `satisfies` | 中：18 个文件各加一处类型标注 | 一次性会红出一批现存的「码不在枚举里」——**那正是它要抓的** |
| B | 在 `contract-shape.test.ts` 里加运行时检查（`err ⊆ 枚举`） | 小 | 运行时才红，改名时 IDE 无提示 |
| C | 不做 | 零 | XC-07 的五组冲突无法机械收敛，只能靠人记 |

**推荐**：**A + B**。A 给编译期，B 给「有人绕过类型标注」的兜底。
⚠ **必须同时造反证**（本仓已九次「全绿但空转」）：
故意在某束的 `err` 里加一个枚举外的码，断言 `typecheck` 变红；再删掉，断言恢复绿。

**风险**：A 落地时会一次性暴露一批现存不一致，需要预留一轮修复。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-07 · 同一种失败在不同束里是两个字面量（已确证 5 组）

**一句话**：五组「同一件事、两个名字」已经写在磁盘上，其中一组统一即修订 phase-00 已签核束。

**涉及束**：`skills`✅ · `agent-runtime`✅ · `canvas`✅ · `research`（未签）
+ phase-00 `identity`✅ · `context-pack`✅ · `recording`✅
**代价**：第 4 组触碰 phase-00 `identity` ⇒ 重签。

**已有答案：未覆盖。**

**证据（五组，逐组有出处）**
| # | A 侧 | B 侧 | 出处（逐字） |
|---|---|---|---|
| 1 | `skills.REVIEWER_FUNCTION_MISMATCH` | `agent-runtime.WRONG_REVIEW_FUNCTION` | `skills.ts:1301`（`S7`）「encode **the same rule** … under two different literals」 |
| 2 | `skills.MODEL_UNAVAILABLE` | `agent-runtime.MODEL_DEPENDENCY_FAILED` | `skills.ts:1307`（`S8`）「encode the same failure; not renamed here because changing an error literal **amends an already-written UC**」 |
| 3 | `canvas.AUTHORIZATION_REVOKED` | `context-pack`/`recording` 的 `PERMISSION_REVOKED_MIDWAY` | `canvas.ts:931`（`C_CANVAS_7`）「same meaning, two names, **no compile-time tie**」 |
| 4 | `agent-runtime.NOT_ORG_ADMIN` / `ROLE_INSUFFICIENT` | `identity.PermissionReason.ADMIN_NOT_SUPERUSER` / `PROJECT_ROLE_INSUFFICIENT` | `agent-runtime.ts:2299`（`AR4`）「unifying them **amends a SIGNED phase-00 bundle**」 |
| 5 | `research/usecases.md` 声称复用 5 个码 | 其中 **4 个不存在于任何束**（`FORBIDDEN_ROLE` / `AGENT_RUN_FAILED` / `QUOTE_REVOKED` / `SOURCE_OUT_OF_SCOPE`）；第 5 个 `MODEL_UNAVAILABLE` 在 `skills` 而非 `agent-runtime` | `research.ts:997`（`R1`）——**归属写错的后果不是文档瑕疵：它会让人去改错的束** |

另有一条**已经写好、只等文件存在**的断言：`asset-governance.ts:655`（`AG7`）逐字
「the seven codes reused from the `skills` bundle have **NO compile-time same-code-same-meaning gate**
because `src/skills.ts` does not exist in this worktree yet; the exact assertion to add once it lands
is written out above」——**`packages/contracts/src/skills.ts` 现已存在，该断言现在就能补上。**

**双向核对**
- **UC → API**：第 5 组——UC 逐字要求「复用某码」，而该码在任何 API 面上都不存在 ⇒ 跑不通。
- **API → UC**：第 1/2/3 组——两个码里必有一个是多余的接口面。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 先落 **XC-06**，再按**固定规则**逐组收敛：**内层束优先 / 先声明方优先**。⇒ 1、2 组取 `skills`；3 组取 `context-pack`；4 组取 phase-00 `identity`（改 `agent-runtime`）；5 组按 `R1` 的事实改 `research/usecases.md` 的复用声明。同时补 `AG7` 里已写好的断言 | 中：改 4 个束的错误码 + 重签 `agent-runtime` | 改错误码字面量 = 修订已写好的 UC（`S8` 逐字点出的顾虑） |
| B | 各自保留，加一张「同义码对照表」 | 小 | 对照表是第 N 份声明；`C_CANVAS_7` 逐字说缺的正是 compile-time tie |

**推荐**：**A**，并把「内层束优先 / 先声明方优先」写成规则，避免逐组重新讨论。

**风险**：第 4 组统一会动 phase-00 `identity`，与 XC-02 / XC-04 是同一个重签窗口——**建议合并**。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-08 · Q-0 的裁决记在 `DECISION-Q0.md`，而 `OPEN-QUESTIONS.md` 的裁决行仍空白

**合并自**：`asset-governance` 缺口 15

**一句话**：同一件事的裁决记载在两处且互相矛盾，**而其中一处自称是裁决原文的唯一所在，
并逐字禁止 agent 在别处填裁决**。

**涉及束**：`asset-governance`（未签，全束阻塞）
**代价**：不触碰已签核束。

**已有答案：已定（结论在），但记载分裂。**
- 结论：`phases/phase-01-run-a-project/requirements/23-asset/DECISION-Q0.md:1-6`
  ——「裁决人：**main coordinator（架构师角色，人类 2026-07-30 授权「做决定做调整，不需要我参加决策」）**；
  日期：2026-07-30；结论：**方案 C（拆）**；⚠ 本裁决**不推翻 D-06**」。
- 空白处：`phases/phase-01-run-a-project/requirements/23-asset/OPEN-QUESTIONS.md:20`
  仍是未勾的 `- [ ] **Q-0**`；`:51` 的「裁决：____ 署名：____ 时间：____」**三格全空**。

**证据（比「两处不一致」更硬的一条）**
`23-asset/OPEN-QUESTIONS.md:4` 逐字：
「**agent 不许在这里填裁决结果；填裁决的是人类，且必须署名 + ISO 8601 时间戳**」。
而 `DECISION-Q0.md` 的裁决人栏写的是 **agent 自己（main coordinator）**。
⇒ 这不是「忘了同步」，是**一条裁决在 agent 侧被作出、并搬到了那条规则管不着的另一个文件里**。
同文件 `:5` 还写着「Q-0 未裁决前，本模块不得生成 feature」，而
`contracts/asset-governance/design-signoff.md` 的 `covers` 已有 12 个 feature（F132–F143）
⇒ **按 `OPEN-QUESTIONS.md` 的字面，这 12 个 feature 是在「未裁决」状态下生成的。**
`contracts/asset-governance/coverage.md:279`（缺口 15）已登记，
`:293-294` 逐字「**收敛它们是签核动作，agent 不改**」。

**双向核对**：不适用（本条是记载一致性，不是接口面）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 人类在 `23-asset/OPEN-QUESTIONS.md:51` **亲自填「方案 C」+ 署名 + ISO 8601**；`DECISION-Q0.md` 顶部加「本文是 Q-0 的**分析与推荐**，裁决原文在 `OPEN-QUESTIONS.md`」的指向块 | 小 | 无 |
| B | 反过来：`OPEN-QUESTIONS.md` 改成指向 `DECISION-Q0.md` | 小 | 与该文件第 4 行的规则冲突；12 条问题里只有这一条例外 |
| C | 人类重新裁一遍 Q-0（不接受 agent 的方案 C） | 大：`asset-governance` 全束重做 | —— |

**推荐**：**A**。⚠ **这条要先做**：`asset-governance` 束的签核、XC-09、XC-27 全部挂在 Q-0 上，
而现在**无法机械判断 Q-0 到底裁没裁**。

**风险**：若人类实际不同意方案 C，A 会把一个 agent 的决定追认成人类的决定——
所以 A 的动作是**人类亲手填**，不是 agent 复制粘贴。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-09 · 试跑台：裁决文写「phase-1 保留」，落地整块在 phase-2

**合并自**：`asset-governance` 缺口 17

**一句话**：一条已经写下来的裁决，落地时被整块搬走了，**而没有任何门控会因此变红**。

**涉及束**：`asset-governance`（未签）· `skills`✅ · `templates`✅ · `agent-runtime`✅（配额）
**代价**：选 A 会触碰 `agent-runtime`（配额面）；选 B 不触碰任何已签核束。

**已有答案：已定。**
`23-asset/DECISION-Q0.md:60` 逐字：「⇒ **phase-1 保留试跑台，但第 05 关「沙箱试跑」不做**
（那一关跑的是外来资产的脚本）。两者同名不同物，`asset-governance/domain.md` 必须把这条区分
写成不变量，否则实现者会把『试跑台』做成『沙箱』。」
同文 `:64` 已预留逃生口：「⚠ 如果人类验收时认为『试跑台也该留 phase-2』，那就整块移走」。

**证据**
- 落地相反：`contracts/asset-governance/coverage.md:281`（缺口 17）逐字
  「`DECISION-Q0.md` 说『试跑台 phase-1 保留』，而本束**没有为它生成任何 feature、也没有端口**」；
  `:199-211` 的 V1–V13 **十三条验收全部**标 `缺口 P2 + 缺口 17`。
- 域模型已存在但无人消费：`contracts/asset-governance/domain.md:177`（`TrialRun` / `RegressionCase`）、
  `:312`（区分不变量）。
- `phases/phase-01-run-a-project/feature_list.json` 里「试跑」全部属 `templates` / `skills` 束，
  **无 asset 试跑台 feature**。
- ⚠ 一条跨束回边：`coverage.md:209`（V9）逐字「成本条三项且该次消耗**计入组织配额**…
  配额面板属 `agent-runtime`，**已签核**」。

**双向核对**
- **UC → API**：`uc-23-5` 全部 14 行有完整验收线索、**零端口** ⇒ 业务跑不通（这正是缺口 17）。
- **API → UC**：`TrialRun` / `RegressionCase` 两个值对象在 domain 里、无操作消费 ⇒ 悬空形状。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A | 维持裁决：phase-1 补试跑台 feature（去掉第 05 关沙箱），把「试跑台 ≠ 沙箱」写成不变量 | 中：新增 feature；触碰 `agent-runtime` 配额面（**需重签**） | phase-01 范围第四次扩张 |
| B ⭐ | 走 `DECISION-Q0.md:64` 自己预留的逃生口：**整块移到 phase-2**，并在 `DECISION-Q0.md` 与 `domain.md` 里把 `TrialRun`/`RegressionCase` 显式标为「phase-2，phase-1 不实现」 | 小 | 与裁决文正文相反 ⇒ **必须由人类改那句话**，不能由 agent 悄悄对齐 |

**推荐**：**B**。理由：⑴ 裁决文自己写了这个逃生口，用它不算推翻；
⑵ A 会触碰**已签核**的 `agent-runtime`，代价与收益不成比例；
⑶ phase-01 已从九束扩到十二束，`COORDINATOR-LOOP.md` L1 的目标是**尽可能少返工地进入开发**。
⚠ 无论 A 还是 B，「**试跑台 ≠ 沙箱**」这条不变量都要留在 `domain.md`
——它防的是实现者把两者做成一个（`DECISION-Q0.md:62-63` 逐字）。

**风险**：B 之后 `uc-23-5` 的 13 条验收在 phase-1 无处落地，
必须**显式标记为 phase-2**而不是静默删除（`AGENTS.md` 纪律 10：缺口要可见、有名字）。

##### 裁决
- [ ] 采纳推荐（B：整块移 phase-2，人类亲改 `DECISION-Q0.md` 那句话）
- [ ] 选 __（A：phase-1 补试跑台）
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-10 · 统一 provenance / 审计查询面

**合并自**：本文旧表 X-2 · `chat` X-2 · `interview` X-4 · `recording` X-9 · `templates` X-6 ·
`agent-runtime` X-4 · `files` 缺口 1 · `canvas` `C_CANVAS_4` · `templates` `T8` · `chat` `C_CHAT_5` · `project` `P3`

**一句话**：phase-00 已裁「查询面统一设计一次，不属于任何单束」，
而 phase-01 有**十个束**要写审计事件——这是它第一次被大规模消费。

**涉及束**：`files`✅ `chat`✅ `canvas`✅ `skills`✅ `org-admin`✅ `interview`✅ `recording`✅
`agent-runtime`✅ `templates`✅ `project`✅ + phase-00 `artifact`✅ `identity`✅
**代价**：消费侧确认；`ProvenanceEventType` 扩四值（走 ADR）。

**已有答案：已定。**
`phases/phase-00-shared-kernel/design-coherence.md:77` 起（X-2 的裁决）：
「`provenance_events` 是**单表、append-only**，查询面**统一设计一次，不属于任何单束**」，
落点是提取到 `packages/contracts/src/provenance.ts`，
「两束都只负责写入时声明自己的事件类型，**不各造查询接口**」；事件类型封闭枚举、新增走 ADR。
该文件 `status: confirmed`（frontmatter `:21-23`，yanbin shen，2026-07-29）。
`packages/contracts/src/provenance.ts` **已存在**。

**证据（十束各自撞到它）**
`chat/design-signoff.md:184`（X-2）· `files/coverage.md:105`（缺口 1，逐字
「phase-00 artifact 束缺口①与 identity 束缺口①说的是同一件事，**至今未收敛**…
这已是同一问题**第三次**出现」）· `templates/design-signoff.md:166`（X-6）·
`interview/design-signoff.md:162`（X-4，逐字「本束 8 份 UC 各有一条『审计态』」）·
`recording/domain.md:223`（X-9）· `agent-runtime/design-signoff.md:220`（X-4，逐字
「本束是它**最大的写入方与查询方**，不能另建一套」）·
`canvas.ts:899`（`C_CANVAS_4`：canvas 写 **12+ 种**审计事件却**零查询面**）·
`templates.ts:1429`（`T8`：审计查询**现在同时存在于三处**——本束 / `artifact.queryProvenance` /
`agent-runtime` 的两个审计操作；「usecases.md itself says these should be one unified query surface」）·
`chat.ts:1039`（`C_CHAT_5`：`queryChatAuditEvents` 在形状上复制了 provenance 查询面，
且 event type 是 open string ⇒「same surface」这条规则**没有门控**）。

**⚠ 一条必须一起处置的缺口**：`packages/contracts/src/project.ts:767`（`P3`）逐字
——`provenance.ProvenanceEventType` **没有** `project-created` / `project-archived` /
`project-unarchived` / `agenda-segment-state-changed` 四个成员，而 `project` 束的四个操作
都返回 `provenanceEventId`。**封闭枚举 + 四个无处安放的事件 = 这四条审计写不进去。**

**双向核对**
- **UC → API**：十束的 UC 都有「审计态：可按操作者/时间/对象检索」的验收，
  而 phase-01 **没有任何束提供这个查询面**（各束 coverage 逐条标「屏未建，属 17-gov」）⇒ 全部无法验收。
- **API → UC**：`chat.queryChatAuditEvents` 与 `templates.queryBlueprintAudit` 是**多余接口**
  （若 A 被采纳）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 确认 phase-00 X-2 对 phase-01 全部十束生效：**各束只声明事件类型、不建查询接口**；删/降级 `queryChatAuditEvents` 与 `queryBlueprintAudit`；按 `P3` 扩 `ProvenanceEventType` 四值（走 ADR）；并加一条门控断言「除 `provenance.ts` 外，任何束不得导出名字含 `queryAudit` / `queryProvenance` 的操作」 | 中：删两个操作 + 扩枚举 + 加门控 | 删操作触碰 `chat` / `templates` 两个已签核束 |
| B | 各束自建，事后合并 | 小 | 逐字就是 phase-00 X-2 明令禁止的形状；`files` 已记「第三次出现」 |

**推荐**：**A**。这条**成本低、收益大**：它是「已定」，人类只需确认执行方式；
而那条 grep 断言能让它以后不再复发——`files/coverage.md:105` 逐字说这已是第三次。

**风险**：`ProvenanceEventType` 是封闭枚举，扩值须走 ADR；不扩则 `project` 束四条审计无处落地。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-11 · 机密数据模型路由口径 D-U1

**合并自**：本文旧表 X-1 · `chat` X-1 / 缺口 4 · `agent-runtime` X-3 · `templates` X-4

**一句话**：这条**早就裁了**（整轮全本地），但三个已签核束里还有把它当「未裁」处理的地方，
以及**一个方向相反的错误码**。

**涉及束**：`chat`✅ · `agent-runtime`✅ · `templates`✅
**代价**：删一个错误码 = 修订已签核束的契约面 ⇒ 需重签（范围小）。

**已有答案：已定。**
`phases/requirements/DECISIONS-UI-ROUND.md:27` 逐字：
「**选择：B** — **全程本地**：本轮上下文含任何机密条目 ⇒ 整轮所有模型调用走本地。」
`:29` 执行段：「改 `modelPolicyViolation()` 的语义：不再是『有机密且无本地模型才违规』，
而是『有机密 ⇒ 云端模型在本轮不可用』…**后端 gateway 按同一规则拦截。**」

**证据（三处仍当它未裁）**
- 本文旧表 X-1（`:125`）处置栏空白，且逐字称原型「**字面自相矛盾**」（`ui-preview/README.md`
  S-01 自列为「🔴 必须先定」第一条）。
- `contracts/chat/coverage.md:144` 逐字「**裁决前 I-32 的判定函数不得写死**」
  ——那条禁令的前提（未裁）已经不成立。
- `contracts/agent-runtime/design-signoff.md:228` 单列一节：
  「⚠ X-3 单列：机密数据硬路由 D-U1 的**字面矛盾尚未解决**」。
- ⚠ **方向相反的码**：`phases/phase-01-run-a-project/REVIEW-ARCHITECT.md:81`（C-13）
  ——`CONFIDENTIAL_REQUIRES_LOCAL_MODEL` 与 D-U1 反向，建议删码。
  （D-U1 下「云端在本轮不可用」是**前置约束**，不是运行期才抛的违规码。）
- **做对了的样板**（可作对齐参照）：`contracts/chat/domain.md:250`（I-32）与 `:314-322`
  ——逐字「**两边都指向本条裁决，不各自定义一份口径**」。
- 界面证据已在：`contracts/agent-runtime/ui.md:180`
  「批准卡『含机密，仅本地模型』+ 调用链 —— S-01 / X-3 裁决的界面证据」。

**双向核对**
- **UC → API**：D-U1 要求「gateway 按同一规则拦截」，而 gateway 的拦截点**不在任何 phase-01 束的操作面上**
  ⇒ 服务端强制这一半无接口承载。
- **API → UC**：`CONFIDENTIAL_REQUIRES_LOCAL_MODEL` 是**没有 UC 要它**的错误码（D-U1 之后语义反了）⇒ 多余。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 确认 D-U1 = B 已生效：⑴ 删 `CONFIDENTIAL_REQUIRES_LOCAL_MODEL`；⑵ 解除 `chat/coverage.md:144` 的禁令，`I-32` 判定函数**只有一个实现**（写在 `chat` 束，`agent-runtime` 引用）；⑶ 补断言「除 `chat` 的策略文件外，其它文件不得出现 `modelPolicyViolation` 的**定义**」 | 小 | 删码触碰已签核束（范围小，可与 XC-07 合并重签） |
| B | 维持现状（当未裁） | 零 | 一条已裁决的规则被三个束当成未裁，实现者会各自补默认值 |

**推荐**：**A**。⚠ 这是本清单里**最典型的一条「已有答案却在被重新裁决」**
（`AGENTS.md` / `COORDINATOR-LOOP.md` 纪律 6 记的五次之外的第六次）——人类不需要重新想，只需确认执行。

**风险**：断言若写成 `toHaveLength(1)` 会成为移动靶（纪律 9）；
应写成「除某文件外不得出现该函数的**定义**」这种**性质**断言。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-12 · 可见性沿数据链路传播（六条路径共用一个判定）

**合并自**：`files` N-1 / 缺口 2 · `chat` X-4 · `recording` X-10 · `asset-governance` X-H · `research` X-B

**一句话**：phase-00 三个束独立发现同一件事并已裁决；phase-01 有五个束是它的消费者，
只需确认「不各查各的」。

**涉及束**：`files`✅ `chat`✅ `recording`✅ `asset-governance` `research`
+ phase-00 `identity`✅ `context-pack`✅ `artifact`✅
**代价**：消费侧确认，不改契约。

**已有答案：已定。**
`phase-00-shared-kernel/design-coherence.md:58` 起（X-1 裁决）：
「**六条路径（检索 / Context Pack / embedding 相似度 / 图节点遍历 / 文件浏览器 / 缓存）
必须共用同一个判定函数，判定归 `identity` 束，其余束是消费者。**」

**证据（phase-01 五个消费者）**
`files/coverage.md:106`（缺口 2，逐字「N-1 是这条约束**第一次有了可执行的双向断言**，
建议把它做成一致性复核的**验收物**」）· `chat/design-signoff.md:186`（X-4，含
「摘要取所有来源**最严格**结果，防信息洗白」）· `recording/domain.md:224`（X-10，逐字
「三处判断（对话/访谈/研究）**目前不一致，需统一**」）· `asset-governance/domain.md:300`（X-H，
逐字「本束是**消费者**」）· `research/domain.md:137`（X-B，逐字「对方是可见性的单一事实源」）。

**双向核对**
- **UC → API**：`files` 的 V1「四角色的浏览器可见集合 ≡ Context API 检索可见集合，逐一比对全相等」
  （`files/coverage.md:25`）跨 `files` × `context-pack`，**没有任何单束能跑它** ⇒ 需阶段级承接。
- **API → UC**：phase-00 `identity` 缺口 2 逐字「V10 的六条路径**没有统一入口**，
  契约只给了 `authorize`」⇒ 入口有、六条路径的接线**无契约**。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 确认 phase-00 X-1 覆盖 phase-01 五个消费者；把 `files` 的 V1 双向断言**提升为阶段级验收物**（跨 `files` × `context-pack`，四角色全跑）；`recording` X-10 点名的「三处判断不一致」按同一判定函数收敛 | 中：一条跨束集成测试 | 断言若只跑一个角色会平凡为真 |
| B | 各束各自确认 | 小 | `recording` 已经实测到三处不一致，B 不解决它 |

**推荐**：**A**（采纳 `files/coverage.md:106` 自己的建议）。
⚠ 反证：删掉判定函数里的一条路径，断言 V1 变红。

**风险**：无（不改契约）。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-13 · 快照不可删 vs 保留期到期物理删除 —— **硬阻塞**

**合并自**：`recording` `C_REC_2` / `ui.md` 红卡 · `project` X-16 · phase-00 X-4 / N-1

**一句话**：phase-00 已裁「删除豁口**只留给合规撤回**」，
那么「保留期到期物理删除」就**不在豁口内**——但它依赖的 O-39 法定留存清单**不存在**，
所以今天没有判据说哪些快照不许删。

**涉及束**：`recording`✅ · `project`✅ · `files`✅ + phase-00 `artifact`✅
**代价**：不新增触碰，但**这是本清单里唯一一条真正的外部阻塞**。

**已有答案：部分。**
- **已定（方向）**：`phase-00-shared-kernel/design-coherence.md:106` 起（X-4 裁决）
  ——「**撤回删除是不可变原则的唯一豁口，必须显式建模，不能靠『实现时再说』**」；
  边界：「只有合规撤回能删快照，且必须同时作用于 S3 与 PG」；下游「**标失效而非静默消失**（D-19）」。
  ⇒ **「保留期到期」不是合规撤回，按字面它不能删快照。**
- **阻塞未解**：同文 `:109-111` 逐字「在 O-39 给出之前，『哪些快照属于法定留存、不得删』
  **没有判据。这是真实阻塞点**」。
- O-39 的状态：`phases/requirements/DECISIONS-OPEN.md:1036-1060`
  ——推荐段逐字「**无依据，需合规负责人给出**」，只有 ④ PII 五类最小集与 ⑤ 手机号加密+掩码
  给了可执行值；**② 法定留存清单明确「必须等外部输入」**。裁决行 `:1060`「使用上面的推荐」
  ⇒ **裁决的内容就是「还没有答案」**。
- 代码侧已诚实登记：`legalHoldCategories: {known:false}`，**取值抛错而非放行**
  （`phase-00-shared-kernel/design-coherence.md:205` N-1，逐字「放行等于默认全都能删，那是更危险的默认」）。

**证据**
- 冲突登记：`packages/contracts/src/recording.ts:997`（`C_REC_2`）逐字
  「retention-expiry physical deletion vs phase-00 artifact I-11 immutable-snapshot:
  **DIRECT CONFLICT, unresolved**」；引用点 `recording.ts:843`。
- 界面已把它画出来：`contracts/recording/ui.md:210`
  「🔴 到期但删不掉红卡（I-11 / X-4 冲突，**本束最硬的待裁决项**）」、`:315`。
- `project` 侧同一豁口的另一侧：`contracts/project/usecases.md:98` 逐字
  「『归档 ≠ 删除』本身就是 X-4 豁口的**正确一侧**——豁口只留给合规撤回，
  不该被『项目结束』这种日常动作借道」。

**双向核对**
- **UC → API**：`recording` 的到期删除有完整验收（uc-5-4），而契约层**无法表达它对定版快照的例外** ⇒ 跑不通。
- **API → UC**：`RetentionParams.materialDays` 存在且可设，**没有任何东西消费它**
  ——phase-00 `auth.ts:609`（`C13`）逐字「retention-elapsed DESTRUCTION is not implemented:
  `retentionUntil` is stored and **nothing ever acts on it** (no scheduler, no purged state)」
  ⇒ 一个只写不读的字段。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **确认 phase-00 X-4 的字面结论对 phase-01 生效**：保留期到期**不删定版快照**，只删非快照材料；界面那张「到期但删不掉」红卡**是正确行为、不是待修缺陷**；把它写成不变量 + 断言（到期任务遇到 `pinned` 版本必须跳过并留痕） | 小 | 用户会看到「过了保留期还在」的对象，需要产品文案解释 |
| B | 给保留期到期也开一个豁口 | 大：改 phase-00 已签核的 I-11 | 不可变原则变成「有两个豁口」，第三个迟早出现 |
| C | 等 O-39 | 零 | **O-39 依赖外部合规输入，等不到**；`recording` 束因此无法签核 |

**推荐**：**A**。理由：⑴ phase-00 X-4 已用「**唯一**豁口」把边界定死，A 是执行不是新裁决；
⑵ B 的代价是原则失效；⑶ C 的等待期无上限。
⚠ A **不消除** O-39 缺口——它只是让 phase-01 在 O-39 缺席时有一个**安全侧默认**（不删）。
`legalHoldCategories` 必须继续**取值抛错**，不许有人给它编默认值。

**风险**：A 之后 `RetentionParams.materialDays` 对定版快照无效，
必须在同意书渲染侧说清楚，否则是对受访者的虚假承诺
（`REVIEW-REQUIREMENTS.md:104` 已记 `consent-form.tsx:127` 在渲染 `{s.sla}`）。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-14 · 撤回链两级 SLA + 六条级联闭合

**合并自**：本文旧表 X-7 · `interview` X-2 · `recording` X-6 · `research` X-C · `files` 缺口 10

**一句话**：SLA 的**数字**已定且已因两处声明漂移过一次；
现在缺的是**单一事实源的位置**与**六条级联各由谁提供失效接口**。

**涉及束**：`interview`✅ `recording`✅ `files`✅ `org-admin`✅ `research`（未签）
+ phase-00 `context-pack`✅ `artifact`✅
**代价**：不改契约形状；六环里有三环在 phase-02/03。

**已有答案：部分。**
- **数值已定**：`phases/requirements/DECISIONS-FINAL.md:86`（D-15）逐字
  「撤回**两级 SLA**：逻辑失效即时（≤5 分钟）；物理删除 ≤30 天并出回执。**废弃「24 小时」**」。
- **已发生的漂移及其更正**：`DECISIONS-UI-ROUND.md:46` 起（D-U2）逐字
  「**选择：B** —— ⚠ **本项作废，见下方更正**」，`WITHDRAWAL_FLOW` 的 02/03 按 D-15 恢复 ≤5 分钟。
- **未覆盖**：单一事实源放在哪个文件/常量；六条级联的归属与就绪顺序。

**证据**
- 本文旧表 X-7（`:131`）逐字「跨 6 个模块，**已因两处声明漂移过一次**。级联少一环 = 合规承诺是假的」。
- 三束各自要求「只引用不重复定义」：`interview/coverage.md:228`（X-2，逐字
  「**SLA 数字与级联清单必须单源**，本束只引用」）· `recording/domain.md:220`（X-6）·
  `research/domain.md:138`（X-C，逐字「**撤回链 SLA 是对方的单一事实源，本束一个天数都不复述**」
  ——**这是做对了的样板**）。
- 六环归属：`files/coverage.md:114`（缺口 10）逐字「③④⑤⑥ 依赖他模块提供失效接口：
  pgvector / FTS-Segment / `ontology_edges`(09-kg) / 缓存与 `context_packs`(00-core) /
  报告段落(10-report·13-deliv)…**任一模块不提供失效接口，AC2 就无法达成**」；
  F47 已把 ⑤ 与报告段落做成契约先行桩（+1 点）；③④⑥ 未定。
- 对外已承诺：`REVIEW-REQUIREMENTS.md:104` —— `consent-form.tsx:127` 已渲染 `{s.sla}`。

**双向核对**
- **UC → API**：`interview` 的 V7b 六条级联断言有完整验收线索，
  而**其中三条的失效接口不存在** ⇒ 跑不通。
- **API → UC**：F47 的报告段落桩（⑤）在 phase-01 有接口而下游 10-report 在 phase-02
  ⇒ 桩暂时无消费者（可接受，已登记）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **单一事实源 = `packages/contracts/src/thresholds.ts`** 的两个常量（`withdrawalLogicalInvalidationMinutes: 5` / `withdrawalPhysicalDeletionDays: 30`，`{known:true, source:"D-15"}`）；全仓加 grep 断言「撤回语境下除该文件外不得出现字面量 `5 分钟` / `30 天`」；③④⑥ **在 phase-01 建契约先行桩**（同 F47 做法），phase-02/03 接上 | 中：两个常量 + 三个桩 + 一条 grep 门控 | grep 易误报（缓解：限定在撤回相关目录） |
| B | 只在文档里指定单源 | 小 | 「有规范没脚本」——`AGENTS.md` 逐字判定为未落地 |

**推荐**：**A**。本条**已经漂过一次**，而 `research` 束「一个天数都不复述」证明了 A 可行；
`thresholds.ts` 已存在且已有 `satisfies Record<string, Threshold<unknown>>` 门控（`:210`）。

**风险**：三个桩若没有下游会变成永远绿的空转（纪律 10）——
桩必须断言「被调用时抛 `NOT_IMPLEMENTED`」，而不是返回成功。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-15 · 留存策略五参数 / 180 天的**代码级**单一事实源

**合并自**：`files` 缺口 14 / `FS7` · `recording` X-4 · `interview` X-7 · phase-00 N-4 / `auth` `C10` `C13`

**一句话**：数值早就裁了，文档单源也指定了（在 phase-03 的 UC-17.3），
但**代码里没有任何门控把两处绑在一起**，而磁盘上已经有两个 180，且门控**现在就红着**。

**涉及束**：`files`✅ `recording`✅ `interview`✅ `agent-runtime`✅ + phase-00 `auth`✅
**代价**：改 `AUTH_POLICY` 触碰 phase-00 `auth`（已签核，范围小）。

**已有答案：部分。**
- **数值已定**：`phases/requirements/DECISIONS-OPEN.md:73` 逐字
  「**裁决：材料 180 / 留痕 180 / 删除宽限 30（上限受 UC-17.2 的 ≤30 天硬约束）/
  知识有效期按资产类型 6·12·24 个月 / 审计保留期 1095 天（3 年）；区间由合规负责人收窄**」。
- **文档单源已指定**：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-3-*.md`
  的五参数表，多份 UC 回指「一律读 UC-17.3」。
- **代码级单源：未指定。**

**证据**
- `packages/contracts/src/files.ts:1244`（`FS7`）逐字：
  「**no gate ties** `RetentionParams.materialDays` back to `auth.AUTH_POLICY.orgRetentionDays` (180),
  although the latter's own comment says it comes from O-01's material retention period
  —— **a second declaration site in the making**」。
- phase-00 侧仍记为未闭合：`phase-00-shared-kernel/design-coherence.md:208`（N-4）
  ——并记录「`/consent` 上的『180 天』**曾被写死**，只要有项目配了不同值就会向受访者
  作出与实际不符的承诺；已改为显式占位 + 门控防止重新写死」。
- 消费方：`recording/domain.md:218`（X-4，逐字「本束是消费方…两处必须取同一个值」）·
  `interview/design-signoff.md:166`（X-7）· `files/coverage.md:118`（缺口 14，逐字
  「V11 的 `grep -r "180"` 断言就是防它」）。
- ⚠ **本轮已知既存红**：`pending-thresholds` 三处「180 天」硬编码
  （`.harness/state/COORDINATOR-LOOP.md:92`）——**这条约束现在就在报警**。

**双向核对**
- **UC → API**：UC-17.3 要求五参数**每组织可配**，而 phase-00 `auth.ts:595`（`C10`）逐字
  「only the 180-day default is implemented, **with no per-organization override**」⇒ 跑不通。
- **API → UC**：`RetentionParams` 在 `recording` 束可设，但没有任何 phase-01 UC 说它与
  `AUTH_POLICY` 的关系 ⇒ 两个可设点、无从属关系。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **代码级单源 = `packages/contracts/src/thresholds.ts`**：五参数各建一条 `Threshold`；`auth.AUTH_POLICY.orgRetentionDays` 与 `RetentionParams.materialDays` **都改为引用它**；`pending-thresholds` 的三处硬编码一并消除；grep 门控扩到 `apps/web` | 中：改 phase-00 `auth`（已签核，范围小） | 与 XC-14 是同一个 `thresholds.ts` 收敛，可合并做 |
| B | 只加 grep 断言不改代码 | 小 | 断言会一直红（**现在就红着**），等于把缺口固化 |

**推荐**：**A**，与 XC-14 合并为一次 `thresholds.ts` 收敛。

**风险**：改 `AUTH_POLICY` 触碰 phase-00 `auth`。⚠ 注意 `auth` 束
**从未进入任何一致性复核**（phase-00 `design-coherence.md` frontmatter 的例外记录逐字
「这不是『复核过了』，是『人类知情后决定不补做』」），它的重签窗口与 XC-02 / XC-04 / XC-07 重叠，
**建议合并**。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-16 · Context API 是唯一通路（门控**存在但没有这条规则**）

**合并自**：本文旧表 X-10 · `canvas` I-27 · `skills` I-25 · `interview` X-6 ·
`recording` X-2 · `agent-runtime` X-6 · `chat` 缺口 9

**一句话**：六个束都写了「不得直查 DB / 向量库 / 对象存储」，
而执行它的脚本虽然存在、跑在 CI 里，**却完全没有检查这件事**。

**涉及束**：`canvas`✅ `skills`✅ `interview`✅ `recording`✅ `agent-runtime`✅ `chat`✅
`research`（未签）+ phase-00 `context-pack`✅ `api-kernel`✅
**代价**：加规则不改契约。

**已有答案：部分。**
- **规则已声明**（属「设计 · 架构对齐」，非 O-nn/D-nn 裁决）：
  `phases/phase-03-reuse-and-governance/requirements/14-brain/uc-14-6-检索可审查.md:182-183`
  「不得绕过 Context API 直查 `segments`、`claims` 或向量表」，验收 V18 在 `:330-331`；
  同类声明另见 `14-brain/uc-14-1:118` · `uc-14-2:120` · `uc-14-4:162` · `uc-14-5:201` ·
  `16-persona/uc-16-1:45` · `17-gov/uc-17-3:269`。
- **归属未定**：本文旧表 X-10（`:134`）逐字「**归属门控（`lint-arch-deps`）待定**」。

**证据（本清单里最典型的「有门没规则」）**
- 脚本**真实存在且在 CI 里跑**：`.harness/scripts/lint-arch-deps.mjs`；
  `.github/workflows/backend-gates.yml:82` `node .harness/scripts/lint-arch-deps.mjs apps/api/src`。
- 但它的规则表（`.harness/scripts/lint-arch-deps.mjs:61-69`）
  **只校验 domain / application / infrastructure / interface 四层依赖方向**，
  **没有任何** `segments` / 向量库 / Context API 的检查。
- `contracts/chat/coverage.md:59`（V7c）已标 **缺口 9「门控脚本未写」**。
- 六个束各自声明它：`canvas/domain.md:195`（I-27）· `skills/domain.md:172`（I-25）·
  `interview/design-signoff.md:164`（X-6）· `recording/domain.md:216`（X-2，逐字
  「若各自直连，PII 策略与权限判定会有 **N 份**」）· `agent-runtime/design-signoff.md:222`（X-6，
  逐字「旁路取数没有 Context Pack 记录 ⇒ UC-4.4 AC1 **审计断链**」）· `research`（第零节判据）。

**双向核对**
- **UC → API**：多份 UC 的「架构态」验收逐字写的是「`lint-arch-deps` 静态检查」，
  而该规则不存在 ⇒ **验收命令会通过，但它什么都没验**（本仓九次「全绿但空转」的形状）。
- **API → UC**：无多余接口（本条是门控缺口）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 给 `lint-arch-deps.mjs` 加第二类规则：**除 `context-pack` 实现目录外，任何模块的 import 图中不得出现 pg / pgvector / S3 客户端**；范围覆盖 `apps/api/src` 全部束目录 + `packages/` | 小：一条规则 + 一份白名单 | 白名单被随手加（缓解：白名单条目必须带 ADR 编号） |
| B | 只登记为缺口 | 零 | 六个束的「架构态」验收全部空转 |

**推荐**：**A**。⚠ **必须造反证**：在某个束里 import 一次 `pg`，断言门控变红；再删掉，断言恢复绿。

**风险**：现有代码可能已有直连（A 落地会一次性红一片）——那正是它要抓的，需预留一轮修复。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-17 · `referenceForDownstream` 引用资格门 + `DownstreamPurpose` 两套词表

**合并自**：本文旧表 X-9 · `chat` X-3 / 缺口 12 / `C_CHAT_2` · `interview` X-1

**一句话**：phase-00 留了一个「下游桩不在本束」的缺口，phase-01 出现了它的第一个真实下游，
而两侧的用途词表**只共用一个字面量**。

**涉及束**：`chat`✅ · `interview`✅ · `files`✅ + phase-00 `artifact`✅
**代价**：删一个枚举或扩 `artifact` ⇒ 触碰 phase-00 `artifact` + `chat`。

**已有答案：未覆盖。**

**证据**
- `contracts/chat/design-signoff.md:185`（X-3）逐字「本束 F114 是**它的第一个真实下游**。
  必须过同一个门，**不得在对话侧自己判『是不是快照』**」。
- `contracts/interview/design-signoff.md:159`（X-1）同向：「**不得在本束另判一次**…
  D-30 会被绕过」（`interview/coverage.md:227`）。
- `contracts/chat/coverage.md:152`（缺口 12）逐字「引用资格 **12 格矩阵**的四个下游都不在本束…
  10-report / 13-deliv / 09-kg / 14-brain **各自都要过同一个 `referenceForDownstream`**，不各判各的」。
- **词表不齐**：`packages/contracts/src/chat.ts:1009`（`C_CHAT_2`）逐字
  「`ChatDownstreamPurpose` (4) and `artifact.DownstreamPurpose` (5) **share only one literal**;
  **no translation table exists** though I-34 requires delegating to artifact's gate」
  ⇒ 「委派给 artifact 的门」这条不变量**在实现层无法执行**：入参对不上。

**双向核对**
- **UC → API**：`chat` 的 8-3 V1 要求「引用资格 12 格矩阵」逐格可验，
  而四个下游都不在 phase-01 ⇒ 只有 1/4 能验。
- **API → UC**：`ChatDownstreamPurpose` 里 artifact 侧没有的那 3 个值 ⇒ 要么多余，要么 artifact 侧缺值。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **`artifact.DownstreamPurpose` 是唯一权威**：删 `ChatDownstreamPurpose`，`chat` 直接**引用**（同 `project.ts:596-597` 引用 `ArtifactSource` 的做法）；若 chat 侧 3 个值确有业务，按扩值走 ADR 加进 `artifact`。同时加断言：任何声明 `downstreamPurpose` 的操作，其实现必须调用 `artifact.referenceForDownstream`（import 图断言） | 中：删一个枚举 + 可能扩 `artifact`（已签核） | 扩 `artifact` 需重签 |
| B | 保留两套 + 写翻译表 | 小 | 翻译表把「第二份声明」正规化；`C_CHAT_2` 逐字说缺的不是表而是 delegating |

**推荐**：**A**。`project.ts:596` 已有「**引用**不抄一份」的逐字样板。

**风险**：扩 `artifact` 与 XC-03 是同一个重签窗口，**建议合并**。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-18 · 同意项：四项 vs 三项，仓库里三个版本

**合并自**：本文旧表 X-12 · `interview` `C_ITV_2` · `recording` X-7 / S-09

**一句话**：同意项在仓库里有三个互相冲突的版本，
且其中一项（「交给 AI 分析」）**在已建成界面里不存在**，而 O-05 的全部合规约束挂在它上面。

**涉及束**：`interview`✅ · `recording`✅ · `org-admin`✅
**代价**：统一即改两个已签核束的枚举 ⇒ 重签（且要重出截图）。

**已有答案：未覆盖。**

**证据**
- `packages/contracts/src/interview.ts:1594`（`C_ITV_2`）逐字：
  「consent bits declared twice: interview's **4 keys** vs recording's **3 items**;
  first three are **the same fact with no gate between them**」。
- 本文旧表 X-12（`:136`）逐字：三个版本 = UC-6.3 拍板版 / `lib/mock/interview.ts` 旧版 /
  `lib/mock/entry.ts` 三项版；且「『交给 AI 分析』这一项**在已建成界面里不存在**，
  而 **O-05 的全部合规约束挂在它上面**」；
  **两份都是手写 mock**——`contract-design.md` 硬规则第 2 条防的就是这件事，**而它已经发生了**。
- `recording` 侧的第四种拆法：`contracts/recording/ui.md:291`（S-09）
  ——「录音✓ / 转写✓ / 引述✓ / 内部复用✗，**实名引用作为独立开关**（拒绝 → 用代称）」，
  而 `contracts/recording/domain.md:221`（X-7）逐字「本束的 `Track.consentState` 必须读同一份
  授权项定义，**不得自己拆**」。
  ⇒ **X-7 说不得自己拆，而 S-09 就是本束自己拆的那一份。**

**双向核对**
- **UC → API**：O-05 的合规约束（「交给 AI 分析 = 否 ⇒ 不进 Context Pack 自动填充」）
  有完整验收（`interview/coverage.md:198` V8），而**界面上没有这个开关** ⇒ 用户无法设置它。
- **API → UC**：`recording` 的「实名引用」独立开关没有 UC 要它 ⇒ 多余（或 UC 缺失）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **UC-6.3 拍板版（4 项）是唯一权威**，落成 `packages/contracts` 里一份 `ConsentKeys` 封闭枚举；`recording.Track.consentState` **引用**它；两处手写 mock 改由 `packages/contracts/scripts/gen-mock.ts` **生成**（该脚本**已存在**）；界面补「交给 AI 分析」开关 | 中：改两个已签核束 + 补一个界面开关 | 界面补开关 ⇒ 第 ① 件 UI 材料要重出截图 |
| B | 保留三版，各自加注释 | 零 | O-05 的合规约束继续挂在一个不存在的开关上 |

**推荐**：**A**。关键在于**用生成代替手写**：`contract-design.md` 硬规则第 2 条禁的就是手写 mock，
而 `gen-mock.ts` 已在仓库里——这条不需要新造机制，只需要**接上**。
⚠ S-09 的「实名引用」是否作为第 5 项，需在裁决时一并回答（**无出处，需人裁**）。

**风险**：界面补开关会让 `ui-preview/itv*` 与 `rec*` 的相关截图失效，
需重出并过 `node .harness/scripts/lint-ui-material.mjs`。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______  （「实名引用」是否为第 5 项： ☐ 是 ☐ 否）

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-19 · 三粒度 AI 写权限求交（模板级 / 项目级 / 画布级）

**合并自**：`canvas` `C_CANVAS_1` · `agent-runtime` I-38 / `AR10`

**一句话**：求交语义本身已裁（取交集、收紧优先、不可被下层放宽），
但**模板级那一档从来没进过裁决**，且三个项目级开关的**默认值**未裁。

**涉及束**：`canvas`✅ · `templates`✅ · `agent-runtime`✅ · `project`✅
**代价**：补一档不改已签核契约形状（`SectionDef` 已存在）。

**已有答案：部分。**
- **已定（求交语义）**：`phases/requirements/DECISIONS-OPEN.md:655`（O-23）逐字
  「**裁决：合成规则 = 取交集（收紧优先），且不可被下层放宽**」；
  不变量落点 `contracts/agent-runtime/domain.md:401`（I-38：组织/agent ∩ 项目 ∩ 画布/线程，**服务端求交**）。
- **未覆盖（模板级）**：`packages/contracts/src/canvas.ts:869`（`C_CANVAS_1`）逐字
  「three-granularity AI write permission (section/project/canvas) **has no defined intersection
  semantics; only canvas-level is contracted**」。O-23 讲的是「MCP × 白名单 × 任务权限包」
  + 项目三开关，**不含模板分区（`SectionDef`）这一档**。
- **未覆盖（默认值）**：`contracts/agent-runtime/domain.md:401` 逐字「默认值不在本不变式内——**O-23 未裁**」；
  `packages/contracts/src/agent-runtime.ts:2342`（`AR10`）逐字
  「the three project-level AI switch defaults are **deliberately absent**; they live in
  `thresholds.ts` as `known:false` **after the F58 fabricated-source retraction**」。
- ⚠ **这是已经出过事的一类**：`ui-preview/PROTOTYPE-SWEEP-UI.md` P-05 记「默认值画反」
  （项目级 AI 开关：我们全关、原型多为开），`COORDINATOR-LOOP.md:43` 逐字「**看截图看不出来**」。

**双向核对**
- **UC → API**：模板分区级的 AI 写权限在 UI 与 `SectionDef` 里都存在，
  **契约层无求交语义** ⇒ 跑不通。
- **API → UC**：`SectionDef` 的写权限字段无 UC 定义它与另外两档的关系 ⇒ 半悬空。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 把 O-23 的「取交集、收紧优先、不可被下层放宽」**扩到第四档（模板分区）**，写成 I-38 的补充：`最终权限 = 组织/agent ∩ 模板分区 ∩ 项目 ∩ 画布/线程`，**服务端一次求交**；默认值继续 `known:false` **取值抛错**，由产品给出后填 | 小：一条不变量 + 一处求交实现 | 默认值不定 ⇒ 界面无法给出「默认状态」截图（可接受：抛错优于编默认值） |
| B | 模板级不参与求交（只作展示默认） | 小 | 模板作者以为自己关了 AI 写、实际没关 —— **安全侧错误方向** |

**推荐**：**A**。O-23 的裁决理由是「收紧优先」，把新一档纳入求交与该理由完全一致，属执行不属新裁。
⚠ **默认值绝不许编**：F58 已因「编造来源」被撤回过一次（`AR10` 逐字点名）。

**风险**：四档求交若在客户端做就可被绕过——I-38 已写明**服务端求交**，须加断言。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-20 · 任务权限包分级：**R0 存在吗**（原型与档案正面冲突）+ 第③层归属

**合并自**：本文旧表 X-4 · `agent-runtime` X-1 · `SCOPE-DELTA-2026-07-30` · `PROTOTYPE-SWEEP-UI` `isDwPerm`

**一句话**：档案裁决逐字只有 R1/R2/R3，原型画的是 `R0–R1` / R2 / R3 三行
——而本仓的纪律是「**原型是权威，UC 文档是次级**」，这条冲突不能靠引用纪律自动解决。

**涉及束**：`agent-runtime`✅ · `org-admin`✅ · `skills`✅
**代价**：若加 R0 ⇒ 修订已签核的 `agent-runtime`。

**已有答案：已定（档案侧），但与原型冲突。**
- `phases/requirements/DECISIONS-FINAL.md:59`（D-28）逐字：
  「风险分级 **R1/R2/R3** 按操作类型自动推导（如外发邮件恒 R3、读公开资料恒 R1），任务模板可覆盖」
  ——**没有 R0**。
- 冲突已登记未裁：`phases/phase-01-run-a-project/requirements/SCOPE-DELTA-2026-07-30.md:203,214,218-219`
  逐字「原型把 R0 与 R1 并成一格（`R0–R1`），即**存在 R0 这一档**…`DECISIONS-FINAL.md:59`（D-28）
  逐字：R1/R2/R3…**没有 R0**」。
- 原型证据：`ui-preview/PROTOTYPE-SWEEP-UI.md:98`（`isDwPerm`，原型偏移 **15,988,841**，
  「按风险分级 R0–R1 自动、R3 需人批」）、`:103`（建议与 `agent-runtime` 枚举收敛为单一事实源）。
  ⚠ `isDwPerm` **全仓只有 3 处命中，全在文档；代码里没有它。**
- 完整规则表也未给：`DECISIONS-OPEN.md`（O-26）逐字「D-28 已定…但**完整规则表从未给出**」，
  裁决行为「使用上面的推荐」（表本身仍待产品 + 合规出）。

**证据（第③层归属）**
`contracts/agent-runtime/design-signoff.md:217`（X-1）逐字
「三层权限求交的第 ③ 层（任务权限包 R1/R2/R3）…**第 ①② 层在本束，第 ③ 层不在**。
三层是**一个**判定函数，分两处实现就是第 N 次『同一事实两处声明』」；
`contracts/agent-runtime/usecases.md:356` 逐字「权限包的**实现**属 00-core / 11-board（X-1），
本束只暴露申请接口」——**而 `11-board` 在 phase-01 不存在。**
本文旧表 X-4（`:128`）同；`contracts/agent-runtime/coverage.md:277`（缺口 13）同。

**双向核对**
- **UC → API**：`agent-runtime` 的申请接口存在，而**权限包的判定实现被指给一个不存在的束**
  ⇒ 三层求交跑不通。
- **API → UC**：无多余接口。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **以 D-28 为准（R1/R2/R3，无 R0）**：原型那格 `R0–R1` 判为**展示合并写法**，并在 `SCOPE-DELTA` 里留痕说明为何这次不按「原型优先」；第③层判定**归 `agent-runtime` 本束**（phase-01 没有 11-board，判定不能挂在不存在的束上），`org-admin` 只提供角色输入 | 小：改一处归属 + 留痕 | 违反「原型是权威」纪律 ⇒ **必须由人类裁，agent 不能自决** |
| B | 加 R0（四档），修订 `agent-runtime` | 中：重签 | D-28 是人类裁决，改它属推翻已裁 |

**推荐**：**A**。理由：⑴「原型是权威」这条纪律的事故背景是 `itv` v1 **读文档不读原型导致
44 张截图整套推翻**——那是「文档编造了原型没有的东西」；本条相反，是**人类裁决明确排除了
原型里的一档**，属该纪律的例外面；⑵ `isDwPerm` 在代码里根本不存在，A 的落地成本为零。
⚠ 本条**触碰人类已明确裁决过的事（D-28）的解释**，按 `COORDINATOR-LOOP.md:20`
属「必须问人类」的两类例外之一 —— 所以它在这张清单上，而不是被 agent 自决。

**风险**：若人类认为原型的 R0 是真实需求，A 会丢一档。
缓解：裁决时同时确认 O-26 的完整规则表由谁出、什么时候出。

##### 裁决
- [ ] 采纳推荐（A：R1/R2/R3，第③层归 `agent-runtime`）
- [ ] 选 __（B：加 R0）
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-21 · 归档语义在四处各裁一次 + Context Pack 不按项目状态过滤

**合并自**：`project` X-16 / X-18 / U-2 · `templates` X-7 · `research` `R5` · `project.ts` `P7`

**一句话**：四类对象的归档各裁过一次，而**项目归档的四个连带行为**里有一条是真缺口：
归档项目的内容会继续被检索召回，**且没有任何门控会变红**。

**涉及束**：`project`✅ `templates`✅ `canvas`✅ `skills`✅ `research`（未签）+ phase-00 `context-pack`✅
**代价**：`QueryContext` 加一个可选字段 ⇒ 触碰 phase-00 `context-pack`（向后兼容）。

**已有答案：部分。**
- **已定（各类归档）**：O-10 / O-11 / O-18 分别裁的是**画布模板 / skill / 蓝本**；
  项目归档由 Q-5 裁 B。⚠ `contracts/project/domain.md:338` 逐字
  「`DECISIONS-OPEN.md` 的 O-10 / O-11 / O-18 三条归档裁决**分别是画布模板 / skill / 蓝本的**，
  **没有一条说项目**」。
- **未覆盖（四个连带行为）**：同处逐字——⑴ 可逆？⑵ 进行中的环节怎么办？⑶ 归档容器的 artifact
  还能被下游引用？⑷ Context Pack 召回吗？
  「⑴ 原型已答（间接）…**⑵⑶⑷ 未覆盖**」，且 `PROTOTYPE-ANSWERS.md` Q-5 逐字
  「原型只把『已归档』当一个展示标签，**没有演示归档后的任何行为**」。

**证据（⑷ 是真缺口）**
- `contracts/project/design-signoff.md:310`（X-18）逐字：「⚠ **归档既已裁定成立（Q-5 B），
  这条就从『假设』变成了『真缺口』**：现在没有任何地方说 Context Pack 要按状态过滤，
  而**它不会让任何门控变红**」；出处 `contracts/../context-pack/domain.md:33`。
- `contracts/project/coverage.md:120`（G-6）与 `MIGRATION-IMPACT.md:275` 同。
- `contracts/project/domain.md:500` 逐字把「照旧召回（不过滤）」列为
  「⚠ 这就是 X-18 记的**真缺口**：归档项目的内容会继续出现在检索结果里，
  而**没有任何门控会变红**」。
- 跨束回边：`contracts/templates/design-signoff.md:167`（X-7）逐字「归档后**存量绑定仍可实例化**…
  画布侧的实例化必须**只查绑定版本、不查蓝本当前状态**。⚠ **做反了会让进行中的工作坊
  切议程环节时当场失败**」。
- **做对了的样板**：`packages/contracts/src/research.ts:1035`（`R5`）逐字
  「No source for whether archiving is reversible in this bundle;
  `project.unarchiveProject` exists only because U-2(1) ruled it. **Deliberately not copied**」。

**双向核对**
- **UC → API**：U-2⑵ 已裁「有 `active` 环节时拒绝归档」，但**没有错误码**
  ——`packages/contracts/src/project.ts:794`（`P7`）逐字
  「U-2(2) ruled 'reject archiving while a segment is active' but **deliberately left the failure
  code unnamed**; `archiveProject.err` **cannot express it**」⇒ 跑不通。
- **API → UC**：`unarchiveProject` 在契约里存在**只因为 U-2⑴ 裁了**，
  而 `contracts/project/domain.md:338` 逐字说 `UC-P4`「现在**不成立**，留名只为标洞」⇒ 有 API 无 UC。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 采纳 `domain.md` U-2 的四条推荐：**⑴ 可逆（`unarchiveProject` 存在）· ⑵ 拒绝归档（补错误码，如 `SEGMENT_ACTIVE`）· ⑶ 能引用（仍受 I-14 只能引 `pinned` 约束）· ⑷ 默认不召回、可显式请求**；`QueryContext` 加 `includeArchivedProjects?: boolean`（默认 false）；补 UC-P4 | 中：改 phase-00 `context-pack`（加一个可选字段，向后兼容） | 仍属修订已签核束 |
| B | ⑷ 照旧召回 | 零 | `domain.md:500` 逐字判定为真缺口且无门控 |

**推荐**：**A**。⑷ 的默认必须是**不召回**。
⚠ **反证**：建一个归档项目 + 一条内容，断言默认检索**查不到**；
把 `includeArchivedProjects` 置 true，断言查得到。**两个方向都要断**，否则又是空转。

**风险**：⑵ 与 Q-2② 的四态耦合——四态里**没有**「因容器归档而终止」这一档
（`domain.md:338` 逐字），A 需要同时确认这一点。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-22 · 快照语义不得分叉（蓝本版本 / 实例固化 / skill 锁定 / 访谈脱钩）

**合并自**：本文旧表 X-13 · `templates` X-9 · `interview` X-1 · `canvas` V10/V5b/V16

**一句话**：四个束各写一遍「快照不漂移」，只要有一份漏了就是数据损坏；
phase-00 已经有权威定义，这里只需确认「引用不复述」。

**涉及束**：`templates`✅ `skills`✅ `canvas`✅ `interview`✅ + phase-00 `artifact`✅
**代价**：消费侧确认。

**已有答案：已定。**
phase-00 `artifact` 束的 I-8 / I-11（版本不可变）+ D-30（正式引用只能指向固定快照）。
`contracts/templates/design-signoff.md:169`（X-9）逐字
「不能出现『蓝本版本可变但 artifact 版本不可变』的分叉」。

**证据**
本文旧表 X-13（`:137`）逐字「四个束各写一遍『快照不漂移』，四份实现只要有一份漏了就是数据损坏」·
`contracts/interview/design-signoff.md:159`（X-1）· `skills` 的 UC-3.4 版本锁定 ·
`contracts/canvas/coverage.md:38,58,84`（V10 / V5b / V16：「再存新版本旧 SHA 不变」
在**三份 UC 里各写了一遍**）。

**双向核对**
- **UC → API**：四束的「快照不漂移」验收都指向 `artifact_versions`，接口齐备 ⇒ 通。
- **API → UC**：无多余接口。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 确认 phase-00 I-8 / I-11 / D-30 是唯一定义；四束的相应不变量改为**引用**（注释指向 phase-00），并加一条 import 图断言「只有 `artifact` 实现版本不可变检查，其余束不得自建」 | 小 | 无 |
| B | 各束各写 | 零 | 四份实现，漏一份即数据损坏 |

**推荐**：**A**。本条**成本最低、可先清**。

**风险**：无。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-23 · file-first 与删除传播：文件浏览器不是权限旁路

**合并自**：本文旧表 X-8 · `chat` X-5 · `recording` X-1 · `interview` X-5 · `canvas` 缺口 2

**一句话**：**五份 UC 各自重复写了同一条**——重复本身就是它会被实现两遍的信号。

**涉及束**：`recording`✅ `canvas`✅ `chat`✅ `files`✅ `interview`✅ + phase-00 `artifact`✅
**代价**：消费侧确认。

**已有答案：已定。**（判权单源在 phase-00 `identity`，见 XC-12；file-first 版本模型在 phase-00 `artifact`。）

**证据**
- 本文旧表 X-8（`:132`）逐字「五份 UC 都各自重复写了『文件浏览器不是权限旁路』
  ——**重复本身就是它会被实现两遍的信号**」。
- `contracts/chat/design-signoff.md:187`（X-5）逐字「落点只能有一套 `acl_bindings`；
  文件侧若自建判权就等于**开了后门**」；`contracts/chat/coverage.md:150` 同
  （逐字「**五份 UC 全都重复写了这条**——这是它容易被两处各实现一遍的信号」）。
- `contracts/recording/domain.md:215`（X-1）逐字「本束**不得**另建索引表。
  目录结构与命名对外可见即契约」。
- `contracts/interview/design-signoff.md:163`（X-5）· `contracts/canvas/coverage.md:37,58,84`（缺口 2）。

**双向核对**
- **UC → API**：五束的「三文件可见可下载 + 删除时真消失」都靠 `files` 束的文件树，接口齐备。
- **API → UC**：`recording` 若另建索引表就是多余接口（目前**没有**，A 只是把它钉住）。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 确认「一套 `acl_bindings`、一个文件索引」；加断言：`files` 之外的束**不得**声明文件索引表；`files` 的列表 / 预览 / 下载 / 导出四条路径**必须**调用 `identity.authorize`（import 图断言） | 小 | 无 |
| B | 各束自查 | 零 | 五处重复 ⇒ 至少一处会自建判权 |

**推荐**：**A**，与 XC-12 的断言合并成一次。

**风险**：无。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-24 · 「综合 Studio」——已签核束里一个通往未定义目的地的出口

**合并自**：`research` X-D / 缺口 7 / Q-11

**一句话**：一个**已签核**的束里有一个按钮，它的目的地在任何 phase 都不存在。

**涉及束**：`interview`✅ · `research`（未签）
**代价**：删按钮 = 改已签核束的 UI 材料 ⇒ 需重签第 ① 件（范围极小）。

**已有答案：未覆盖。** 六份 `phases/requirements/DECISIONS-*.md` 对「综合 Studio」**零命中**。

**证据**
- 已落库的出口：`apps/web/lib/mock/itv.ts:888`
  `export const INSIGHT_REPORT_EXPORTS = ["生成报告草稿", "导出 PDF", "送入综合 Studio"];`
  ——属**已签核**的 `interview` 束。
- 结论逐字「在任何 phase 都不存在」：`contracts/research/domain.md:139`（X-D，逐字
  「⇒ **一个已签核的束里已有一个通往未定义目的地的出口**…**本束不裁，登记给复核**」）·
  `:156`（「**不定义**『综合 Studio』」）· `contracts/research/coverage.md:103,167`（缺口 7）·
  `requirements/24-research/uc-24-3-*.md:73,76,125` ·
  `requirements/24-research/OPEN-QUESTIONS.md:165-186`（Q-11，「**选择：**」栏空白；
  该文件头 `:7` 逐字「状态：**全部未裁**」）。
- feature 侧已显式不实现：`phases/phase-01-run-a-project/feature_list.json:3302` 逐字
  「「送入综合 Studio」**在任何 phase 都不存在**（Q-11 / X-D，且 `interview` 束已签核却已有这个按钮）
  ——**不实现**」。

**双向核对**
- **UC → API**：该按钮有界面、无 UC、无 API ⇒ 点了之后**没有任何东西接**。
- **API → UC**：不适用。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **删掉这个出口**（从 `INSIGHT_REPORT_EXPORTS` 移除），并在 `contracts/interview/ui.md` 记一句「该出口已于本次一致性复核删除，理由：目的地未定义」 | 小：改一处 mock + 重出一张截图 | `interview` 束第 ① 件要重签（范围极小） |
| B | 定义「综合 Studio」是什么 | 大：新一个能力域（第十三束） | phase-01 已从九束扩到十二束 |
| C | 保留按钮 + 置灰 + 「即将推出」 | 小 | 一个永远不来的「即将推出」；且 `research` 束会照抄这个出口 |

**推荐**：**A**。理由：⑴ `feature_list.json:3302` 已决定不实现，**界面上留着它就是对用户撒谎**；
⑵ B 违背 L1「尽可能少返工地进入开发」；⑶ C 会被 `research` 复制，变成两个死出口。

**风险**：若「综合 Studio」其实是 phase-02 的 `09-kg` / `10-report` 的别名，
A 会删掉一个真实需求的入口——**裁决时请一并确认它是不是这两者之一**（这是本条唯一的未知）。

##### 裁决
- [ ] 采纳推荐（A：删出口）
- [ ] 选 __
- [ ] 其它：______  （若「综合 Studio」= phase-02 的 09-kg / 10-report，请在此注明）

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-25 · skill 硬删除落成「提供但恒拒」，与 N-5 先例方向相反；三束三种做法

**合并自**：`skills` `S1` · phase-00 N-5 · `research` `RESEARCH_FORBIDDEN_ROUTES` · `project` I-P40 / Q-9

**一句话**：「这个操作不许做」这件事，仓库里现在有**三种**表达方式，
而 phase-00 已经为它裁过一次。

**涉及束**：`skills`✅ · `research`（未签）· `project`✅ + phase-00 `identity`✅
**代价**：改 `skills` 的操作面 ⇒ 重签（范围小）。

**已有答案：部分。**
- **已定（先例）**：`phase-00-shared-kernel/design-coherence.md:209`（N-5）逐字
  ——「『删除组织』API 提供与否」✅ 已关闭（2026-07-29）：**取「不提供」**。补
  `no-forbidden-routes.test.ts` 断言路由表里确实没有它——「**『没有』这件事本身没人会去验**，
  某天有人为别的需求加上，不会有任何东西报警；这个测试就是那个警报」。
  同时禁掉 `DELETE /artifacts/*/versions` 与 `PUT/PATCH/DELETE /provenance`。
- **未覆盖（skill 硬删除本身）**：无任何 `D-*` / `O-*` / `Q-*` 对它拍板。

**证据（三束三种做法）**
| 束 | 做法 | 出处 |
|---|---|---|
| phase-00 `identity` ✅ | **不提供路由** + `no-forbidden-routes` 断言 | `phase-00-shared-kernel/design-coherence.md:209`（N-5） |
| `skills` ✅ | **提供接口但恒拒**（`out: never`；`err: HARD_DELETE_FORBIDDEN \| BUILTIN_NOT_DELETABLE`） | `contracts/skills/usecases.md:316-325`（逐字「这个用例**只有失败出口**」）；`packages/contracts/src/skills.ts:1262`（`S1`）逐字「**contradicts N-5's ruling** that 'do not provide the API' beats 'provide but always reject'; flagged for the signer」 |
| `research`（未签） | **不提供路由** + `RESEARCH_FORBIDDEN_ROUTES` 常量 + 断言 | `packages/contracts/src/research.ts:544-549`（N-7；注释逐字「原型 handler 叫 `delDrItem` 但提示逐字是『已归档』，**照名字实现就会造出删除**…这条断言就是那个警报」） |
| `project` ✅ | 照抄 N-5（Q-9 裁「不提供删除」），但 `00-project/OPEN-QUESTIONS.md:81` 的裁决行**仍是空白** | `contracts/project/domain.md:95`（I-P40） |

**双向核对**
- **UC → API**：`skills` 的 V3 / V7 断言「硬删入口不存在（正确）」（`contracts/skills/coverage.md:90,94,196`），
  而契约里**入口是存在的**（只是恒拒）⇒ **验收与契约互相矛盾**。
- **API → UC**：`hardDeleteSkill` 是一个 `out: never` 的操作 ⇒ 按 N-5 的口径它是多余接口，
  且在 OpenAPI 上是可见的攻击面。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **统一到 N-5 口径**：删 `skills.hardDeleteSkill`，改为 `SKILLS_FORBIDDEN_ROUTES` 常量 + `no-forbidden-routes.test.ts` 断言（照 `research.ts:544` 的形状）；并请人类补勾 `00-project/OPEN-QUESTIONS.md:81` 的 Q-9 裁决行 | 小：删一个操作 + 加一条断言 | `skills` 束重签（范围小） |
| B | 反向统一到「提供但恒拒」 | 中：改 phase-00 与 `research` | 推翻 N-5；且 `out: never` 的路由在 OpenAPI 上可见 |

**推荐**：**A**。N-5 的裁决理由（「『没有』这件事本身没人会去验」）
在 `research.ts:544` 已被**独立复现一次**——两束独立得出同一结论。
⚠ 同时确认：`BUILTIN_NOT_DELETABLE`（内置 skill 不可删）**不属于**本条
——那是一条业务规则，对应的路由（`disableSkill`）本来就该存在，只是对内置拒绝。

**风险**：删操作后 `contracts/skills/coverage.md` 的 V3 / V7 要改断言形态
（从「调用返回错误」改为「路由不存在」）。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-26 · 资产复核时钟 vs MCP 14 天隔离期；到期规则与 `14-brain` 是同一条规则

**合并自**：`asset-governance` X-A / X-B / `AG3` / Q-6 / Q-7

**一句话**：MCP 也是六种资产之一，现在它头上要挂**两套计时器**；
而资产复核到期规则与组织大脑知识条目到期规则，原型逐字说是**同一条**。

**涉及束**：`asset-governance`（未签）· `agent-runtime`✅（F52–F54）+ phase-03 `14-brain`
**代价**：串行化 ⇒ 触碰已签核的 `agent-runtime`。

**已有答案：未覆盖。**（Q-6 / Q-7 均在 `23-asset/OPEN-QUESTIONS.md`，裁决行空白。）

**证据**
- `contracts/asset-governance/domain.md:294`（X-B）逐字「**复核周期 ↔ MCP 14 天隔离期**
  —— MCP 也是六种资产之一，两套计时器还是一套…Q-6 推荐**串行**（隔离期 → 首次复核 → 常规周期）。
  ⚠ **采纳可能触发 `agent-runtime` 重签**」。
- `:293`（X-A）逐字「**复核到期/降级规则 ↔ 组织大脑知识条目到期规则**
  —— 原型逐字『**与组织大脑里知识条目的规则一致**』…**必须单一事实源**。
  Q-7 推荐抽到 phase-00『可复核资源』概念。⚠ **不裁就实现 = 第九次同一事实两处**」。
- `:47` 同一登记：「组织大脑知识条目的到期规则**本体** → `14-brain`（phase-3）
  ——⚠ 与本束是**同一条规则**」。
- 契约侧已诚实回避（做对了）：`packages/contracts/src/asset-governance.ts:616`（`AG3`）逐字
  「the single definition site for the review-clock rule (three cycles + the 30-day downgrade)
  is undecided and is shared with `14-brain` (phase-3); this bundle is the consumer and
  **deliberately does not encode the number**」。

**双向核对**
- **UC → API**：`uc-23-6` 的复核到期验收需要一个周期值，而本束**故意不编码它** ⇒ 无法验收
  （这是正确的克制，不是缺陷）。
- **API → UC**：无多余接口。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **Q-6 = 串行**（MCP：14 天隔离期 → 首次复核 → 常规周期，两个计时器**首尾相接不并行**）；**Q-7 = 规则本体抽到 phase-00 的「可复核资源」概念**，`asset-governance` 与 `14-brain` 都是消费者；数值继续 `thresholds.ts` `known:false` | 中：phase-00 新增一个概念（走 ADR）+ `agent-runtime` 的隔离期改为「串行链第一段」⇒ 重签 | phase-00 再增内容 |
| B | 两套计时器并存 | 零 | MCP 可能在隔离期未满时进入常规复核周期，**两个状态机互相覆盖** |
| C | Q-7 以 `14-brain`（phase-03）为单源 | 小 | phase-01 依赖一个 phase-03 才存在的定义 ⇒ **与 XC-03 的 X-E 同形**（已签束依赖不存在的束），本仓已因此出过问题 |

**推荐**：**A**。理由：⑴ C 会复制 `files` 依赖 `research` 那个**已经出过问题**的形状；
⑵ B 是两个状态机互相覆盖，属数据损坏级；⑶ A 的 phase-00 抽象成本一次性。

**风险**：A 触碰 `agent-runtime`（已签核，F52–F54）——与 XC-05 / XC-07 / XC-20 是同一个重签窗口，
**建议合并**。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-27 · Q-0 派生：`AssetDirectory` 多文件 vs `Skill.fileCount` 恒 1；`AssetProvenance` vs `Skill.source`

**合并自**：`asset-governance` X-D / X-E / `AG4` / `AG6` / Q-10

**一句话**：`asset-governance` 与已签核的 `skills` 在**两个字段上正面冲突**，
其中一个是 Q-0 自己点名的「与已签核内容最硬的一处」；
另有**一个故意留着的洞**：六道落地门可经编辑器旁路。

**涉及束**：`asset-governance`（未签）· `skills`✅
**代价**：推荐 A **一处都不动 `skills`**；候选 B 才需重签。

**已有答案：部分。**
- **已定（上层）**：Q-0 裁方案 C（拆），`23-asset/DECISION-Q0.md:1-6`；且逐字「本裁决**不推翻 D-06**」。
- **未覆盖（两个字段）**：`23-asset/OPEN-QUESTIONS.md` 的 Q-10 / Q-1b 裁决行空白。

**证据**
- `contracts/asset-governance/domain.md:297`（X-E）逐字「**`AssetDirectory` 多文件 ↔
  `Skill.fileCount` phase-1 恒为 1**（已签核，且注明『**不得据此实现打包解析**』）…**Q-0**。
  **这是本束与已签核内容最硬的一处冲突**」。
- `:296`（X-D）逐字「`AssetProvenance` ↔ `Skill.source`（**已签核封闭五值，I-11 不可写入**）…
  Q-10 推荐 **C（正交新字段）**」。
- 适用范围本身未知：`packages/contracts/src/asset-governance.ts:622`（`AG4`）逐字
  「the `AssetDirectory` port group has evidence for **only 2/6 kinds** (skill, agent);
  whether model / mcp / canvas-template / blueprint are directory-shaped is [待确认],
  so **its applicable range is unknown**」。
- ⚠ **故意留着的洞**：`packages/contracts/src/asset-governance.ts:636`（`AG6`）逐字
  「I-25 (re-run gate 02 after `WriteAssetFile`) is **not a side effect of any port here**;
  the six landing gates can therefore be **bypassed post-import via the editor**.
  **Known hole, deliberately left open pending human confirmation**」
  ——**编辑器是六道落地门的旁路**，必须和本条一起裁。

**双向核对**
- **UC → API**：`uc-23-3` 的多文件编辑有完整验收，而 `Skill.fileCount` 恒 1 ⇒ skill 类资产跑不通。
- **API → UC**：`AssetDirectory` 对 4/6 种资产类型**没有 UC 依据**（`AG4`）⇒ 适用面比 UC 宽。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **X-E**：`Skill.fileCount` 恒 1 是 D-06 的直接后果（phase-1 不做多文件可执行包），按 Q-0 方案 C，`AssetDirectory` 的**多文件形态整体属 phase-2**，phase-1 只保留单文件路径 ⇒ **一处不动 `skills`**。**X-D**：采纳 Q-10 的 **C**（`AssetProvenance` 作为**正交新字段**，不写 `Skill.source` 的封闭五值）。**AG4**：`AssetDirectory` 显式限定为 skill + agent 两类。**AG6**：编辑器写入后**必须重跑第 02 关**，作为端口副作用写进契约 | 中：四处收敛 | 与 XC-09 的推荐 B（试跑台移 phase-2）方向一致，可一起做 |
| B | 修订 `skills.fileCount` 允许 >1 | 大：重签 `skills`，且与 D-06 冲突 | D-06 是人类 2026-07-27 拍板，改它属推翻已裁 |

**推荐**：**A**。它**一处都不动已签核的 `skills`**，而 B 要同时推翻 D-06。
⚠ **AG6 必须一起补**：不补的话六道落地门形同虚设（导入时过门、导入后编辑绕过）
——这正是 `AGENTS.md` 纪律 10 说的「宁可红，不可假绿」的反面：一道**看起来存在的门**。

**风险**：A 之后 `uc-23-3` 的多文件编辑验收在 phase-1 无处落地 ⇒ 须**显式标 phase-2**，不得静默删。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-28 · 资产查重相似度 68% vs O-35「不用分数、改用结构性断言」

**合并自**：`asset-governance` X-F / X-G · `agent-runtime` `AR9`

**一句话**：`asset-governance` 的第 04 关用相似度打分做查重，
而 O-35 已经裁过「质量阈值一律不用分数」——**两者是不是同一件事，必须在这里裁**。

**涉及束**：`asset-governance`（未签）· `skills`✅ · `agent-runtime`✅
**代价**：不触碰已签核束（只改未签束的实现形状）。

**已有答案：已定（方向）。**
`phases/requirements/DECISIONS-OPEN.md:930` 起（O-35），推荐段逐字
「**质量阈值一律不用分数，改用结构性断言**（如『每条洞察必须挂 ≥1 条来源，未挂来源标灰』）」，
裁决行 `:949`「使用上面的推荐」。
**已被独立复现一次**：`packages/contracts/src/agent-runtime.ts:2334`（`AR9`）逐字
「the two arrays exist but must stay empty until a **structural criterion (O-35)** is chosen,
**rather than being filled by similarity scoring**」。

**证据**
- `contracts/asset-governance/domain.md:299`（X-G）逐字：「**04 关查重的相似度 68%** ↔
  `skills` 的 **O-35**『聚合用结构性判据，**不用相似度打分**』（已裁决）…
  ⚠ 两者是否同一件事待查（O-35 管改进建议聚合，04 关管资产查重）。
  **必须在一致性复核里裁**，否则本束会实现一个 O-35 明令禁止的形状」。
- 相邻一条（**做对了**，只需确认）：`:298`（X-F）逐字「**02 关安全扫描** ↔
  `skills` 的 `SecurityScanResult` 三态（已签核）…**复用同一对象**，本束不定义第二套三态」。

**双向核对**
- **UC → API**：`uc-23-1` 的 04 关查重有验收线索（68% 阈值），而按 O-35 该阈值不该存在
  ⇒ 验收本身要改。
- **API → UC**：无多余接口。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **O-35 覆盖资产查重**：04 关改为结构性判据（如「同名 + 同 `AssetProvenance` 来源 URL」= 重复；「同名不同来源」= 提示但**不阻断**），删掉 68% 这个数字；X-F 确认复用 `SecurityScanResult` 三态 | 小：改未签束的一处实现形状 | 结构性判据可能漏检「改了名的同一份资产」 |
| B | 判定 O-35 只管「改进建议聚合」，资产查重可用相似度，把 68% 登记进 `thresholds.ts` | 小 | O-35 的裁决理由是「分数无法解释、无法断言」，B 让它在另一处复活 |

**推荐**：**A**。O-35 的理由（分数不可断言）在查重场景同样适用；
且 A 让 04 关**能写出可执行的验收**，B 则把一个 `known:false` 的数值塞进关卡。
⚠ A 的漏检风险用「提示但不阻断」兜住——不阻断就不会因漏检造成错误拒绝。

**风险**：无（不触碰已签核束）。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-29 · 后台屏落点：「数据总览」与蓝本管理屏

**合并自**：`asset-governance` X-I / X-J / 缺口 11 / Q-11 / Q-12

**一句话**：一个屏在 phase-01、它的 UC 在 phase-03；另一个屏要从已签核束的地盘搬走。

**涉及束**：`asset-governance`（未签）· `templates`✅ · `canvas`✅ + phase-03 `17-gov`
**代价**：推荐 A **零改已签核束**；候选 B 才需重签两束并重出全套截图。

**已有答案：未覆盖。**（`23-asset/OPEN-QUESTIONS.md:349`（Q-11）与 `:385`（Q-12）裁决行空白。
⚠ 注意 `23-asset` 的 Q-11/Q-12 与 `24-research` 的 Q-11/Q-12 与 `00-project` 的 Q-11/Q-12
是**三套互不相干的编号**——引用时必须带束名，见 XC-00。）

**证据**
- `contracts/asset-governance/domain.md:301`（X-I）逐字：「左栏『数据总览』↔ `17-gov`（**phase-3**）
  —— **屏在 phase-01、UC 在 phase-03**…**Q-12** 推荐 A（本束只管左栏项与路由壳，屏内容归 phase-3）。
  ⚠ 已建成的 `OVERVIEW_*` mock 会处于**悬空态**，**必须登记为可见缺口**」；
  `:314` 同（「本束只管它在左栏里的**位置与可达性**」）。
- `:302`（X-J）逐字：「`/admin/blueprint` 与 `/tpl` —— 蓝本管理屏落点。**Q-11**。
  ⚠ **搬 `/tpl` 会动已签核束的产出，本束不可单方决定**」。
- 人类当天的原始诉求（Q-11 的由来）：本文 frontmatter `:19` 逐字
  「为什么在管理后台**看不到**项目蓝本」。

**双向核对**
- **UC → API**：「数据总览」屏已建成（`OVERVIEW_*` mock 存在），**phase-01 无对应 UC 也无端口** ⇒ 悬空。
- **API → UC**：`/tpl` 有 UC 有端口，人类的 IA 期望是它在后台 ⇒ 这是归属问题而非多余接口。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | **X-I = Q-12 推荐 A**（本束只管左栏项与路由壳；屏内容归 phase-3；`OVERVIEW_*` mock **显式登记为可见缺口**，路由壳渲染「本屏内容属 phase-3 `17-gov`」**而不是假数据**）。**X-J**：`/tpl` **不搬**，在 `/admin` 左栏加一个**指向 `/tpl` 的链接项** | 小：零改已签核束 | 后台里出现一个「跳出去」的链接，IA 上略不一致 |
| B | 把 `/tpl` 整块搬进 `/admin/blueprint` | 中：重签 `templates` + `canvas`；改路由与全部截图 | 两个已签核束的第 ① 件材料全部作废重出 |

**推荐**：**A**。人类的诉求逐字是「**看不到**项目蓝本」——那是**可达性**问题，
加一个左栏链接就解决了，不需要搬家。B 的代价（两束重签 + 全套截图重出）与诉求不成比例。
⚠ `OVERVIEW_*` mock **绝不能留着假数据**：`AGENTS.md` 纪律 10「宁可红，不可假绿」。

**风险**：A 之后 `/admin` 左栏有一项跳到 `/tpl`（非 admin 路径），
须确认 `.harness/scripts/lint-nav-reachability.mjs` 能接受这种跨区链接。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

#### XC-30 · `files` 束的两条判定面都在别束

**合并自**：`files` 缺口 3 / 缺口 8 / N-13

**一句话**：`files` 束定义了两条安全/合规规则，而**执行这两条规则的地方都不在 `files` 里**。

**涉及束**：`files`✅ · `agent-runtime`✅ + phase-00 `context-pack`✅
**代价**：确认归属 + 一份共享红队样本集；不改契约形状。

**已有答案：未覆盖。**

**证据**
- **prompt injection 的另一半**：`contracts/files/coverage.md:107`（缺口 3，🔴）逐字
  「`wrapDocumentAsData` 是包裹端口，但『agent 不把它当指令』的断言在 agent 运行时（04-agent）…
  一致性复核确认：**所有**进模型的文档文本都过同一个包裹端口，**不许有旁路**。
  **红队样本集须跨束共用一份，通过率 100%**」；
  `contracts/files/design-signoff.md:199` 逐字把 `04-agent` 列为下游。
- **`evidencePolicy` 判定面**：`contracts/files/coverage.md:112`（缺口 8）逐字
  「N-13 要求**服务端强制**，但 `searchContext` 属 `context-pack` 束…
  一致性复核确认：`synthesized` 的**产生**在本束（N-12），**过滤**在 `context-pack`。
  **两侧不得各写一份策略**——这正是 D-25 的两端」；
  不变量 `contracts/files/domain.md:110`（🔗 N-13：「篡改请求体的 `evidencePolicy` 后
  断言服务端仍按最严执行」）。

**双向核对**
- **UC → API**：`files` 的 V7（红队通过率 100%）与 V5（篡改 `evidencePolicy` 服务端仍按最严）
  都有完整验收线索，而**执行方在别束** ⇒ `files` 单束跑不了它们。
- **API → UC**：`wrapDocumentAsData` 在 `files` 有端口，
  而**没有任何东西强制所有入模文本都过它** ⇒ 端口可被绕过。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | ⑴ **包裹端口唯一化**：加 import 图断言「任何把文档文本送进模型的路径必须经 `wrapDocumentAsData`」；红队样本集落在 `packages/contracts/tests/` 下**一份**，`files` 与 `agent-runtime` 共用，通过率断言 100%。⑵ **`evidencePolicy`**：产生在 `files`（N-12）、过滤在 `context-pack`，**策略常量声明在 `context-pack`**、`files` 引用；加篡改反证（客户端传 `all`、服务端按 `primary-only` 执行） | 中：一条 import 断言 + 一份共享样本集 + 一条反证 | 红队样本集若只有正例会平凡为真（缓解：**必须含已知能绕过的负例**） |
| B | 各束自查 | 零 | 「不许有旁路」这条**没有任何执行者** |

**推荐**：**A**。两条都是 🔴，且都是**安全侧**——纪律 10「宁可红，不可假绿」直接适用。

**风险**：无（不改契约形状，只加门控与归属）。

##### 裁决
- [ ] 采纳推荐
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

## 三、错误语义一致性检查

> **本节不重复声明**：跨束错误码的具体冲突与机制缺口已在 **XC-06 / XC-07** 逐条处置。
> 这里只留检查范围、继承项与本节**新查出**的一条。

### 三·一 检查范围

十二束的失败枚举合计数百个错误码。按 phase-00 的做法逐类核对
「同一种失败是否用了同一个码」：无权限 / 资源不存在 vs 无权限 / 依赖不可用 /
并发冲突 / 幂等重放 / 撤回中 / 配额超限。

### 三·二 phase-00 已定的语义，phase-01 必须继承（确认项）

| 继承项 | phase-01 状态 | 证据 |
|---|---|---|
| **不泄露存在性**（无权限与不存在不可区分） | ✅ 各束沿用 `NO_PROJECT_ROLE` / `*_NOT_FOUND` 分层；⚠ **一处例外**：跨组织预览时「artifactId 在本组织不存在」**静默略过而无失败码** | `packages/contracts/src/identity.ts:813`（`C_F17_1`）逐字「no failure code …; preview **silently omits it**」 |
| **依赖不可用一律拒绝、不降级** | ✅ `DEPENDENCY_UNAVAILABLE` 在 `artifact` / `files` 沿用；⚠ `research` 声称复用的 `AGENT_RUN_FAILED` **不存在于任何束** | `research.ts:997`（`R1`）→ **XC-07 第 5 组** |
| **append-only，不提供删除路由**（N-5） | ⚠ **三束三种做法** | → **XC-25** |

### 三·三 本节新查出的一条：**UC 有失败模式、契约的 `err` 表达不了**（三处同形）

| 束 | 表达不了的失败 | 出处（逐字） |
|---|---|---|
| `agent-runtime`✅ | E5「拒绝超配额的并发设置并给出可用上限」 | `agent-runtime.ts:2321`（`AR7`）「no error code exists for it in usecases.md; `updateAgentDefinition.err` **cannot express it**」 |
| `templates`✅ | 原型明示的发布门（绑定 skill 组织级降级且未替换则阻断发布） | `templates.ts:1375`（`T1`）「has **NO error code** in usecases.md; `publishBlueprintVersion.err` cannot express it」 |
| `project`✅ | U-2⑵「有 `active` 环节时拒绝归档」 | `project.ts:794`（`P7`）「**deliberately left the failure code unnamed**; `archiveProject.err` cannot express it」 |

**⇒ 同一形状出现三次**，而**没有任何门控会发现它**：
`verify-uc-coverage.ts` 现在**不检查**「UC 的每条 E-n 是否在某个 `err` 里有对应」。

**候选处置**
| # | 候选 | 代价 | 风险 |
|---|---|---|---|
| A ⭐ | 三处各补一个错误码（`CONCURRENCY_QUOTA_EXCEEDED` / `BOUND_SKILL_DEGRADED` / `SEGMENT_ACTIVE`），并给 `verify-uc-coverage.ts` 增加一条检查：**每条 UC 的 E-n 必须映射到某个 operation 的 `err` 成员**，无映射即红 | 中：三个码 + 一条检查 | 新检查会一次性红出更多同形缺口（**收益**） |
| B | 只补三个码，不加检查 | 小 | 「有规范没脚本」；第四处必然出现 |

**推荐**：**A**（补码触碰三个已签核束，可并入 **六·一** 的 W1/W2 窗口）。
⚠ 反证：删掉某个 `err` 成员，断言 `verify-uc-coverage` 变红。

##### 裁决
- [ ] 采纳推荐（三处补码 + `verify-uc-coverage` 增加「E-n ⊆ err」检查）
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

## 四、单源检查：下一次漂移的候选

> 本项目已因「同一事实声明在两处」漂移 **7 次**
> （设计 token · 字号档位 · 丢弃原因枚举 · 撤回链 SLA · 估点 · 七态保留 testid · `sourceType` 词表）。
> 第 7 次就在本阶段，见 **XC-03**。

### 四·一 已收敛、有机械门控的（确认它们还活着）

| 事实 | 单源位置 | 门控 |
|---|---|---|
| 丢弃原因 7 类 | `packages/contracts/src/omission-reason.ts` | `:75` `as const satisfies Record<...>` |
| 待定阈值登记表 | `packages/contracts/src/thresholds.ts` | `:210` `as const satisfies Record<string, Threshold<unknown>>` + `tests/pending-thresholds.test.ts` |
| 过滤动作词表 | `packages/contracts/src/filter-action.ts` | `:63` `as const satisfies Record<...>` |
| MCP 工具授权范围完整性 | `packages/contracts/src/agent-runtime.ts` | `:126` `satisfies Record<ToolAuthScopeT, number>` |
| 工具副作用完整性 | `packages/contracts/src/agent-runtime.ts` | `:140` `satisfies Record<ToolSideEffectT, number>` |
| 禁止路由 | `packages/contracts/tests/no-forbidden-routes.test.ts` | 存在 |
| 项目级 AI 开关默认值「未裁」 | `thresholds.ts`（`known:false`） | `tests/project-ai-switch-defaults-pending.test.ts` |
| 跨束同码同义（部分） | `research.ts:289,296` · `asset-governance.ts:166` | `satisfies readonly (A & B)[]` 交集类型 |

### 四·二 **第 8 次漂移的候选**（按风险排序，逐条有出处）

| # | 候选 | 现状 | 归到 |
|---:|---|---|---|
| 1 | **来源类型词表** | 三份定义、两两不等；`files` 束已整束退化为 `z.string()`（`files.ts:1195`） | **XC-03** |
| 2 | **错误码字面量** | `err` 是裸字符串、无编译期约束（`contract-shape.test.ts:52`）；已确证 5 组同码不同名 | **XC-06 / XC-07** |
| 3 | **可见性词表** | 四套并存，两套已签核 | **XC-05** |
| 4 | **留存 180 天** | `FS7` 逐字「no gate ties…」；`pending-thresholds` 三处硬编码**现在就红着** | **XC-15** |
| 5 | **撤回 SLA** | 已漂过一次（D-U2 作废）；`research` 的「一个天数都不复述」是唯一做对的样板 | **XC-14** |
| 6 | **同意项** | 三个版本，且**两份都是手写 mock** | **XC-18** |
| 7 | **审计查询面** | 已在三处（`artifact.queryProvenance` / `chat.queryChatAuditEvents` / `templates.queryBlueprintAudit`），`T8` 逐字点名 | **XC-10** |
| 8 | **中断策略 `interrupt\|drain`** | `skills.ts:1294`（`S6`）逐字：现声明于 **`skills` 束 + `agent-runtime` + 已建成的 `DisableDialog` 组件**（三处），「converging them is a **cross-bundle amendment**」 | 下方 ★ |
| 9 | **`saveAsOrgTemplate`** | `skills.ts:1288`（`S5`）逐字：「is specified in **BOTH** `skills/usecases.md` and `templates/usecases.md`; this bundle declares only a pointer, but **the duplicated prose still needs to be reconciled by the signer**」 | 下方 ★ |
| 10 | **矩阵「绑定」列** | `templates/design-signoff.md:163`（X-3）逐字：矩阵的绑定列**就是** UC-3.2 的配置面，「两处各存一份**必然漂移**」 | 下方 ★ |
| 11 | **保留 testid 清单** | `project/design-signoff.md:312`（X-20）：`web-kernel` 的屏清单**手维护**，已登记为漂移候选并注明「phase-01 屏数增长后风险放大」；本域一次加 7 个标签页 | 下方 ★ |
| 12 | **手写 mock 整体** | `apps/web/lib/mock/{chat,entry,interview,tpl,files,itv}.ts` 目前**都是手写**；而 `packages/contracts/scripts/gen-mock.ts` **已存在** | 下方 ★ |

### ★ 处置（8–12 五条，一次裁）

| # | 候选 | 推荐 |
|---:|---|---|
| 8 | ⓐ 收敛到 `agent-runtime`（运行时的归属方），`skills` 与组件引用；ⓑ 各自保留 | **ⓐ** —— `S6` 逐字称收敛它是 cross-bundle amendment，即**只能在这里裁** |
| 9 | ⓐ 只在 `templates` 定义，删 `skills/usecases.md` 里那段重复散文（契约侧已是指针）；ⓑ 反过来 | **ⓐ** |
| 10 | ⓐ 绑定列与 UC-3.2 读写同一张表，矩阵侧只读投影；ⓑ 两份 | **ⓐ** |
| 11 | ⓐ 保留 testid 清单改为**从 `packages/contracts` 生成**；ⓑ 继续手维护 + 加 diff 门控 | **ⓑ 先行，ⓐ 记为 phase-02** —— ⓐ 需先有屏的结构化定义，本阶段来不及；ⓑ 至少让漏加会红 |
| 12 | ⓐ 六份手写 mock 全部改为 `gen-mock.ts` 生成 + 断言「`lib/mock/*.ts` 带 generated 标记且 CI diff 为空」；ⓑ 只改被 XC-18 点名的两份 | **ⓐ** —— `contract-design.md` 硬规则第 2 条禁的就是手写 mock，而 **XC-03 与 XC-18 两条冲突都是它造成的** |

##### 裁决
- [ ] 采纳上表五条推荐（8=ⓐ · 9=ⓐ · 10=ⓐ · 11=ⓑ+phase-02 记账 · 12=ⓐ）
- [ ] 选 __
- [ ] 其它：______

裁决人：______   日期（ISO 8601，含时区）：______

---

## 五、开工前必须补的（阻塞项）

> 判据：**不解决它，对应的 feature 写不出可执行的 `verification`**，
> 或者写出来也是空转（纪律 10）。

| # | 阻塞项 | 卡住谁 | 出处 |
|---:|---|---|---|
| B-1 | **XC-08**：Q-0 的裁决行由人类亲填 | `asset-governance` **全束**（F132–F143 共 12 个 feature；且该文件逐字「Q-0 未裁决前，本模块不得生成 feature」） | `23-asset/OPEN-QUESTIONS.md:4,5,20,51` |
| B-2 | **XC-03**：来源类型词表裁决 | `files` 束整束的 `sourceType` 字段现为 `z.string()`；`research` 束的物化侧 | `files.ts:1195`（`FS1`） |
| B-3 | **XC-04**：合规负责人落层 | `files` 的 **V13·22-4「在此定案前无法验收」**（逐字）；`org-admin` 的撤回 / legal-hold 流程 | `files/coverage.md:119` |
| B-4 | **XC-13**：保留期到期 vs 快照不可删 | `recording` 束（`ui.md:210` 称其为「**本束最硬的待裁决项**」）；F78 F79 | `recording.ts:997`（`C_REC_2`） |
| B-5 | **XC-24**：「综合 Studio」出口 | `interview`（已签核，界面上有一个死按钮）；`research` 的 `promoteConclusionToInsight` | `itv.ts:888`；`feature_list.json:3302` |
| B-6 | **XC-20**：R0 存在与否 + 第③层归属 | 三层权限求交**没有实现归属**（判定被指给不存在的 `11-board`） | `agent-runtime/usecases.md:356` |
| B-7 | **XC-09**：试跑台 phase 归属 | `uc-23-5` 的 **13 条验收全部无处落地** | `asset-governance/coverage.md:199-211,281` |
| B-8 | **XC-02** 的 U-8 / U-9 | `project` 束的 DDL 写不下去（判别列存不存在决定 `checkProjectsColumnSet` 是 4 列还是 5 列） | `project/domain.md:336-337` |
| B-9 | **XC-05**：`ChatVisibility` → `VisibilityScope` 映射 | 对话产出落 Artifact 时**可见性未定** | `chat.ts:994`（`C_CHAT_1`） |
| B-10 | **XC-27** 的 `AG6` | 六道落地门**可经编辑器旁路**（已知洞，故意留着等人确认） | `asset-governance.ts:636` |

⚠ **B-4 依赖一个到不了的外部输入**：O-39 法定留存清单，
`DECISIONS-OPEN.md:1036-1060` 逐字「无依据，需合规负责人给出…①②③ 必须等外部输入」。
XC-13 的推荐 A 是**在 O-39 缺席下的安全侧默认**，它让 `recording` 束可以签核，
但**不消除**该缺口——缺口继续以 `legalHoldCategories: {known:false}`（取值抛错）的形式活着。

---

## 六、不阻塞但需人类裁决

| # | 事项 | 为什么不阻塞 | 归到 |
|---:|---|---|---|
| N-1 | X- 编号统一 | 不改任何契约；但不做的话本清单本身难用 | **XC-00** |
| N-2 | `agenda_segment` 改名迁移的**时机** | 归属已定，feature 可先按新名写；迁移可排进 sprint | **XC-01** |
| N-3 | 审计查询面的具体形状 | 各束「只声明事件类型」即可开工 | **XC-10** |
| N-4 | `err` 编译期门控 | 加门控不改契约；越晚做暴露的不一致越多 | **XC-06** |
| N-5 | Context API 门控规则 | 规则已在文档里，实现者可遵守；门控是**防回归**不是防首次 | **XC-16** |
| N-6 | 六份手写 mock 改生成 | 现有 mock 能跑；但 XC-03 / XC-18 两条冲突都是它造成的 | **四·★12** |
| N-7 | 后台屏落点（数据总览 / 蓝本） | IA 问题，不卡数据模型 | **XC-29** |
| N-8 | 资产查重判据 | `asset-governance` 未签，可在签核时一并定 | **XC-28** |
| N-9 | 复核时钟串行化 | 同上；但会触碰 `agent-runtime` | **XC-26** |
| N-10 | 三粒度 AI 权限的模板级 | 求交语义已定，补一档是执行 | **XC-19** |
| N-11 | `ProvenanceEventType` 扩四值 | 走 ADR 即可；但不扩则 `project` 四条审计写不进去 | **XC-10** |
| N-12 | 归档四个连带行为 | 推荐已给全，属确认 | **XC-21** |
| N-13 | 三处「UC 有 E-n、`err` 表达不了」 | 可先按现有码上线，但会丢失失败语义 | **三·三** |

### 六·一 建议的重签窗口合并（省人类的次数）

本清单里 **12 条触碰已签核束**。若逐条重签，人类要签十几次。建议合并为**三个窗口**：

| 窗口 | 涉及束 | 打包的条目 | 特点 |
|---|---|---|---|
| **W1 · phase-00 内核** | `identity`✅ `artifact`✅ `context-pack`✅ `auth`✅ | XC-01（改名）· XC-02（超类型 + U-8/U-9）· XC-03（`ArtifactSource` 词表）· XC-04（`OrgRole` 扩值）· XC-07 第 4 组 · XC-10（`ProvenanceEventType` 扩值）· XC-15（`AUTH_POLICY`）· XC-17（`DownstreamPurpose`）· XC-21（`QueryContext` 加字段） | 会动 **5 个已 passing 且在 main 的 feature 的验收命令**；必须同一 PR 内改完 |
| **W2 · 运行时侧** | `agent-runtime`✅ `skills`✅ `chat`✅ `templates`✅ | XC-05（可见性映射）· XC-07 第 1/2/3 组 · XC-11（删反向码）· XC-20（R 分级 + 第③层归属）· XC-25（硬删除口径）· XC-26（复核时钟）· 三·三（补三个码）· 四·★8/★9 | 只改契约与错误码，**不动截图** |
| **W3 · 材料侧（要重出截图）** | `interview`✅ `recording`✅ | XC-18（同意项四项 + 补「交给 AI 分析」开关）· XC-24（删「综合 Studio」出口） | 会让一批 `ui-preview/` 截图失效，须重出并过 `node .harness/scripts/lint-ui-material.mjs` |

**建议顺序**：**W1 → W2 → W3**。
理由：W1 定的是名字与词表（改一次会重写下游），W2 依赖 W1 的错误码枚举（XC-06 先落），
W3 的截图必须在前两者稳定之后再出，否则会重出两遍。

⚠ **零改已签核束的条目**（可与三个窗口并行推进）：
XC-06 · XC-09（推荐 B）· XC-12 · XC-16 · XC-19 · XC-22 · XC-23 · XC-27（推荐 A）· XC-28 · XC-29（推荐 A）· XC-30。

---


## 现在挡住了谁（建骨架的直接后果）

`contracts/` 目录一建立，`assertDesignSignedOff` 对 phase-01 **从静默放行转为生效**
（`contract-design.md` §门控的三条实际行为 第 1 条）。于是：

- `pnpm harness new-sprint --phase 01 …` 拒绝
- `pnpm harness claim`（**真正的开工动作**）拒绝
- `pnpm harness doctor --phase 01` 报签核链不合格

拒绝理由有两级，**两级都要过**：
1. 该 feature 所属束的 `design-signoff.md` `status` 不是 `confirmed`
2. 本文件的 `status` 不是 `confirmed`（现在是 `pending`）

> 🔴 **2026-07-31 状态更新（上面那两段是建骨架时写的，已过期）。**
> 第 1 条现在是 **12 束已签 10、待签 2**（`asset-governance` · `research`）——
> 不再是「十个束全是 `pending`」。第 3 条（`project` 的 `covers:` 为空）**已不成立**：
> 该束现在 `covers` 13 个 feature（F116–F128）。
> 实测（`pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 01`）：
> **只剩本文件 `status: pending` 这一条红。**
>
> ⇒ **phase-01 的 144 个 feature 现在一个都开不了工，卡在本文件上。这是预期效果，不是故障。**

## 确认动作

1. 人类逐束核对三件（① UI ② 用例 ③ API 契约），把束的 `status` 改为 `confirmed`。
   **剩余两束**：`asset-governance`（⚠ 其阻塞项 Q-0 见 **XC-08**）· `research`。
2. **十二束全签完后**，人类做本文第二~六节的交叉约束复核（清单已就位，逐条打勾），
   再把本文 `status` 改为 `confirmed`。
3. ⚠ **顺序不能颠倒**：先签本文再签束，等于用一份没看过束内容的复核放行——
   ADR-023 背景 1 记录的就是这件事，且它已经真实发生过一次。
4. ⚠ **这是人的动作，不是 agent 的。** `status` / `confirmed_by` / `confirmed_at`
   由 CODEOWNERS + CI 保护（ADR-023 决策五），agent 不得代劳，也不得为了让门控变绿而改这些字段。
5. ⚠ **本文第二~六节的裁决块也是人的动作。** agent 写了「一句话 / 证据 / 候选 / 推荐」，
   **勾选框一律留空**；勾它、签名、写 ISO 8601 时间戳是人类的事。
6. ⚠ **有 12 条会触碰已签核束**（见 **六·一** 的 W1/W2/W3 三个窗口）——
   采纳它们意味着相应的束要**重签**。先决定这 12 条，再去补签剩下两束，
   否则可能签完就被推翻。

### 第 ① 件（UI）的截图状态（2026-07-31 更新）

> 下面这段是建骨架时写的，**已过期，保留只为留痕**：
> ~~`ui-preview/` 下只有 markdown 与 `files/` `itv/` `rec/` 三个截图目录，其余六个束零截图。~~
>
> 实测：`ui-preview/` 下现有 **19 个截图目录 / 849 张 PNG**（含 `*-v2` 重做批次）。
> 材料完整性由 `node .harness/scripts/lint-ui-material.mjs` 机械门控
> （ADR-023 背景 3 那个爆点现在有脚本看着）。
> ⚠ 但 **XC-18 / XC-24 若被采纳会让一批截图失效**（见 **六·一** 的 W3 窗口），
> 所以第 ① 件的最终确认建议排在 W3 之后。

### 现存 `ui-signoff.md` 的处置

`phases/phase-01-run-a-project/ui-signoff.md`（phase 级、`status: pending`）按 ADR-023 决策一
**并入束级 `ui.md`**，不再单独签。该文件本轮**未删除**——删它是把一份 `pending`
的签核记录抹掉，属于人类的决定；建议在人类签第一个束时一并处置。

## 2026-08-11 增补：chat-file-upload / chat-context-engine 两束交叉约束复核（XC-32…XC-37）

> 复核人：coord-main（agent 代核）；人类采纳裁决逐字：「采纳 coherence，开始建 V9-a」（2026-08-11，经 Chat UI 体验迭代会话转达并由其代抄）。人类可逐条推翻；推翻任一条，相应 feature 回退 blocked。材料依据：两束 domain/usecases/coverage/ui 四件 + packages/contracts/src/chat-file-upload.ts + uc-8-6/uc-8-7，全读。只查跨束面。

### XC-32 chat-file-upload ↔ chat：消息 schema 与写权
- 证据：file-upload/domain.md 不变量 1（写权即线程写权，复用 mutate-thread 同一规则）；契约独立为 chat-file-upload.ts，chat.ts 既有 operations 零改动。
- 双向核对：chat→upload：消息/线程删除经 FK CASCADE 带走附件，chat 束语义不变；upload→chat：createMessage 带 attachments 是新增可选入参，旧调用方不受影响。
- 结论：无冲突。无需重签 chat 束。

### XC-33 chat-file-upload ↔ files：Attachment ≠ File
- 证据：domain.md 不变量 3（生命周期随线程、无独立留存策略）；files 束八值来源枚举未新增任何「chat attachment」值。
- 核对：附件不进项目文件树、不出现在 files 束任何列表；「附件转存为项目文件」若未来要做须另开扩展签核（本轮明确不做）。
- 结论：无冲突，边界已显式声明。

### XC-34 chat-file-upload ↔ asset-governance / 对象存储
- 证据：存储走 WORKSPACEX_OBJECT_ROOT 基础设施（#921 的 4g 步已在 devapp 生效）；附件不是治理域资产，不进 provenance/lifecycle 管辖。
- 结论：无冲突。

### XC-35 chat-context-engine ↔ agent-runtime：ModelCallPort 不动
- 证据：domain.md 不变量 2（人类裁决 A 逐字：组装在端口内侧、端口形状不变）；第③件走形态 B「无对外 HTTP 面」声明，零新增 operations。
- 核对：agent_run_context 快照是只读审计新表，不回写 run 语义；对应 feature 的 verification 为 api 层单测，与「无 HTTP 面」一致。
- 结论：无冲突。无需重签 agent-runtime 束。

### XC-36 chat-context-engine ↔ chat：分层历史与线程语义
- 证据：HISTORY_MAX_MESSAGES=20 维持（旧轮经 L2/L3 承载，不改 chat 束读取契约）；thread_context_state 以 thread 为键，thread 生命周期语义不变；UI 面走 reuse_bundle: chat。
- 核对：个人对话零召回反证 feature 与 chat 权限模型一致，不产生新可见性。
- 结论：无冲突。

### XC-37 chat-context-engine ↔ files/research：L3 检索复用与可见范围
- 证据：L3 复用既有 context-pack/retrieval 引擎（此前零调用方，本束是第一个生产调用方）；召回受 actor 可见范围约束（domain.md 不变量 3）。
- 核对：不为检索新开任何越过 RLS 的读取路径；extracted_ref（V9-b）是 L3 输入之一，失败降级不 fail run，两束接缝互相引用、口径一致。
- 结论：无冲突；唯一后置风险是检索引擎首接生产调用方的性能面，属实现期验证项。

### 处置汇总
六条全部「无冲突」，不触发任何已签核束的重签窗口。F150–F157 的束门由本复核 + 两束已签核 design-signoff 共同解锁。

## 2026-08-11 增补：personal-realtime-transcription 交叉约束复核（XC-38…XC-42）

> 人类已于 2026-08-11 在本任务明确回复“一致性已签核”并更新本文 frontmatter。材料依据：`contracts/personal-realtime-transcription/{domain,usecases,coverage,ui}.md`、UC-5.5、既有 `recording` 束、旧 `design-deltas/realtime-asr` 与 issue #945 的已确认产品范围。

### XC-38 personal-realtime-transcription ↔ recording：元数据与逐字稿单源

- 新表 `personal_transcriptions` 只保存名称、标签、owner 和聚合状态，不保存正文。
- 每次开始/停止形成一个既有 `recording_sessions` capture run；final 仍只通过既有 segment ingestion 写 `recording_segments`。
- `project_id IS NULL` 只允许 `source_type='personal'`；workshop/interview/thread 的非空项目约束保持不变。
- 结论：没有第二条逐字稿写路径，也不改变既有项目录音语义；无需重签 `recording` 束。

### XC-39 personal-realtime-transcription ↔ identity/org-admin：个人层正文边界

- owner 判定为 `personal_transcriptions.owner_user_id == actor.userId`，列表、详情、ticket 与 WS 升级共用同一 predicate。
- 组织仍承担租户、计费和数据驻留分区；管理员沿用 F06 的既有边界，只见个人层计数，不获得正文读取旁路。
- 非 owner 的详情读取返回 not found，避免泄露资源存在性。
- 结论：与已签身份边界一致；实现期必须有“同组织其他用户 + 管理员正文均为 0”的集成反证。

### XC-40 personal Fun-ASR ↔ 既有 Qwen3 realtime-asr：模型路由不覆盖

- 旧 `WS /recording/sessions/:sessionId/asr-stream` 与 Qwen3 provider 继续服务项目/线程录音，不被全局替换。
- 新个人转录端点按 scope 选择 Fun-ASR provider；环境变量 `ALIYUN_ASR_*` 与 `DASHSCOPE_API_KEY` 只供该 provider 使用。
- provider 选择是 application port 内的 scope 路由，不在前端复制模型名，不建立硬编码模型枚举。
- 结论：两条协议可兼容共存；若实现选择全局替换旧 provider，则本结论失效并必须重签旧 realtime-asr delta。

### XC-41 personal-realtime-transcription ↔ 额度与模型调用日志

- 内容 ownership 是用户级，计费仍归当前组织；两者不是同一授权概念，不合并字段。
- 阿里 `usage.duration` 只取任务最终累计值或去重后的最大值；`captureId + upstreamTaskId` 是唯一记账键。
- final 段写入与用量记账失败分别留审计状态，但 completed 只在尾部写链与必要记账均收口后发出。
- 结论：复用既有额度与模型日志服务，不引入个人余额第二套事实源。

### XC-42 一次性 ticket ↔ 既有 JWT/项目鉴权

- 长期 JWT 只用于 HTTPS 创建文档与领取 ticket；新个人 WS 原子消费约 60 秒的一次性摘要票据。
- ticket 绑定 user/org/transcription/capture，不携带 projectId，也不放宽旧项目 WS 的项目角色校验。
- 旧项目 WS 的 bearer subprotocol 保持兼容；新个人 WS 使用独立路径，避免同一路由出现两套鉴权语义。
- 结论：没有鉴权降级；ticket 过期、复用、跨资源和跨用户必须在握手阶段拒绝。

### 处置汇总

XC-38～XC-42 均无冲突，前提是实现严格保持“个人新路径 + 旧项目路径兼容并存”。采纳后，人类把 `personal-realtime-transcription` 加入 frontmatter `covers_bundles`，更新 `confirmed_by/confirmed_at`；若不采纳，应把 F158–F160 保持 blocked 并逐条写明不同意的交叉约束。

## 2026-08-26 增补（草稿，待人类采纳）：plan-control 交叉约束复核（XC-43…XC-52）

> 复核人：coord-architecture（agent 代核，**尚未获得人类「采纳」裁决——本节是草稿**，
> 依 F149 先例：agent 只做复核、不代改 frontmatter `covers_bundles`）。
> 材料依据：`contracts/plan-control/{design-signoff,ui,usecases,domain,coverage}.md` 全读，
> 对照 `chat` 束（`domain.md`/`usecases.md`/`packages/contracts/src/chat.ts`，2026-08-26 实测
> `origin/signoff/plan-editing` @ `beaf27c8`）与 `agent-runtime` 束（同批实测）。
> 起因：`plan-control` 是 phase-01 唯一 `status: pending` 的新束，`covers: []` 是**结构性**的——
> 该域 feature 尚未由 requirement-author 生成（见 `design-signoff.md` frontmatter 注释），
> 这与 `covers_bundles` 门控无关，是另一件事，见本文件正文末尾 coord-architecture 附注。
> 本节只查跨束交叉约束，不判 `covers: []` 是否可放行——那由 `doctor.ts` 的独立门控管，
> 与「一致性复核是否覆盖了这个束」是两件不同的事（详见附注）。

### XC-43 `mutateThread.op` 独立操作集，不扩 `chat` 已签核的封闭枚举

- 证据：`chat.ts:545` `mutateThread.in.op` 是 `z.enum(["create","rename","delete"])`，
  注释只声明「新建 / 改名 / 删除」，**全文（`domain.md`/`usecases.md`）没有任何一条不变量
  主张「线程的全部可变操作都必须经 `mutateThread`」**——它是一个具名端口，不是唯一写入口的声明。
- 核对：`plan-control` 走独立契约 `plan-control.ts`（11 个操作，`design-signoff.md` 3.1
  人类已裁 A），`mutateThread.op` 三值原样不动。
- 结论：**无冲突**。不触发 `chat` 束的 delta 或重签——这与 `design-signoff.md` 3.1 自己的
  结论一致，本次是独立验证，不是转述。

### XC-44 并发版本语义：`basedOnRevision`/`PLAN_REVISION_CHANGED` 与 `chat` 的 `expectedVersion`/`VERSION_CHANGED` 同形不同名

- 证据：`chat.ts:547` `mutateThread.in.expectedVersion` 与 `err` 里的 `VERSION_CHANGED`
  是**线程**版本；`plan-control` 的 `basedOnRevision`/`PLAN_REVISION_CHANGED`
  （`design-signoff.md` 3.3 冲突表）是**计划账本**版本，两张表的 `(thread_id, revision)`
  主键各自独立（`chat_threads` 无 `revision` 列，`chat_plan_ledgers` 才有）。
- 核对：两个方向都不静默：改标题不动计划版本，改计划不动线程版本；共用字段名才会让两条
  独立时间线互相污染。
- 结论：**无冲突**，同形不同名是**故意的**（对应 `design-signoff.md` 自报的 XC-A）。

### XC-45 「加约束」走 system 消息注入，不占用 `agent-runtime` 已签核的 `configurable` 通道

- 证据：`configurable` 上现有的 `org_skills` / `script_protocol` 两个键**不在**
  `contracts/agent-runtime/{domain,usecases}.md` 任何一处出现（全文 grep 零命中）——
  它是运行时代码事实（`deep-agent-model-provider.ts`），**不属于 `agent-runtime` 束已签核的
  契约面**。system prompt 组装顺序/来源同样没有被该束的域不变量声明过。
- 核对：新加一层 system 注入既不改 `agent-runtime.ts` 的 operations，也不新增/挤占
  `configurable` 键（仍只有两个，`design-signoff.md` 3.4 人类已裁 A）。
- 结论：**无冲突**——因为被担心会撞上的那条约束根本不在 `agent-runtime` 已签核的边界内，
  这条本身也是需要留痕的发现（担心点不成立，不等于没查）。

### XC-46 `cancel(action=interrupt)` + 新 run 不带 `checkpoint_id` 的暂停/恢复用法，不在 `agent-runtime` 已签核的 run 生命周期声明范围内

- 证据：`contracts/agent-runtime/{domain,usecases}.md` 全文只有 `DisableMode`
  的 `"interrupt"/"drain"` 二值（`agent-runtime.ts:64`，管理员停用能力的语义），
  **没有任何 `RunControlAction`/checkpoint 恢复相关的已签契约**；`replayAgentRun`
  （`usecases.md:753`，I-49）是「重放已结束的 run」，本身与「续跑」是两件事，
  且该束自己把「续跑」标成 `coverage.md:249` 缺口 25——即该束承认自己没管这件事。
- 核对：`plan-control` 的 `UC-13 resumePlanRun` 是**全新**用例，落在 `plan-control.ts`，
  不改 `agent-runtime.ts` 任何一个 operation；`restoreCheckpoint`（会真正触碰
  `agent-runtime` 领域）已被人类裁决 (c) **明确不做**，`design-signoff.md` 3.3 已如实登记为
  0.7 封顶的已知缺口，不是被藏起来的代价。
- 结论：**无冲突**，前提是 (c) 的裁决不变——若日后决定做 `restoreCheckpoint`（候选 (a)），
  它才会真正触碰 `agent-runtime` 领域，届时需要那个束的 delta 或重签（对应
  `design-signoff.md` 自报的 XC-C，本次结论：**当前范围内不适用，非「无冲突」而是「未触发」**）。

### XC-47 `STATE_SNAPSHOT{todos}` 事件通道被同时用于只读展示与可编辑态，`chat` 束未对它做过限定其用途的声明

- 证据：`STATE_SNAPSHOT.snapshot` 的唯一生产形状定义在共享契约文件
  `packages/contracts/src/agui-state-events.ts:44`（`{ todos: [...] }`），
  **不在 `chat` 束目录下**；`contracts/chat/*.md` 全文对 `STATE_SNAPSHOT`
  **零提及**——`chat` 束从未声明它只用于只读展示，因此不存在「消费方假设被打破」的冲突。
- 核对：`plan-control` 的 `UC-2`（`design-signoff.md` 3.5）复用**既有**生产者
  （`copilotkit-agui.controller.ts:389-392`），不建第二条触发路径，「倾向不新增」是它自己的结论。
- 结论：**无冲突**。`chat` 束不是这个事件的所有者，谈不上要求它「跟着改」。

### XC-48 编排边界：`plan-control` I-11「mid-run 不写引擎」与 `agent-runtime` 已签的「LangGraph 只用于深度研究/HITL/多阶段生成…两者不可混用」

- 证据：`usecases.md:788-791`（`agent-runtime` 束）原话是摄取流水线/规则求值/并发排队/审计写入
  与 LangGraph **不可混用**；`plan-control` I-11 的处置是 mid-run 编辑**只落本仓账本**
  （`chat_plan_ledgers`，一张业务表，不是持久任务系统），不越过引擎写 state。
- 核对：两者管的是不同的东西——`agent-runtime` 那条边界挡的是「拿 LangGraph 做本该用持久任务
  系统做的事」，`plan-control` 挡的是「拿引擎 state 做本该用业务表做的并发写」，方向一致，
  没有一条被违反。
- 结论：**无冲突**，`plan-control` 遵守而非改写那条边界（对应自报 XC-B）。

### XC-49 审计写入复用 `ProvenanceWriter`，不另建审计面

- 证据：`ProvenanceWriter` 是 `agent-runtime` + phase-00 `identity` 已有的审计写入面
  （`design-signoff.md` I-13 引用）；`plan-control` 未在 `domain.md`/`coverage.md`
  声明任何独立的审计表或写入路径。
- 结论：**无冲突**，前提是实现期真的调用同一个 writer 而非另起一张审计表——这是实现期机械
  可断言的点（同一 writer 实例/同一表名），签核时无法从文档层面进一步核实，留作 verification 项。

### XC-50 可见性与写权判定：`plan-control` 全部 `pre` 委托 `chat` 的 UC-0

- 证据：`chat/usecases.md:13-14`「每一个读端口都先过 `resolveVisibility`（UC-0），没有例外」，
  且 `chat` 束内多个 UC（如 `mutateThread`）本身就复用 UC-0 的判定形状；`plan-control` 的
  `NOT_VISIBLE`/`NO_WRITE_ROLE`/`THREAD_ARCHIVED_READONLY`/`AUDIT_SINK_UNAVAILABLE` 四个错误码
  与 `chat.ts:561-562` 的 `mutateThread.err` 逐字同码同义（`design-signoff.md` 3.6 已声明）。
- 核对：`plan-control` 不另立角色枚举，委托是**同一套 `acl_bindings`**（与 `chat` 束
  `getThreadMessagesFile` 对 UC-0 的复用方式同形，`usecases.md:115-116`）。
- 结论：**无冲突**，前提是实现期在 API 层真的调用同一个判定函数而非前端不渲染式的假委托——
  这条与 `chat` 束自己对 `getThreadMessagesFile` 的纪律（「若它自己判一次权，就是第二份
  可见性实现」）同理，留作 verification 项。

### XC-51 `PlanStepStatus` 与共享契约 `AguiPlanTodoStatus` 逐字同枚举

- 证据：`agui-state-events.ts:35` `AguiPlanTodoStatus = z.enum(["pending","in_progress","completed"])`；
  `plan-control/domain.md:52-53` 声明 `PlanStepStatus` 三值封闭且与它「逐字相同」。
- 核对：`plan-control.ts` **尚未创建**（`design-signoff.md` ③ 节自述「本轮只产出骨架」），
  因此现在无法核实第二处是否真的用 `z.infer<typeof AguiPlanTodoStatus>` 派生而非手抄一份
  字符串字面量——这正是本仓「同一事实两处声明」的高发形状（XC-06 已登记的同类问题）。
- 结论：**当前文档层面无冲突**，但**签核通过、开工写 `plan-control.ts` 时必须是类型引用
  而非拷贝**，建议把这一条写进该 feature 的 verification（`typecheck` 断言二者同一类型），
  不要留到实现期才发现是第二份副本。

### XC-52 TW-P0-3 判据的单一事实源

- 证据：`design-signoff.md` 开篇逐字「覆盖判据：`.harness/instructions/
  chat-task-workbench-acceptance.md` **TW-P0-3**……那份卡是判据的单一事实源，本文件只引用
  编号，不重抄正文」；全文检索未发现判据正文被抄进 `contracts/plan-control/` 任何一份文件。
- 结论：**无冲突**，符合本仓「同一事实不得声明在两处」的纪律。

### 处置汇总

XC-43～XC-52 共十条，**八条无冲突（43/44/45/47/48/49/50/52），一条当前范围内未触发
（46，restoreCheckpoint 若日后启用需另议），一条留实现期机械验证而非文档层面冲突
（51，类型引用 vs 拷贝）**。**没有一条要求重签 `chat` 或 `agent-runtime`。**

⚠ **这十条不是「签核」，是复核结论草稿**——按 F149 先例，agent 不得据此自行把
`plan-control` 加进 frontmatter `covers_bundles` 或改 `status`。人类采纳后（逐字裁决，
仿 2026-08-11 先例的记法），由人类或经人类明确指示的 agent 代抄：
① 把 `plan-control` 加进 frontmatter `covers_bundles`；
② 刷新 `confirmed_by`/`confirmed_at`；
③ 若不采纳，应逐条写明不同意的交叉约束，`plan-control` 所属 feature（尚待生成）继续 blocked。

⚠⚠ **本节的通过不等于 PR #2116 的两条门控红能同时解开**——见下方「coord-architecture 附注」：
`covers: []` 那条红有独立于本节的成因和修法。

### coord-architecture 附注（2026-08-26）：`covers: []` 那条红不是本节能解开的

`doctor.ts`（`.harness/scripts/lib/design-signoff.ts:424-443`）对 `covers: []`
的判据与 `status`（pending/confirmed）**完全无关**——它是一条独立于「一致性复核有没有
覆盖这个束」的门。读代码后的结论：

1. **这不是边界 case，是主路径**。该判据的错误信息里逐字写着「最常见的原因：该能力域的
   feature 还没生成——束目录先建好了，而 `feature_list.json` 里还没有属于它的条目」——
   `plan-control` 现在的状态**正是它描述的那个场景**，不是脚本没预料到的边界输入。
   **不应该为此登记 issue**：脚本行为符合它自己的设计意图，档案文字（错误信息本身）
   已经把设计意图写清楚了，不存在「静默失败」或「没文档的边界」问题。
2. **修法是脚本本身写的那两条**：⑴ requirement-author 为 `plan-control` 生成 feature、
   填进 `covers:`；⑵ 该域不该有束 → 删掉束目录。**人类在对话里说「采纳」不能让这条红消失**——
   `status: confirmed` 本身也不能，因为 `!b.coversDeclared`/`features.length === 0`
   两条判据在 `status` 分支**之前**就已经 fail，且与 `status` 取值无关（第 424/429 行，
   `status` 相关检查在 455 行才开始，是另一段代码）。
3. **两条红的性质不同，不能用同一个动作解开**：
   - 「一致性复核没覆盖 `plan-control`」（本文件这条红）：本节 XC-43～52 是它的复核结论草稿，
     人类采纳 + 把束名加进 `covers_bundles` 即可解开，**这是本会话已经做的部分**。
   - 「`covers: []` 不可签核」（`design-signoff.md` 的红）：**不受本节影响**，需要
     requirement-author 先跑起来、`feature_list.json` 里出现 `plan-control` 的 feature、
     `covers:` 从 `[]` 变成非空。**这一步在本次任务范围之外**（本轮只动治理文档，
     不建 feature），需要人类决定下一步是否触发 requirement-author。

⇒ **PR #2116 即使人类现在就「采纳」本节 XC-43～52 并签核 `plan-control` 的
`design-signoff.md`，`gates-fast`/`verify-control-plane` 的 `covers: []` 那条红仍然会红**——
这不是本会话能绕过或不该绕过的东西，是签核顺序被 UI 先行流程（TW-P0-3 先出八屏原型再定契约）
天然拉开的一步，需要人类知情后决定：现在就跑 requirement-author 生成 feature，
还是让 PR 先带着这条红等下一轮。
