# 范围变更登记 — 2026-07-30

> **这份文件记录的是一次范围核对的结果，不是需求。**
> 它的存在理由：本仓已**十一次**出现「**已有答案，却没有人记得答案在哪**」。
> 本次核对本身又贡献了两例（见第三、四节）。
> 登记 = 把答案变成**会被下一个人看见**的东西。
>
> 权威：`phases/requirements/DECISIONS-{PENDING,FINAL,DELTA}.md`（**决策档案是人类的，本文件不改它们**）。
> 本文件**不改** `feature_list.json`、不改任何 `*-signoff.md` 的
> `status` / `confirmed_by` / `confirmed_at`、不动任何已签核束的内容。

---

## 零、一句话结论

起因是一份原型通读报告（`ui-preview/PROTOTYPE-SWEEP-UI.md` 第一节）判定
「**五个域有屏、有原型，却既不在功能清单里、也不在契约束里**」。

逐个核实后，**这五个域分成三类，不是一类**：

| 类 | 域 | 真实状态 | 本次处置 |
|---|---|---|---|
| **A · 真漏建（已裁 / 本 phase）** | `research` | D-20 已裁 A（~21 点），**三份档案一致**，而**任何 phase 都没有该模块** | ✅ **补进 phase-01**：`requirements/24-research/` 五份 UC + `contracts/research/` 五件 |
| **B · 真漏建（已裁 / 档案指定 phase-2）** | `prototype` | D-21 已裁 A（~24 点），档案**逐字写 phase-2**，而任何 phase 都没有该模块 | ✅ **phase-02 占位登记**：`phase-02/requirements/18-proto/00-REGISTRATION.md`（**只登记，不写 UC、不建束**） |
| **C · ⚠ 不是漏建 —— 它们本来就在别的 phase** | `survey` `tasks` `brain` | **三个域都已有完整 UC 模块与 feature**，在 phase-02 / phase-03。「不在 phase-01」是**设计如此**，不是缺失 | ✅ **不建任何东西**。见第三节的证据与更正 |

⚠ **第三节是本文件最重要的一节。** 我收到的任务描述把 C 类三个域写成
「无裁决背书、原型有、档案从未提，需人类补一次范围裁决」。**经机械核实，这句话是假的。**
若照它执行，会在 phase-01 建出三份与 phase-02/03 现有模块**重复的**需求与契约束
——那正是本仓已栽六次的「**同一事实声明在两处**」。

---

## 一、A 类 · `research`（D-20）—— 本次补进 phase-01

### 档案证据（三份一致，判定为**漏建**）

| 档案 | 行 | 原文（逐字节选） |
|---|---|---|
| `DECISIONS-PENDING.md` | 326–338 | 「原型有一级导航（研究问题 / 证据表 / 候选洞察 / Scout 并行 3 路），**17 个模块目录里完全没有它**。它是 09-kg 证据的主要生产者、10-report 取材范围里「研究」那一项的实体。」<br>方案 **A**：「新开模块 **M18 研究 Studio**（约 21 点）」<br>**选择：A** |
| `DECISIONS-FINAL.md` | 97 | 「**研究 Studio 立项**（新模块，约 21 点）。范围已明确：新建深度研究配置面板（研究场景 / 可判定问题 / 4 类型 / 3 档时间盒 / 来源偏好 / 交付形式 / 挂到组或决策节点）」 |
| `DECISIONS-DELTA.md` | 296 / 301 | 列在「维持原选择（26 项）」中；补充「**维持 A**…范围已明确…**估点可按确定范围重算而非风险溢价**」 |

**没有任何一份把它推到后续 phase。** ⇒ 补进 phase-01 与档案一致。

### 机械核对（漏建的证明）

```
$ ls phases/phase-01-run-a-project/requirements/     # 14 个模块，无 research
$ ls phases/phase-02-visible-outcomes/requirements/  # 09-kg 10-report 11-board 12-survey 13-deliv
$ ls phases/phase-03-reuse-and-governance/requirements/  # 14-brain 15-portal 16-persona 17-gov
$ # 三个 phase 的 feature_list.json 合计 220 个 feature，area 分布里没有 research
```

