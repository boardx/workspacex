---
bundle: research
phase: "01"
# feature 已于 2026-07-31 生成：**5 个 / 21 点**，与 D-20 定的「约 21 点」一致。
#   一份 UC 一个 feature，points 逐份等于该 UC 头部的 `估点 **n**`（5+5+5+3+3 = 21）——
#   这样 `validate-fl.ts` 的估点漂移检查（按 spec_ref 归组求和）逐 UC 对得上。
#   ⚠ 估点的单一事实源是**各 UC 头部的 `估点 **n**`**；本注释与 00-index.md 的表都是派生视图。
#   ⚠ **`covers:` 有值 ≠ 本束可签核。** 另外两条阻塞（Q-2 / Q-8 未裁、UI 材料未产出）仍然红着，
#     逐条见正文。`status` 只能由人类改。
covers: [F144, F145, F146, F147, F148]
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:   yanbin shen            # 确认人（姓名/邮箱）
confirmed_at:  2026-07-30T09:19:24+08:00          # ISO 8601，且不得晚于签核当下
---

# 契约束 `research` 设计签核（第 12 个束）

> ## 🔴 本束**现在不可签核**。请不要把 `status` 改成 `confirmed`。
>
> ### 三条阻塞里**第 ② 条已于 2026-07-31 解除**，另两条仍然红着，解决其一不能签
>
> **① `OPEN-QUESTIONS.md` 的两条阻塞级未裁。**
> - **Q-2**：`/studio/research` 路由已被 UC-0.2 Context Pack 占用
>   （`navigation.ts:75` 的 `ucRefs` 逐字 `["00-core/uc-0-2"]`）。
>   本束的屏落在哪条路由上**还没定**，因此 `coverage.md` 的「前端消费点」列**41 条全部填不出来**。
>   且推荐方案 A 会**回头改 phase-00 已合入 `main` 的路由** —— 必须人类点头。
> - **Q-8**：「研究项目 / 研究计划 / 研究主题」是一层还是两层，原型三个词无一处定义关系。
>   它决定 `usecases.md` 一半端口的**主体是哪个实体**。
>
> 另有三个枚举未裁（**Q-10** 状态 / **Q-12** 证据去向 / **Q-7** 来源类别），
> 它们不阻塞开工，但**阻塞机械断言**——枚举值域未定时，任何涉及它们的 verification 都写不成。
>
> **② ✅ `feature` 已生成（2026-07-31）：F144…F148，5 个 / 21 点。**
> frontmatter 的 `covers:` 已填这五个编号，`verify-uc-coverage` 的「空 `covers`」那条红随之解除。
> ⚠ **它们是在 20 条待裁一条都没裁的情况下生成的**，因此每条 `notes` 里都写死了
> 「哪一条断言现在写不成机械判据、卡在哪个 Q」（F145 卡 Q-7、F146 卡 Q-12、F148 卡 Q-10/Q-14/Q-17/Q-18）。
> **签核时请把这些当成本束的真实完成度读，不要读作「已经可以开工」**——
> 开工的前置是本文件 `status: confirmed` ∧ 阶段一致性复核通过，两条都还没有。
>
> **③ 第 ① 件材料（UI）完全不存在。**
> `ui-preview/research/` **目录尚未产出**，`ui.md` 引用 0 张截图。
> 逐条该画什么见 [`ui.md`](./ui.md) 第二节。
>
> ⇒ **三条必须都解除，才谈得上逐节评审。**
>
> ### 会红的门控与红的理由（**每一条红都是正确的红**）
>
> | 门控 | 会报什么 | 为什么这条红是对的 |
> |---|---|---|
> | `lint-ui-material.mjs` | 判定④「目录不存在 / 0 张 png」 | 材料确实还没产出。映射行**已预先登记**在 `ui-material-map.json`，不登记的话报的是判定③「未声明」，**报错理由就不对了** |
> | ~~`verify-uc-coverage.ts 01`~~ | ~~「声明了 `covers: []`（空）」~~ | **2026-07-31 已解除**：`covers:` 已填 F144…F148 |
> | `lint-third-artifact.mjs` | ~~「第 ③ 件缺失」/「coverage 无映射表」~~ | **2026-07-31 已解除**：`packages/contracts/src/research.ts` 已建（形态 A），`coverage.md` 已出 V1…V41 逐行映射表 |
> | `lint-nav-reachability.mjs` | 判定①（若只登记 ui-material 不登记 nav 路由） | 已同步登记 `/studio/research`，因此**本条现在是绿的**；⚠ 但它绿得**不诚实**——那条路由现在渲染的是 UC-0.2 的屏，不是本束的屏。**Q-2 裁定后必须回来复核这一行。** |
>
> ### 为什么宁可红，不肯不建这个束
>
> 不建束 = 本域的设计**不在任何签核范围内**，将来它的 feature 生成出来时会落进
> 「不属于任何契约束」，`assertDesignSignedOff` 直接拒绝——那时才发现要补束，
> 而那时 UI 与 API 形状已经被别人顺手创造出来了（ADR-020 的立论）。
> 建束 + 报红 = **缺口是可见的、有名字的、会在每次 `doctor` 里出现的**。
>
> 而且本束比一般情形更急：**一个已签核的束正在依赖它**——
> `contracts/files/domain.md:178` 与 `requirements/22-files/uc-22-1.md:255` 逐字要求
> 「来源类型八值枚举必须与 12-survey / 06-itv / 05-rec / 08-chat / 07-canvas /
> **研究 Studio** 的产出侧一致」。本束不存在，那条跨束约束就是**悬空的**。
>
> 🔴 **2026-07-31 更新：第 ③ 件写完之后，这条约束不再悬空——它现在是「悬空且对不齐」。**
> 三方核对结果（见 `packages/contracts/src/research.ts` 的 `RESEARCH_ARTIFACT_SOURCE`
> 与 `KNOWN_CONTRACT_GAPS.R3`）：
> **已签核**的 `artifact.ArtifactSource` 里研究那一项叫 **`research-run`**；
> 界面侧 `apps/web/lib/mock/files.ts` 的 `SourceType` 与本束 `domain.md` 的 X-E 都叫 **`research`**。
> ⇒ **两票 `research` 对一票 `research-run`，而那一票是已签核的那一票。**
> 对齐方向**是签核动作不是实现动作**，请在下面第 ③ 节一并裁：
> (a) 改 `artifact`（动已签核束）；(b) 改界面侧与本束（动两处，且 `files.ts` 的
> `SOURCE_TYPE_VOCABULARY_DISPUTED` 还并列着 `workshop` / `canvas` / `prototype-run` 三个更大的分歧，
> 单独对齐 research 这一项**解决不了那张表**）。
> ⚠ 本束的处置是**不选边**，但把「已签核侧的字面量是 `research-run`」钉成**编译期事实**：
> 对方改名 ⇒ `pnpm --filter @repo/contracts run typecheck` 当场红。
> **这条跨束约束从今天起有一道会红的门，不再是一句话。**
>
> ### 解除这三条红的路径（顺序不可颠倒）
>
> 1. 人类裁 `requirements/24-research/OPEN-QUESTIONS.md`
>    （**至少 Q-2 / Q-8**，建议连 Q-10 / Q-12 / Q-7 一起）。
> 2. 按裁决回改 `domain.md` / `usecases.md` / `coverage.md`。
> 3. **ui-prototyper** 产出 `ui-preview/research/`（按 `ui.md` 第二节的 A–E 五组屏），
>    回填 `ui.md` 的真实索引与自检行。
> 4. ✅ ~~生成本域 feature 写进 `feature_list.json`~~ —— **2026-07-31 已做**（F144…F148）。
> 5. ✅ ~~把 feature 编号填进本文件 frontmatter 的 `covers:`~~ —— **2026-07-31 已做**。
> 6. **然后**人类才逐节核对下面三件并签核。
>
> ⚠ **不要为了消红而随手填一个 feature 编号。** 那是把「还没有 feature」谎报成
> 「已经评审过这些 feature」，比现在这条红糟得多。
> ⇒ 第 4、5 步先于第 1、3 步做完，是**刻意的顺序倒置**，理由与代价写在这里：
> 第 ③ 件门控 `lint-third-artifact` 要求 `coverage.md` 有一张逐行 R12 映射表，
> 而映射的粒度是 feature ——**没有 feature 就没有可映射的对象**，那条红解不开。
> ⚠ 代价是：这 5 个 feature 是在 20 条待裁**一条都没裁**的情况下生成的。
> 因此它们的 `notes` 里逐条写死了「哪条断言卡在哪个 Q、现在写不成机械判据」，
> 且 `coverage.md` 第二节把 5 条被 Q 阻塞的线索**具名保留为缺口**，没有一条被填成假落点。

