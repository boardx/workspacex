# 签核后状态复核（2026-07-31）：三个束的正文自称「不可签核」，而它们都是 `confirmed`

> **这份文件不改任何签核字段。** `status` / `confirmed_by` / `confirmed_at` 是人的动作，
> agent 不许动，也不许通过「改正文」间接推翻它。
> 这里做的只有一件事：把**签核当时正文说的话**与**现在磁盘上的事实**逐条对一遍，
> 分成「已经不成立了」和「仍然成立」两堆，好让人类知道自己签的那一下覆盖了什么。
>
> 为什么需要它：`design-signoff.md` 一旦签了就是权威，而**三份签了的文件正文里逐字写着
> 「请不要把 `status` 改成 `confirmed`」**。一份自相矛盾的权威文件，比一份红着的文件更危险——
> 后者谁都看得见，前者机械门是绿的。

## 事实

12 个束全部 `status: confirmed`，`confirmed_by: yanbin shen`，
`confirmed_at: 2026-07-30T09:19:24+08:00`（**同一个时间戳**，一次批量签核）。

其中**三个束**的正文带 🔴 阻塞块：

| 束 | 正文原话 | 行 |
|---|---|---|
| `project` | 「本束**现在仍不可签核**。请不要把 `status` 改成 `confirmed`。」 | `design-signoff.md:19` |
| `asset-governance` | 「本束**现在不可签核**。请不要把 `status` 改成 `confirmed`。」 | `design-signoff.md:18` |
| `research` | 「本束**现在不可签核**。请不要把 `status` 改成 `confirmed`。」+「现在完全不具备签核条件。」 | `design-signoff.md:18,154` |

⚠ 另有一处时间悖论：这三份正文的实质内容（`research` 的 49 张截图、F144–F148、
`design-coherence.md` 的 31 条 XC）都标 **2026-07-31**，**晚于**签核时间 07-30T09:19。
即：**签核发生在这些材料写出来之前。**

## 逐条对账

### `project` —— 两条阻塞**都已解除**

| 阻塞 | 签核时的状态 | 现在 | 判定 |
|---|---|---|---|
| ① 本域 feature 尚未生成，`covers: []` | 空 | `covers:` 13 个（F116…F128） | ✅ 解除 |
| ② 第 ① 件不完整：19 张截图里 10 张是「概览」一个标签页，六个标签页无七态无四视角，三屏未画 | 19 张 | `ui-preview/project-v2/` **92 张**，`lint-ui-material` 双向集合相等绿 | ✅ 解除 |

⇒ **`project` 的 🔴 块是过期正文**，它描述的是一个已经过去的状态。

### `asset-governance` —— 四条里**两条仍成立**

| 阻塞 | 现在 | 判定 |
|---|---|---|
| ① Q-0 与已拍板的 D-06 正面冲突 | 已由 main coordinator 裁「方案 C（拆）」，见 `requirements/23-asset/DECISION-Q0.md` | ⚠ **半解除** |
| ② feature 未生成 | `covers:` 12 个（F132…F143） | ✅ 解除 |
| ③ `ui-preview/asset-governance/` 不存在 | **64 张**，`lint-ui-material` 绿 | ✅ 解除 |
| ④ Q-1…Q-12 待裁，其中 **Q-1b / Q-7 / Q-11 / Q-12 阻塞核心不变量** | `requirements/23-asset/OPEN-QUESTIONS.md` 里 **11 条 Q 全部还在** | 🔴 **仍成立** |

**① 为什么只算半解除**（两处，都是该束正文自己点名的）：
- 「**`OPEN-QUESTIONS.md` 的 Q-0 裁决行仍是空白**」（⚠ 缺口 15）。裁决原文在
  `DECISION-Q0.md`，而 `OPEN-QUESTIONS.md` **自称是裁决原文的唯一所在**。
  同一事实两处声明——本仓已九次因此漂移。
- 「⚠ **缺口 17**：裁决文说『试跑台 phase-1 保留』，而落地里它整块在 phase-2」——
  **裁决与落地方向相反**，且这条是我自己裁的，更该由人复核。

### `research` —— 三条里**一条仍成立，且它决定一半端口的主体**

| 阻塞 | 现在 | 判定 |
|---|---|---|
| ① Q-2（`/studio/research` 被 UC-0.2 占用）+ Q-8（研究项目/计划/主题是几层） | Q-2 **事实上已被绕开**：本束屏现在落在顶层 `/research`，`nav-reachability.config.json` 也已同步，门控 12/12 绿。**Q-8 一个字没裁** | 🔴 **Q-8 仍成立** |
| ② feature 未生成 | `covers:` 5 个（F144…F148） | ✅ 解除 |
| ③ `ui-preview/research/` 不存在 | **49 张**，`lint-ui-material` 绿 | ✅ 解除 |