⚠ **而且这早被发现过一次**：`phases/phase-01-run-a-project/REVIEW-REQUIREMENTS.md:102`
逐字写着「**D-20 / D-21** | 研究 Studio / 原型 Studio 立项，约 45 点 | 🔴 **两个 phase 都没有该模块**」
——**那条 🔴 本身没有触发任何动作，45 点就这样躺了三天。**

### 本次产出

- `requirements/24-research/`：`00-index.md` · `OPEN-QUESTIONS.md`（20 条待裁）·
  `uc-24-1` … `uc-24-5`（五份 R1–R12 完整 UC）
- `contracts/research/`：`domain.md` · `usecases.md` · `coverage.md` · `ui.md` · `design-signoff.md`
- **估点 5+5+5+3+3 = 21**，与 D-20 的「约 21 点」对齐（单一事实源是**各 UC 头部的 `估点 **n**`**）
- **未生成任何 feature**（`covers: []`），解锁路径写在 `design-signoff.md`

### 模块号为什么是 24 不是 D-20 写的 18

`M18` 从未落地成目录；phase-01 已用到 `00…08 / 20…23`；`09…17` 已被 phase-02/03 占用。
取 24 紧接 `23-asset`。⚠ **模块号不是权威，束名 `research` 才是**。

---

## 二、B 类 · `prototype`（D-21）—— phase-02 占位登记

### 档案证据

| 档案 | 行 | 原文（逐字） |
|---|---|---|
| `DECISIONS-PENDING.md` | 341–351 | 「原型有一级导航 + 3 个实例 + 五步设计对话 + 审计门禁 + 明确版本策略；**21 份 UC 无任何对应**」<br>方案 A：「**立项**（约 24 点，**建议 phase-2**）」<br>**我的推荐：A 但放 phase-2**。**选择：A** |
| `DECISIONS-FINAL.md` | 98 | 「**原型 Studio 立项**，放 **phase-2**（约 24 点）」 |
| `DECISIONS-DELTA.md` | 296 | 列在「维持原选择」中 |

⇒ 与 A 类同为漏建，**但档案明确指定 phase-2**。本次**不在 phase-01 建任何东西**。

### 本次产出

`phases/phase-02-visible-outcomes/requirements/18-proto/00-REGISTRATION.md`
—— **只登记，不写 UC、不建契约束、不改 phase-02 的 `feature_list.json`**。
内容是**原型证据（11 个屏的字节偏移 + 逐字引文）+ 生产平面现状 + 24 点 + 一条原型自身不自洽**。
理由：写完整 UC 是 phase-02 立项时的活；而**登记是防「24 点第二次消失」的最低成本手段**。

---

## 三、⚠ C 类 · `survey` / `tasks` / `brain` —— **它们不是无主的，任务描述错了**

> **这一节推翻的是我收到的任务描述本身。** 逐条给证据。

我收到的指示逐字为：「另三个域（survey/tasks/brain）**无裁决背书**——它们是「原型有、档案没提」，
请如实标为**需人类补一次范围裁决**」，并要求为它们建 phase-02 占位登记。

**经机械核实，「无裁决背书」与「档案没提」两条都是假的。** 三个域**都已有完整模块**：

### 3.1 需求模块（磁盘上就有）

```
$ ls phases/phase-02-visible-outcomes/requirements/12-survey/
uc-12-1-新建问卷与模板.md  uc-12-2-发放与回收.md  uc-12-3-交叉分析.md  uc-12-4-现场快速投票.md

$ ls phases/phase-02-visible-outcomes/requirements/11-board/
uc-11-1-四列看板与推进.md  uc-11-2-任务自动汇入.md  uc-11-3-筛选与我的待办.md
uc-11-4-到期提醒.md  uc-11-5-我的今天.md  uc-11-6-任务权限包与授权流.md
uc-11-7-任务模板与自动化规则.md

$ ls phases/phase-03-reuse-and-governance/requirements/14-brain/
uc-14-1-结论写回与去重.md  uc-14-2-跨项目调用.md  uc-14-3-方法与教训沉淀.md
uc-14-4-决策台账.md  uc-14-5-知识五态机与晋升.md  uc-14-6-检索可审查.md
```

### 3.2 feature 也已经生成

```
phase-02-visible-outcomes  46 个  Counter({'report':11,'board':10,'kg':9,'deliv':9,'survey':7})
phase-03-reuse-and-governance  47 个  Counter({'brain':21,'gov':15,'persona':6,'portal':5})
```