覆盖 feature：**F144 F145 F146 F147 F148**（5 个 / **21 点**，与 D-20 的「约 21 点」一致）
⚠ **这一行是派生视图，不是权威。** 权威是本文件 frontmatter 的 `covers:`（ADR-023 决策三）。
依据 UC：`24-research/uc-24-1 新建深度研究与研究配置` · `uc-24-2 深度研究对话与交叉验证` ·
`uc-24-3 研究 Studio 列表与研究计划详情` · `uc-24-4 研究结论回流与去向` ·
`uc-24-5 现场深度研究与冲突判定`
裁决清单：`requirements/24-research/OPEN-QUESTIONS.md`（**20 条，全部未裁**，**裁决原文是权威**）
范围来源：`phases/requirements/DECISIONS-FINAL.md:97`（**D-20**，权威重述）
范围变更登记：`requirements/SCOPE-DELTA-2026-07-30.md`
UI 材料：`ui-preview/research/`（**尚未产出**）

## 这个束为什么现在才出现

D-20 在 2026-07-27 那一轮就已裁定「**研究 Studio 立项**（新开模块 M18，约 21 点）」，
`DECISIONS-FINAL.md:97` 权威重述，`DECISIONS-DELTA.md:301`「**维持 A**」。
**三份档案一致，且没有任何一份把它推到后续 phase。**