⚠ **Q-8 不是细节**：正文逐字「它决定 `usecases.md` **一半端口的主体是哪个实体**」。
⚠ Q-2 虽被绕开，但**该束正文说过「Q-2 裁定后必须回来复核 nav 那一行」**——
现在路由变了而这条复核没做过。

## 仍然待裁的总量：**31 条**

- `requirements/23-asset/OPEN-QUESTIONS.md` —— **11 条**（Q-1 … Q-11）
- `requirements/24-research/OPEN-QUESTIONS.md` —— **20 条**（Q-1 … Q-20）

其中 **`24-research` 的 Q-11「综合 Studio」是什么** 正是 `design-coherence.md` 里
**XC 那条跨束约束**指向的东西：`interview`（**已签核**）的 `INSIGHT_REPORT_EXPORTS`
有一个出口叫「送入综合 Studio」，而**任何 phase 都不存在这个 Studio**。

## 这 31 条现在挡住了谁：**13 个 feature**，它们自己在 `notes` 里写明了卡在哪

| feature | 域 | 卡住的是什么 |
|---|---|---|
| F144 | research | 契约刻意一串都不落（`KNOWN_CONTRACT_GAPS.R2`）；屏落哪条路由未裁 ⇒ `data-testid` 无处锚定 |
| F145 | research | 来源类别未裁 ⇒ 契约里键退化为 `z.string()` |
| F146 | research | 证据去向未裁 **且归属未裁**（与 phase-03 `14-brain` 撞） |
| F147 | research | 重复入库行为未裁 ⇒ 幂等/报错/新建三种都不实现 |
| F148 | research | 状态枚举 + 权限边界未裁 ⇒ 不设角色分支 |
| F134 / F135 / F139 | asset | 复核周期单一事实源未裁（代码侧现状 3/6，MCP 走的是**已签核**的 `McpAuthScope`） |
| F125 / F128 | project | `is_host` 在库里是无约束布尔，既无 DB 约束也无裁决 |
| F129 / F131 | mcp | 未标注按最严处理 / `平台组` 全阶段仅此一处出现 |
| F58 | agent | 三项阈值已登记进 `thresholds`，取值待裁 |

⚠ **F144 已实现并通过全部门控（8 条反证）**，因为它做的是配置面板本身，
不碰那些待裁的出口。**F145–F148 会正面撞上。**

## 我建议的处理（人类决定，我不替你做）

1. **`project` 的 🔴 块**：它已过期。可以在正文加一个 2026-07-31 的更正块（留痕原文），
   或者就这么放着——它不影响任何门控，只影响读的人。**这条不急。**
2. **`asset-governance` 的缺口 15 / 17**：Q-0 的裁决**是我做的**，请你确认或推翻，
   并把结论落进 `OPEN-QUESTIONS.md`（那是它自称的唯一所在）。缺口 17
   「试跑台留 phase-1 还是 phase-2」裁决与落地方向相反，必须定一个。
3. **`research` 的 Q-8**：它决定一半端口的主体实体。F145–F148 开工前必须有答案。
4. **31 条待裁**：不必一次裁完。按上表**只裁挡住 13 个 feature 的那些**即可解锁 wave-1。

## 这次暴露的机制问题（与具体裁决无关）

**没有任何门控检查「签了的文件正文是否自称不可签核」。**
`assertDesignSignedOff` 只读 frontmatter 的 `status`，正文写什么它都不看。
于是三份逐字写着「请不要签」的文件被签了，而每一道门都是绿的。

这与 ADR-023 背景 2 是同一形状：**签核链的信任根没有任何机械保护**。
补法很便宜——`auditSignoff` 增加一条：`status: confirmed` 的束，
正文若含 `不可签核` / `不具备签核条件` / `请不要把 \`status\` 改成` 之类的自述，
判 **FAIL** 并把那一行贴出来，逼人要么删掉过期正文、要么撤回签核。
⚠ **写这条门控时必须造反证**：把自述删掉要能变绿、加回去要能变红，
且空文件不许平凡通过。（本仓已九次「全绿但空转」。）

## 相关

- ADR-023 决策一（签核三件、一处签）、决策五（签核状态受机械保护）、背景 2
- `phases/phase-01-run-a-project/design-coherence.md` 第二节 XC-00…XC-30
- `.harness/state/DEBT-phase-02-03-signoff-chain.md`
- `phases/phase-01-run-a-project/requirements/23-asset/DECISION-Q0.md`