⇒ `survey` **7 个** · `board`(=tasks) **10 个** · `brain` **21 个**，合计 **38 个 feature**。

### 3.3 裁决背书也有（至少 6 条）

| 域 | 裁决 | 出处 | 内容（逐字节选） |
|---|---|---|---|
| `brain` | **D-24** | `FINAL:75` | 「14-brain **MVP 三件**：决策台账（UC-14.4，8）+ 五态机晋升（UC-14.5，13）+ 检索可审查（UC-14.6，13）＝ **34 点**…**模块合计 52 点**。**推演链编辑器 / 我的大脑个人层 / 健康度看板 / 反例库 / 版本谱系后置为 backlog**」 |
| `tasks` | **D-26** | `PENDING:418` | 看板列数**采原型五列**（收件箱/待开始/进行中/待验收/已完成）。**选择：A** |
| `tasks` | **D-27** | `PENDING:432` | AI 建卡**一律落收件箱草稿态**，R1 可自动接受，R2/R3 必须人接受。**选择：A** |
| `tasks` | **D-28** | `FINAL:59` | 「风险分级 **R1/R2/R3 按操作类型自动推导**（如外发邮件恒 R3、读公开资料恒 R1），**任务模板可覆盖**」 |
| `tasks` | **D-29** | `PENDING:456` | 「我的今天」**独立页面 + 看板筛选两者都要**。**选择：A** |
| `tasks` | **D-39** | `FINAL:61` | 「待办卡**负责人恒为人**；agent 记在独立的「**执行者**」字段」 |

### 3.4 仓库里**早就显式声明**过这三个域属于别的 phase

这是最能说明「答案一直都在」的一条：

- `.harness/scripts/nav-reachability.config.json` 的注释 `//5` **逐字**写着：
  > 「`allowRoutes`：导航里**故意存在、但不属于 phase-01 任何束**的路由——
  > 它们是**别的能力域/阶段（研究、问卷、大脑、任务）**或组织治理总览（后台）。」

  且 `allowRoutes` 里逐条列着 `/studio/research` `/studio/survey` `/brain` `/tasks`。
- `apps/web/lib/navigation.ts` 的 `ucRefs` **逐条指向那些模块**：
  `survey → ["12-survey/uc-12-1"]` · `brain → ["14-brain/uc-14-6"]` · `tasks → ["11-board/uc-11-1"]`。

⇒ **两个门控配置文件与一个导航文件，三处独立地记着这件事。**

### 3.5 那么原型通读报告说的「缺失」是什么

它说的是**真的**，只是**结论下错了**。报告 P-01 / P-02 / P-03 / P-09 列举的缺口
（问卷模板层、报告模板映射、质量门禁、任务详情抽屉、任务模板与自动化）
**逐条都已经写在那些 UC 里**：

| 报告说「缺」 | 实际写在哪 |
|---|---|
| P-01 问卷报告模板映射 + 发布质量门禁 | `12-survey/uc-12-2-发放与回收.md` **R7.1「质量门禁『双阻断』（本模块头号硬约束）」**，逐字引了原型同一句「每个问卷发布前必须映射到一个报告模板 —— 没映射完的题不能发布」 |
| P-01 问卷模板层 | `12-survey/uc-12-1-**新建问卷与模板**.md`（标题里就有）|
| P-03 任务详情抽屉的 `isDwPerm` 权限包 | `11-board/uc-11-6-**任务权限包与授权流**.md` |
| P-09 任务模板与自动化规则 | `11-board/uc-11-7-**任务模板与自动化规则**.md` |
| P-04 大脑决策链 / P-11 健康度指标与个人偏好 | **D-24 已明确后置为 backlog**（`FINAL:75` 逐字）——**不是缺失，是裁过的不做** |

⚠ **P-04 与 P-11 这两条尤其要注意**：原型通读报告把它们判为「重做 / 修补」，
而 **D-24 逐字把「推演链编辑器 / 我的大脑个人层 / 健康度看板」后置为 backlog**。
⇒ **把它们当缺口去补，等于让实现者翻人类的案。**

### 3.6 真正的问题是另一个（**这条才该交人类**）

三个域**不缺需求，缺的是别的**：

