# main coordinator 的常驻目标与三级 loop

> **这份文件是给「上下文被压缩之后的我自己」看的。**
> 对话里的目标会随压缩丢失，写进仓库的不会（`AGENTS.md` 硬约束：仓库即唯一事实来源）。
> 每次 loop 醒来**先读这份**，再看 `git log` 与门控输出，然后决定下一步。

## 人类的授权范围（2026-07-30，逐字）

> 全面审核 UI，然后修正现在的整体和细节设计，我们先**暂停 push**到下一步。
> 我授权你，做决定做调整。需要快速决定修正一轮以后，尽快进入开发。
> 但是要**尽可能多的找出问题修正然后避免返工**。
> 我需要你作为**架构师、需求分析师、UIUX 专家、程序员、最终用户**的多个角色来审视我们的设计
> 是否有问题，找出问题然后 fix。这些步骤**并不需要我参加决策**。
> 我只需要做最后的验收，如果不行，我测试完以后生成一个新的 phase 来迭代一轮。

> 你需要自己建立一个 loop 以便保持你的整体的目标不变，建立不同级别的 loop 以使你不会跑偏，
> 还有就是你**不能停止了**，如果我没有回复你或审批的话，你需要继续推理和完成工作。**不要停下来。**

⇒ **我有全权做设计决定**；人类只做最终验收。**不许再拿选择题去问他**，
除了两类：① 会推翻他已明确裁决过的事 ② 签核动作本身（`status` / `confirmed_by` / `confirmed_at`）。

## L1 · 战略目标（不变，直到人类改口）

**让 phase-01 在尽可能少返工的前提下进入开发。**

达成判据（全部满足才算 L1 完成）：
1. 十一个契约束的三件材料与**权威原型**一致——不是「自洽」，是**对得上原型**
2. `feature_list` 覆盖原型里真实存在的能力，无缺失、无凭空发明
3. 五个角色视角各自过一遍且问题已修：架构 / 需求 / UIUX / 程序员 / 最终用户
4. 全部门控绿（且是 `TURBO_FORCE=1` 下的绿，不是缓存的绿）
5. 人类完成十一束签核 + 阶段一致性复核

⚠ **暂停 push**（人类明示）。本地 commit 照常，**不要 `git push`**，直到人类说可以。

## L2 · 当前战役（2026-07-31 起）：**phase-01 开发**

⚠ 上一场战役（审核修正轮）**已完成**，原文见下方「上一场战役（存档）」。
人类 2026-07-30 逐个签核了 12 束 + 一致性复核，并授权：
> 上面的任务做完就开始推到 GitHub 开始开发吧，我需要休息了，**在我醒来之前不要停掉开发**，
> 需要通过 **subagent** 来加快，把整个 phase1 给做完。

⇒ **push 解禁**（上一场的「暂停 push」已作废）。

### 波次（拓扑排序，无环，无跨阶段悬空依赖）

| wave | feature | 点 | 状态 |
|---:|---:|---:|---|
| 0 | 19 | 72 | **sprint-01，issue #38–#56，已全部 claim** |
| 1 | 34 | 121 | 待 |
| 2 | 36 | 121 | 待 |
| 3 | 20 | 64 | 待 |
| 4 | 17 | 71 | 待 |
| 5 | 15 | 53 | 待 |
| 6 | 3 | 11 | 待 |

### 并发模型（**这段是防事故的，不要改**）

**`feature_list.json` 的状态变更只在主 checkout 发生，只由我做。**
19 个 agent 各自在 `isolation: worktree` 里实现，**一律不碰**
`feature_list.json` / `PROGRESS.md` / `sprints/` / 任何 `design-signoff.md` / `roadmap.yaml`。
`claim` 我已经在主 checkout 里逐条做完（owner = `w0-<area>`，每个 owner 恰好一个 in_progress）。
`verify` 也由我在主 checkout 集中跑。

⇒ 否则 19 个工作树会同时改同一个 JSON，合并冲突把一晚上的工作变成一晚上的 rebase。

### 每个 feature 的完成定义（照 AGENTS.md，不打折）