而 2026-07-30 的机械核对结果是：**`M18` 这个模块在任何一个 phase 都不存在** ——
`requirements/` 下 phase-01 有 14 个模块、phase-02 有 5 个、phase-03 有 4 个，
**没有一个是研究**；三个 phase 的 `feature_list.json` 合计 220 个 feature，
**`area` 分布里没有 `research`**。

⇒ **这是漏建，不是作废。** 一条已经拍板的 45 点范围（D-20 21 点 + D-21 24 点）
在三份档案里白纸黑字，却**没有任何人把它登记成模块**——
本仓已有的 `REVIEW-REQUIREMENTS.md:102` 早就把它标成 🔴「两个 phase 都没有该模块」，
**而那条标记本身也没有触发任何动作。**

这正是本仓反复出现的失败模式的第十一例：**「已有答案，却没有人记得答案在哪」**。
本束（以及 `SCOPE-DELTA-2026-07-30.md`）的存在，就是把这条范围**变成会在 `doctor` 里出现的东西**。

## 这个束为什么这样切

按**能力域**切，边界是「**研究这个实体，以及它的证据出口**」——判据在
[`domain.md`](./domain.md) 第零节，一句话可机械执行：

> **这条规则在「研究结论离开研究 Studio」那一刻之前还是之后？之前 ⇒ 本束；之后 ⇒ 下游束。**

- **在本束内**：研究的发起与七项配置（`uc-24-1`）、与 Scout 的对话与交叉验证（`uc-24-2`）、
  列表与研究计划（`uc-24-3`）、**结论出口与入库门槛**（`uc-24-4`）、现场与冲突判定（`uc-24-5`）。
- **不在本束内**：洞察库（`14-brain`，phase-03，**已有 21 个 feature**）、
  知识图谱（`09-kg`，phase-02，**9 个**）、报告（`10-report`，phase-02，**11 个**）、
  待办（`11-board`，phase-02，**10 个**）。
  ⚠ 这四个**都不是「以后再说」，是「别处已经有了」**。在本束里再写一份 = 第二份声明。

⚠ **本束是「一个已签核束正在依赖、自己却是空的」束**（与 `project` 束当初同形）：
`files`（已签核）的八值来源枚举约束逐字点名「研究 Studio 的产出侧」。
⇒ **本束不签，那条约束悬空。** 这也是本束应当优先被解锁的原因之一。

---

## ① UI —— 人看到的界面对不对

材料：本束 [`ui.md`](./ui.md) → `ui-preview/research/`（**尚未产出，0 张**）。

🔴 **现在完全不具备签核条件。**

⚠ 评审时请**优先看四视角与阻断态**，不要只看 happy path。理由写在 `ui.md` 第三节：
本束的**原型材料极度偏向 happy path**——研究详情屏画的是「已出结论 · 来源 14」，
现场屏四行里三行正常，**五份 UC 里 20 余条异常流程在原型上一条都没有**。
第 ① 件如果只签 happy path，等于没签。

⚠ 另有一条**前车之鉴**：`project` 束的第 ① 件（19 张）就栽在
「10 张是同一个标签页、没有七态、没有四视角对照」上，被推翻重做（`project-v2`）。
本束的 `ui.md` 第二节已按 A–E 五组把七态与四视角逐条写死，**产出时按它核**。

## ② 用例 —— 业务流程对不对

材料：`requirements/24-research/uc-24-1` … `uc-24-5`（五份，R1–R12 齐全）
+ [`usecases.md`](./usecases.md)（application 层端口）
+ [`coverage.md`](./coverage.md)（**现在是缺口清单，不是覆盖表**）。

**评审时请重点看这三件**：

1. **五份 UC 的估点合计 = 21，与 D-20 逐字一致**（5+5+5+3+3）。
   若您认为某份估低了，请直接改**该 UC 头部的 `估点 **n**`**——那是单一事实源。
2. **`domain.md` 第二节的 12 条不变量**，尤其 **N-1 / N-2 / N-5**（三道入库门槛）。
   它们是 D-20 立论「研究 Studio 是证据的主要生产者」能否成立的判据：
   门槛立不住，洞察库里就会出现无出处结论。