> **phase-02 / phase-03 的界面，已经在 phase-01 期间被建进 `apps/web` 了**
> （`components/survey/` 4 文件 417 行 · `components/tasks/` 4 文件 703 行 ·
> `components/brain/` 6 文件 838 行，共 **1,958 行**），
> 而它们**不在 phase-01 的任何 feature 的验收范围内**，也不属于 phase-01 的任何契约束。

这不是「无主的能力域」，是「**提前建成、无人验收的界面**」。两者要人类做的决定完全不同：

| 如果按「无主能力域」理解 | 如果按真实情况理解 |
|---|---|
| 该补 phase-01 的需求与契约束 | **不该补**——补了就是第二份声明 |
| 人类要裁「这些域做不做」 | 人类要裁的是「**已经建好的 phase-02/03 界面怎么办**」 |

**建议交给人类的选项**（本文件只提出，不代裁）：

| | 方案 | 优点 | 缺点 |
|---|---|---|---|
| **A** | **原样保留**，明确标注为 phase-02/03 的**预研材料**，不进 phase-01 任何验收范围 | 不浪费已做的工；边界清晰 | phase-01 的 `apps/web` 里长期存在无人验收的代码 |
| **B** | 把它们**移出** `apps/web` 或加显式 `phase-02-preview` 标记 + 一条门控 | 「谁属于哪个 phase」变成机械可查 | 需要改动已合入的代码与路由 |
| **C** | 把三个模块**提前到 phase-01** | 界面与需求对齐 | phase-01 从 431 点涨到 ~520 点以上；且与 phase-02/03 的排期逻辑（`00-overview.md`「本阶段的每一个屏都是**投影**，不是数据源」）**正面冲突** |

**我的倾向：A**。理由：phase-02 的 `00-overview.md` 已经论证过为什么这几个屏必须排在 phase-01 之后
（「若在没有真实材料的情况下先做这几个屏，就只能拿 mock 数据验收」），
C 会推翻那个论证；B 的收益不足以抵消改动已合入代码的成本。
**但这是范围决定，须人类裁。**

### 3.7 `isDwPerm` 与 `agent-runtime` 的枚举重叠 —— 现在的处置

任务描述要求「`isDwPerm` 的 R0–R3 分级与 `agent-runtime` 已有枚举重叠，必须收敛为单一事实源」。

**本次不收敛，登记原因如下（这是刻意的，不是遗漏）**：

1. **重叠的两边都不在本次改动范围内**：`isDwPerm` 属 `11-board/uc-11-6`（**phase-02**），
   `agent-runtime` 是**已由人类签核**的束。本次任务只补 `research`。
2. **原型与档案对分级档数的说法不一致**，这本身需要裁。
   原型 `isDwPerm` 的「能做什么 · 按风险分级」表 @**15,990,703B**，逐字三行：

   | 档 | 原文 |
   |---|---|
   | **R0–R1** | 读取、检索、建模 · **自动执行** |
   | **R2** | 改草稿、建内部文件 · **执行后通知** |
   | **R3** | 发邮件、改正式数据 · **执行前审批** |

   - 原型把 **R0 与 R1 并成一格**（`R0–R1`），即**存在 R0 这一档**，只是与 R1 同策略。
   - `DECISIONS-FINAL.md:59`（**D-28**）逐字：「风险分级 **R1/R2/R3** 按操作类型自动推导」——**没有 R0**。
   - `11-board/uc-11-1:32` 与 `uc-11-5:37` 均写 `risk_level`（**R1/R2/R3**）。

   ⇒ **三值还是四值，档案与原型正面冲突。** 由实现者挑一边 = 替人类裁决。
   ⚠ 顺带一提：原型这三行同时定死了**每档的执行策略**（自动 / 执行后通知 / 执行前审批），
   而 D-28 只裁了「谁判定」没裁「判定后怎么做」——**策略这一层在档案里是空的**。
3. ⇒ 正确的处置是：**在 phase-02 立项 `11-board` 时，由那时的作者按 D-28 收敛**，
   并把 `agent-runtime` 已有的枚举定为单一事实源（`11-board` 引用而不重定义）。
   **本文件把这条登记下来，使它不会在 phase-02 被重新发现一次。**

⚠ 本次补建的 `research` 域**没有引入第三份风险分级枚举**。可机械核实：

```bash
$ grep -on "R0\|风险分级\|risk_level" phases/phase-01-run-a-project/requirements/24-research/*.md
# 无输出
```