1. 行为端到端可见 2. 每条 `verification` 退出码 0 3. 证据落 `evidence`
4. `./init.sh` 基础验证仍过 5. **有 issue 且被 PR 关闭** 6. **已合入 main**

⇒ agent 交付物 = **分支 + PR（带 `Closes #N`）+ issue 上的实现评论**。
**agent 不许把 feature 标成 passing**——那是 `harness verify` 的事，我来跑。

### 上一场战役（存档）：一次审核修正轮

### 阶段 A · 穷尽原型（进行中）
- [ ] `PROTOTYPE-SWEEP-UI.md` —— 字节 15.0–16.6M 界面区**通读**
- [ ] `PROTOTYPE-SWEEP-DATA.md` —— 字节 16.6–17.1M JS 数据区**通读**

**为什么必须通读**：本轮九处「被判缺失、实则存在」全是**定点抽取**发现的，
从没有人通读过。四处以上的证据在 16.6–17.05M，**不在左栏导航上，点原型点不到**。
最隐蔽的一类是**默认值画反**（项目级 AI 开关：我们全关、原型多为开）——看截图看不出来。

### 阶段 B · 五角色审视（待派）
- [ ] 架构师：束切分与边界重叠、跨束约束、契约一致性、已签束是否被新需求破坏
- [ ] 需求分析师：`feature_list` 124 条 vs 原型 vs UC，缺失/多余/歧义/归属
- [ ] UIUX：七态与四视角的真实性、IA 一致性、可达性、跨域视觉与文案一致
- [ ] 程序员：契约可实现性、门控是否真能红、命名单源、迁移影响
- [ ] 最终用户：走真实任务路径（办一场工作坊 / 做一次研究 / 导入一个 skill），能不能跑通

### 阶段 C · 修正（待派）
按 A/B 结果分批修。**每一处修正都要能指回一条证据**（偏移 / grep / 门控输出）。

### 阶段 D · 收口
- [ ] `TURBO_FORCE=1 pnpm -w run verify:base` 全绿
- [ ] `node .harness/scripts/lint-ui-material.mjs` 绿
- [ ] `pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 01` 只剩人类字段那条红
- [ ] 出一份人类验收清单（**签什么、在哪、按什么顺序**）

## L3 · 每次 loop 醒来的检查动作

1. 读本文件 → 确认 L1 判据哪几条还没满足
2. `git log --oneline -8` → 上一轮做了什么
3. `node .harness/scripts/lint-ui-material.mjs` + `TURBO_FORCE=1 pnpm -w run verify:base`
   → **门控的绿必须是 force 出来的**
4. 有 agent 回来 → 先核它的硬主张（本轮多次出现 agent 报告与实测不符），再提交
5. 没有 agent 在跑 → 按 L2 未完成项派下一批
6. **不要问人类**，除了 L1 第 5 条那两类例外

## 已知的、绝不能忘的纪律（每条都有事故）

| # | 纪律 | 事故 |
|---|---|---|
| 1 | **绝不 `git add -A` / `git commit -a`** | 两次扫走别人在飞的工作树（含 174 个构建产物） |
| 2 | 共享 checkout 上 `git add <path>` + `commit` **也不安全** | 索引是全仓共享可写状态，第三次事故 |
| 3 | 写文件的 agent 一律用 `isolation: worktree` | 同上 |
| 4 | **门控的绿要 `TURBO_FORCE=1` 复验** | `turbo.json` 缺 `apps/web/**` inputs，一条跨包门控被缓存掩盖整轮 |
| 5 | **我的临时统计脚本错过三次** | 死链统计正则错、返回 0，拿着错数字汇报两次 |
| 6 | 给人类出候选前**先穷尽仓库里已有的答案** | 五次「已有答案却在被重新裁决」（D-03a / Q-12 候选不全 / O-32 / chat 三条 / tpl 规则）|
| 7 | **原型是权威，UC 文档是次级** | `itv` v1 读文档不读原型，44 张截图整套推翻，而门控全绿 |
| 8 | **先 grep JS 路由表与数据数组，再点界面** | 同一盲区五次命中 |
| 9 | 断言**性质**不是**数量** | `toHaveLength(N)` 会挡住正当新增；债务上限成移动靶 |
| 10 | 缺口要**可见、有名字、会在 doctor 里出现** | 宁可红，不可假绿；空集会让断言平凡为真 |

