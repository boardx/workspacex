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
covers_bundles: [agent-runtime, canvas, chat, files, interview, org-admin, project, recording, skills, templates]
status: pending            # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:              # 确认人（姓名/邮箱）
confirmed_at:              # ISO 8601，且不得晚于签核当下
---

# phase-01 阶段一致性复核（ADR-020 第二级门 / ADR-023 决策四）

> **本文现在是骨架，不是结论。** 2026-07-30 与九个契约束的骨架同时建立。
> 正文的「交叉约束」章节**留白待填**——填的时机是**九个束全部签完之后**，
> 因为它查的是束与束之间打不打架，而束本身还没定稿时查这个只会查到草稿的影子。
>
> **只查交叉约束。** 单束内的问题在签该束时已经看过了，这里不重复。

## 一、复核范围（**十个束** / 111 个 feature / 361 点）

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

### 与架构师原切分表的一处出入（已按磁盘为准）

原切分表把 `org-admin` 写作 **8 个 feature / 30 点**。磁盘上 `area: auth` 的是 **12 个 / 30 点**
（点数一致，件数不一致）——`F01 F02 F08 F09` 已随 auth 最小可用切片迁入 phase-00，
`feature_list.json` 里的副本已删除，剩下的 12 件全部收进 `org-admin`。
按 8 件切会留下 4 件不属于任何束，`assertDesignSignedOff` 会直接拒绝它们开工。

## 二、交叉约束 —— **待填（九束签完后做）**

> 查什么（`contract-design.md` §四）：
> ① 同一事实是否在多束中被重复定义（本项目最高发的缺陷）
> ② 跨束的不变量是否互相矛盾
> ③ 跨束的级联是否闭合（每一环都有人接吗）
> ④ 错误语义是否一致（同一种失败在不同束里是不是同一个错误码）

### 待议清单（建骨架时各束自报的跨束点，**是议程不是结论**）

下列条目由九个束在写各自 `domain.md` / `coverage.md` 时自报。
把它们记在这里只为**保证复核时不漏掉**；**每一条的处置都还没做**，
不要把这张表当成已经裁决过的东西读。

| # | 待议 | 谁提的 | 为什么必须在这里处置 |
|---|---|---|---|
| X-1 | **机密数据模型路由口径 D-U1**：「整轮全本地」还是「机密走本地、云端并存承接非机密」 | `chat` · `agent-runtime` · `templates` | 原型**字面自相矛盾**（`ui-preview/README.md` S-01 自列为「🔴 必须先定」第一条）。两个束都要写同一条规则，gateway 只能有一个实现 |
| X-2 | **provenance / 审计查询面统一** | `files` · `chat` · `canvas` · `skills` · `org-admin` · `interview` · `recording` · `agent-runtime` | phase-00 已裁决「统一查询面，不属任何单束」（phase-00 X-2）。phase-01 有**八个束**要写事件——这是它第一次被大规模消费，各束各造一个就是又一次漂移 |
| X-3 | **`sourceType` / `ArtifactSource` 词表两套且对不上**：mock 8 值 vs `packages/contracts/src/artifact.ts` 7 值，三对同义异名，`workshop`/`canvas` 契约里没有 | `files`（UI 原型侧确证） | 已发生的漂移，不是风险。裁决前不得写 `files.ts` 的枚举，否则是第三份副本 |
| X-4 | **三层权限求交**：第 ①② 层在 `agent-runtime`，第 ③ 层（任务权限包）在别处 | `agent-runtime` · `org-admin` | 三层是**一个判定函数**，分两处实现就是下一次「同一事实两处声明」 |
| X-5 | **角色本体装不下的职能**：合规负责人 / 安全评审人 / 方法论审核人 / 能力维护者 / 场景角色（研究员·受访者·参与者） | `org-admin` · `skills` · `agent-runtime` · `files` | `org-admin` 已核实 **D-U3（2026-07-28）裁过**「合规归组织角色、不加第三层」，`ui-preview/README.md` 的 S-02/S-03 是**过期表述**；但 `skills` / `agent-runtime` 又提出另外三种职能——需确认 D-U3 是否覆盖它们 |
| X-6 | **议程环节（`agenda_segment`）是谁的**：绑定挂载点、三视角首屏切换驱动源、临时提权失效锚点 | `templates` · `canvas` · `skills` · `org-admin` | `org-admin` 有**两条不变量**的锚点在这个状态机上，而它既不在 `org-admin` 也还不存在 |
| X-7 | **撤回链 SLA + 六条级联闭合**（D-13 / D-15 两级） | `interview` · `recording` · `files` · `org-admin` | 跨 6 个模块，**已因两处声明漂移过一次**。级联少一环 = 合规承诺是假的 |
| X-8 | **file-first 与删除传播**：录制产物 / 画布源码 / 对话 `messages.jsonl` 都要登记为 `artifact_versions` 并沿用同一套 `acl_bindings` | `recording` · `canvas` · `chat` · `files` | 五份 UC 都各自重复写了「文件浏览器不是权限旁路」——**重复本身就是它会被实现两遍的信号** |
| X-9 | **`referenceForDownstream` 引用资格门** | `chat` · `files` | phase-00 `artifact` 束缺口③ 说「下游桩不在本束」，F114 是它**第一个真实下游**。每个下游各判各的，AC1 会被绕过 |
| X-10 | **Context API 是唯一通路**（起草 / skill / 图谱 / 副驾驶 / 归纳都不得直查 DB 或向量库） | `canvas` · `skills` · `interview` · `recording` · `agent-runtime` | 直查一次，PII 策略与权限判定就有第 N 份。这是依赖方向规则，**归属门控（`lint-arch-deps`）待定** |
| X-11 | **`omissions[].reason` 与各类阈值单源**（`packages/contracts/src/thresholds.ts` 待定阈值登记表） | `canvas` · `skills` · `interview` · `templates` | 本仓发生过「有人编了 `sampleSize=18` 制造出已算过的假象」。凡待定数值一律登记、取值抛错，不许落进 mock |
| X-12 | **同意四项在仓库里有三个互相冲突的版本**（UC-6.3 拍板版 / `lib/mock/interview.ts` 旧版 / `lib/mock/entry.ts` 三项版），且「交给 AI 分析」这一项**在已建成界面里不存在**，而 O-05 的全部合规约束挂在它上面 | `interview` · `org-admin` · `recording` | 两份都是**手写 mock**——`contract-design.md` 硬规则第 2 条防的就是这件事，而它已经发生了 |
| X-13 | **快照语义不得分叉**：蓝本版本快照 / 模板实例固化 / skill 版本锁定 / 访谈模板套用即脱钩，与 phase-00 `artifact` 的版本不可变是同一条性质 | `templates` · `skills` · `canvas` · `interview` | 四个束各写一遍「快照不漂移」，四份实现只要有一份漏了就是数据损坏 |
| X-14 | **可见性范围 vs MCP 授权范围禁止合并成同一字段** | `templates` · `agent-runtime` · `skills` | 两者语义不同，合并是「同一事实两处声明」的反面：**两件事一处声明** |