⚠ **不要**用 `grep -c "R1\|R2\|R3"` 来验这件事——UC 模板的章节 ID 就叫 `R1`…`R12`，
那样查必然命中，且命中的全是章节标题。（我第一版就是这么写的，**错了，此处留痕**。
这正是 COORDINATOR-LOOP 纪律第 5 条「我的临时统计脚本错过三次」的同一形状。）

---

## 四、⚠ 决策来回本身（**这一节是留痕，不是流程记录**）

2026-07-30 一小时内，D-21 与 C 类三个域的 phase 归属经历了**两次来回**：

| # | 时刻 | 指示 | 与档案的关系 |
|---|---|---|---|
| 1 | 任务下达 | 「人类 2026-07-30 明示『一起做，放到 phase1』」，要求把 `research` `prototype` `survey` `tasks` `brain` **五个域全建进 phase-01** | ❌ 与 `FINAL:98`「D-21…放 **phase-2**」**冲突** |
| 2 | 第一次更正 | 「**D-21 放 phase-2，不是 phase-1**…我先前告诉你人类明示放 phase-1，**那条作废**」 | ✅ 回到档案原文 |
| 3 | 第二次更正 | 「`survey`/`tasks`/`brain` **也放 phase-02**」，并称三者「**无任何裁决提过**」 | ⚠ 归属结论正确（它们本就不在 phase-01），但「无裁决提过」**是假的**（第三节）；且据此要建的 phase-02 占位会与现有模块重复 |

**误传的是 main coordinator，不是档案。** 档案三天来一个字没变。

⇒ 这次来回本身证明了一件事：
> **「档案写了什么」和「有人记得档案写了什么」是两件事。**

而本次核对又给这条加了两个新例证：

- **第十一例**：D-20 / D-21 共 45 点已裁范围，在三份档案里白纸黑字，
  却**三个 phase 都没有对应模块**；且 `REVIEW-REQUIREMENTS.md:102` **早就标了 🔴**，
  那条 🔴 也没触发任何动作 —— **发现了、记下了、仍然没人动**。
- **第十二例**：C 类三个域「无裁决背书」的说法，在
  **两个门控配置 + 一个导航文件 + 六条决策 + 三个需求目录 + 38 个 feature** 面前不成立。
  答案不但存在，而且**存在于会被 CI 读到的文件里**，仍然被当成「没有」。

⚠ 对下一个人的建议：**在提出「这东西没有」之前，先跑这四条**（本次每一条都命中了）：

```bash
ls phases/*/requirements/                                   # 三个 phase 的模块目录
grep -rn "<关键词>" phases/requirements/DECISIONS-*.md       # 决策档案
grep -rn "<关键词>" .harness/scripts/*.json                  # 门控配置的注释里常有归属声明
grep -rn "ucRefs" apps/web/lib/navigation.ts                # 导航已声明每个入口属于哪份 UC
python3 -c "import json,collections;[print(p,collections.Counter(f['area'] for f in json.load(open(p))['features'])) for p in __import__('glob').glob('phases/*/feature_list.json')]"
```

---

## 五、本次改动清单（可逐条核对）

**新增**
- `phases/phase-01-run-a-project/requirements/24-research/`（7 个文件）
- `phases/phase-01-run-a-project/contracts/research/`（5 个文件）
- `phases/phase-02-visible-outcomes/requirements/18-proto/00-REGISTRATION.md`
- 本文件

**修改（每处只改一个字段 / 一行）**
- `phases/phase-01-run-a-project/design-coherence.md` → **仅** `covers_bundles` 加 `research`
- `phases/phase-01-run-a-project/contracts/README.md` → 映射表加一行 + 「还没有束的」表更新
- `.harness/scripts/ui-material-map.json` → 加 `research` 一行（**必须加**，否则门控报错理由不对）
- `.harness/scripts/nav-reachability.config.json` → `research` 从 `allowRoutes` 移入 `bundleRoutes`

**未动（明确列出）**
- ❌ 任何 `feature_list.json`（三个 phase 都没动）
- ❌ 任何 `*-signoff.md` 的 `status` / `confirmed_by` / `confirmed_at`
- ❌ 任何 `DECISIONS-*.md`
- ❌ 任何已签核束的内容
- ❌ `apps/web` 下任何代码
- ❌ `survey` / `tasks` / `brain` 的任何东西（**理由见第三节**）