## 开发期新增的坑（2026-07-31，每条都有事故）

| # | 坑 | 怎么发现的 | 对策 |
|---|---|---|---|
| 11 | **agent 拿到的 worktree 基线是旧的** | F55 的工作树坐在 `2d86edc`，那里 F55 的 verification 还是 `pnpm --filter web vitest run …`——正是 `lint-verification-can-fail` 手工点名的「恒 exit 0」假绿形态 | 每份 worker prompt 必须逐字带 `git fetch origin && git checkout -b <branch> origin/main`。**这条救过一次** |
| 12 | **多 worktree 共用同一个 postgres 会互踢** | F116 首次全量跑出 77 failed / `Connection terminated unexpectedly`；别人的 `DROP DATABASE … WITH (FORCE)` 踢掉连接 | prompt 里写明：遇到设独有 `WORKSPACEX_DB` 重跑，**不要当成代码缺陷去改代码** |
| 13 | **迁移序号会撞车** | F116 与 F118 的 notes 都写「下一个可用序号是 0018」 | F116 占 0018；**F118 改 0019**。后续同时派两个带迁移的 feature 时，coordinator 先分号 |
| 14 | **`verify-rls.sh` 的下限是共享棘轮** | F116 把 8 抬到 29 | 后续任何新增租户表的 feature 都要同步抬数，否则它会红 |
| 17 | **`git stash` 栈是整个仓库共享的，不是每个 worktree 一个** | F07 的 worker 用 `git stash` 做基线对比，它的 `git stash pop` 弹出并**丢弃了 F48 的 stash 条目**（迁移 + `src/{application,domain}/model/` + 测试 + 两套 fixture）。文件被解到错误的工作树里，恢复到 scratchpad 后人工归还 | worker prompt 必须写明：**不要用 `git stash` 做基线对比**。改用 `git worktree add` 另开一份，或 `git stash create`（只造对象、不入栈）。这是纪律 1/2「共享可写状态」的第四次事故——索引、工作树、**stash 栈**都是全仓共享的 |
| 18 | **共享开发库会被别的分支的迁移污染** | F07 的用例在 24 个文件里炸 `null value in column "kind"`——`projects.kind` 已被应用到共享库 `workspacex`，而 F07 的分支里没有那条迁移（它是 F116 的 0018） | 每个 worker 用独有的 `WORKSPACEX_DB`。共享库对「分支各自有迁移」的模型天然不成立 |
| 16 | **并发上限不是「agent 数」，是这台机器** | 13 个 agent 并发时 load average 到 **102**、104 个 vitest 进程；`verify:base` 里大批 `@repo/api` 用例以 **10 秒超时**红掉（单跑全绿），一个 agent 串行重跑被 OOM kill，两个 agent 因此用了 `--no-verify` push | **本机并发上限约 6–8 个 agent**。超过之后 agent 验证不了自己的活 ⇒ 只能 `--no-verify` ⇒ 唯一诚实的检查变成 GitHub CI（它不受本机负载影响）。**加 agent 反而让交付质量下降** |
| 15 | **签核门控的测试偶发红** | `design-signoff.test.ts:309` 在一次 `verify:base` 里红过（`expected […(4)] to deeply equal []`），单跑 5 次全绿 | 已开独立任务查根因。⚠ `auditSignoff` 是整条签核链**唯一**的判定实现，偶发红/绿 = 这条链在随机放行 |

## 状态快照（每轮更新）

- 分支 `docs/requirements-prototype-audit`，最后提交见 `git log`
- phase-00：22/22 passing，已在 `main`
- phase-01：124 feature / 417 点；十束已签 9（`project` 待签）+ 第 11 束 `asset-governance` 在建
- 一致性复核：`pending`（**必须等全部束签完**）
- ⚠ 已知既存红：`pending-thresholds` 三处「180 天」硬编码（背景任务在修 `turbo.json` inputs）