3. **`usecases.md` 零节的失败枚举**：6 个新增码，每个都附了「为什么不能复用既有码」。
   若您认为某个可以复用，请指出复用哪一个。

## ③ API 契约 —— 接口形状对不对

材料：**`packages/contracts/src/research.ts`（唯一事实源，2026-07-31 建，12 个操作 / 12 个错误码）**
+ [`usecases.md`](./usecases.md) 一 / 二节（12 个端口）+ 三节（5 个**随裁决增删**的端口，
已落成 `PENDING_PORTS` 常量，加上 `CopyResearch` 共 6 条）
+ [`coverage.md`](./coverage.md) 的 V1…V41 逐行映射表。

**评审时请重点看这六件**（前四件是原有的，后两件是写第 ③ 件时**查出来的**）：

1. **`PromoteConclusionToInsight` 的双返回**（入库结果 + 节点回流结果）。
   这是本束唯一的**部分成功**语义，做成单一 `Result` 会导致前端回滚已成功的入库。
2. **无 `DeleteResearch`**。原型逐字是「已**归档**该研究主题」`[原型 @16,907,049B]`，
   本束刻意不提供硬删除。若您要删除能力，请明说——**agent 不会自己加**。
3. **第三节那 5 个「还没有签名」的端口**。它们的存在方式本身是一个设计选择：
   宁可让未定的接口**有名字、可见、会在复核里被问到**，也不要等实现者顺手创造
   （ADR-020 的立论）。
4. 🔴 **`SendToSynthesisStudio`（X-D）**——这条请务必看。
   `apps/web/lib/mock/itv.ts:888` 的 `INSIGHT_REPORT_EXPORTS` 里**已经有**
   「送入综合 Studio」这个动作，而**「综合 Studio」在任何 phase 都不存在**；
   本域的研究计划屏也有同一去向（「候选洞察 7 · 待送综合 Studio 验证」）。
   ⇒ **一个已由您签核的束（`interview`）里，已有一个通往未定义目的地的出口。**
   这条**不能由本束单方面裁**（会改动已签核束的语义），已登记为 **Q-11 / X-D**。
5. 🔴 **`usecases.md` 零节「复用（不新建）」五条里，四条的出处不成立。**
   写 `research.ts` 时逐条 grep 过（`grep -rE '"(FORBIDDEN_ROLE|AGENT_RUN_FAILED|QUOTE_REVOKED|SOURCE_OUT_OF_SCOPE)"'
   packages/contracts/src` → **零命中**）：
   - `FORBIDDEN_ROLE`（称来自 `project` / `org-admin`）：**全仓不存在** ⇒ 契约改用真实存在的
     `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT`（`identity` 是它们的单一事实源）。
   - `MODEL_UNAVAILABLE`（称来自 `agent-runtime`）：存在，**但在 `skills.SkillError` 里**。
     归属写错的后果不是文档瑕疵——它会让人去改错的束，改完还以为对齐了。
   - `AGENT_RUN_FAILED` / `QUOTE_REVOKED` / `SOURCE_OUT_OF_SCOPE`：**都不存在**，
     ⇒ **由 `research.ts` 第一次声明**（`KNOWN_CONTRACT_GAPS.R1`）。
   **请裁**：这三条该归本束，还是该由对方束（`agent-runtime` / `interview` / `recording`，
   **三束均已签核**）声明？后者是**修订已签核束**，不是本束能做的。
   ⚠ `project` 束当初撞到过一模一样的形状（`usecases.md:54` 声称 `ORG_ROLE_INSUFFICIENT`
   与 phase-00 同码同义，核过之后那句话不成立）。**「声称复用」不等于「真的存在」。**
6. 🔴 **X-E 与 `files`（已签核）对不齐**——`research-run` vs `research`，见上方「为什么宁可红」一节末尾。
   **请裁对齐方向。** 这条现在有一道编译期门控守着（改名即 tsc 红），但**门控守的是「不许悄悄漂」，
   不是「已经对齐了」**。

---

## 跨束交叉约束（10 条，登记给阶段一致性复核）

逐条见 [`domain.md`](./domain.md) 第三节 **X-A … X-J**。
其中 **X-B / X-C / X-D / X-E / X-G / X-H 六条触碰已签核的束**
（`recording` / `interview` / `files` / `agent-runtime` / `chat`）。

⚠ 按 ADR-023 决策四，新增束**必须**同时加进 `design-coherence.md` 的 `covers_bundles`
**并重做复核**。本次已加字段（**只改了那一个字段**），
`status` / `confirmed_by` / `confirmed_at` **一律未动**，第二~六节的交叉约束章节**仍然留白**。
⚠ **不要把「`covers_bundles` 里有 `research`」读作「`research` 束已被复核」。**