### 处置（复核时填）

<!-- 每条待议给出：裁决 / 归属束 / 断言落点 / 若不处置的后果。照 phase-00 design-coherence.md 第一节的写法。 -->

## 三、错误语义一致性检查 —— **待填**

<!-- 九束的失败枚举合计数百个错误码。查同一种失败是否用了同一个码：
     无权限 / 资源不存在 vs 无权限 / 依赖不可用 / 并发冲突 / 幂等重放 / 撤回中 / 配额超限。
     phase-00 已定的语义（不泄露存在性、依赖不可用一律拒绝不降级）phase-01 必须继承，
     发现某束自立一套就在这里收敛。 -->

## 四、单源检查：下一次漂移的候选 —— **待填**

> 本项目已因「同一事实声明在两处」漂移 **7 次**
> （设计 token · 字号档位 · 丢弃原因枚举 · 撤回链 SLA · 估点 · 七态保留 testid · `sourceType` 词表）。
> 第 7 次就在本阶段，见 X-3。

<!-- 逐个列候选、出处、处置。手写 mock 是最大的一类来源：
     lib/mock/{chat,entry,interview,tpl}.ts 目前都是手写的。 -->

## 五、开工前必须补的（阻塞项）—— **待填**

## 六、不阻塞但需人类裁决 —— **待填**

---

## 现在挡住了谁（建骨架的直接后果）

`contracts/` 目录一建立，`assertDesignSignedOff` 对 phase-01 **从静默放行转为生效**
（`contract-design.md` §门控的三条实际行为 第 1 条）。于是：

- `pnpm harness new-sprint --phase 01 …` 拒绝
- `pnpm harness claim`（**真正的开工动作**）拒绝
- `pnpm harness doctor --phase 01` 报签核链不合格

拒绝理由有两级，**两级都要过**：
1. 该 feature 所属束的 `design-signoff.md` `status` 不是 `confirmed`（现在**十个束**全是 `pending`）
2. 本文件的 `status` 不是 `confirmed`（现在是 `pending`）

另有第三条**结构性**拒绝（与开工无关，但会让 `doctor` / `verify-uc-coverage` 报红）：
3. `project` 束的 `covers:` 为空 —— 见上方第一节末尾，**这是它的正确状态**，不是待修故障。

⇒ **phase-01 的 111 个 feature 现在一个都开不了工。这是预期效果，不是故障。**

## 确认动作

1. 人类逐束核对三件（① UI ② 用例 ③ API 契约），把束的 `status` 改为 `confirmed`。
2. **九束全签完后**，人类做本文第二~六节的交叉约束复核，再把本文 `status` 改为 `confirmed`。
3. ⚠ **顺序不能颠倒**：先签本文再签束，等于用一份没看过束内容的复核放行——
   ADR-023 背景 1 记录的就是这件事，且它已经真实发生过一次。
4. ⚠ **这是人的动作，不是 agent 的。** `status` / `confirmed_by` / `confirmed_at`
   由 CODEOWNERS + CI 保护（ADR-023 决策五），agent 不得代劳，也不得为了让门控变绿而改这些字段。

### ⚠ 第 ① 件（UI）目前不具备签核条件

`phases/phase-01-run-a-project/ui-preview/` 下**只有 markdown 与 `files/` `itv/` `rec/` 三个截图目录**，
其余六个束零截图。九个束的 `ui.md` 全部写成「待 ui-prototyper 产出后补」的骨架，
并各自列出了本束需要哪几块屏、哪些已建成、哪些从零补画。
**在截图补齐之前把束签成 `confirmed`，就是 ADR-023 背景 3 那个爆点再犯一次。**

### 现存 `ui-signoff.md` 的处置

`phases/phase-01-run-a-project/ui-signoff.md`（phase 级、`status: pending`）按 ADR-023 决策一
**并入束级 `ui.md`**，不再单独签。该文件本轮**未删除**——删它是把一份 `pending`
的签核记录抹掉，属于人类的决定；建议在人类签第一个束时一并处置。
