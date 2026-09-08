# session-handoff — Phase 03（2026-09-08 夜间三轮迭代）

## 一句话

迭代 14 / 15 / 16 做完了，三个**叠放的 PR**（每个只含自己那轮的 diff），本机全绿。
**都还没合，也都没部署**——部署链路另有故障（见下）。等你早上过一遍。

## 三个 PR（按顺序看，后一个叠在前一个上）

| PR | 内容 | base |
|---|---|---|
| [#3162](https://github.com/boardx/workspacex/pull/3162) | **迭代 14** 预览时切换模拟设备（iPhone / iPad / 笔记本 + 机身 chrome + 旋转 + 缩放） | `main` ⚠ 见下 |
| [#3173](https://github.com/boardx/workspacex/pull/3173) | **迭代 15** 画布直接操作（图层面板 / 复制 / 上下移 / 键盘导航 / 快捷键安全） | `claude/iter14-devices-only` |
| [#3174](https://github.com/boardx/workspacex/pull/3174) | **迭代 16** 页管理（加/复制/删/改名）+ 一键撤销 + 把页级 op 告诉模型 | `claude/iter15-canvas-direct-manipulation` |

⚠ **#3162 的 head 分支 `claude/iter14-device-simulation` 上意外多了 15/16 两个 commit**
（我先在一条分支上连做三轮，才想起这正是我今早批评过的「一个 PR 装多个 feature」）。
共享 checkout 的 hook 正确地挡下了 force-push（改写历史会让别的会话看到 commit 消失），
所以我另建了干净的 `claude/iter14-devices-only`（只含迭代 14）给 15/16 当 base。

**合并前请先把 #3162 的 head 换成 `claude/iter14-devices-only`**——GitHub 不能改 head，
所以实际做法是：关掉 #3162，用 `claude/iter14-devices-only` 重开一个。我没有替你关，
因为那条分支上的讨论（如果有）会一起没掉。

## 需要你补签的三份文档

签核是**人的动作，我一个字没动 status**。两份 delta 已写好：

- `design-deltas/device-simulation/`（contract.md + verification.md，V71–V77）
- `design-deltas/canvas-direct-manipulation/`（contract.md + verification.md，V78–V90）
  —— 迭代 15 与 16 共用这一份，16 的内容以「迭代 16 追加」小节续在后面

两处都**没有** `design-signoff.md`，等你建并签。

## 这三轮抓到的真问题（比功能本身更值钱）

### 1. 模型从来不知道有页级 op —— 存在了 4–5 轮

`PROTOTYPE_PATCH_GUIDE` 从没提过 `addScreen` / `removeScreen`（迭代 12 起）与
`setLinks`（迭代 11 起），而它原本写着「新页面 ⇒ 用 prototype 整页给出」——
**等于教模型为了加一页把所有页重画一遍**，正是「单页超输出预算」那条根因的推手，
而迭代 12 花了一整轮做降级重试去兜它。

新增门控 **V90**（契约里每个 patch op 必须出现在 guide 里）**写出来当场抓到这两个洞**。
不是假想的风险。

### 2. 契约有能力，UI 够不着

`addScreen`/`removeScreen` 实现得很完整（连删页时"指向被删页的跳转自动偏移"都有），
但三轮下来没有任何 UI 调用它们。模型能加页删页，用户不能。

### 3. 我自己写错的两处

- 迭代 14：把「高 > 宽」写成对所有设备预设都成立，被 laptop 当场判红——笔记本天生是横的。
- 迭代 15/16 的测试：mount 辅助函数等单个 `phone-tree`，而默认画板视图有两页 ⇒
  "Found multiple elements"。

两处都是**断言错了，不是代码错**，已改并留注释。

## ⚠ 部署链路仍然坏着（不是我这几轮引起的）

main 上连续 5+ 个 run 被取消，`deploy` job 每次创建出来就在同一秒被杀。根因我已定位：

`backend-gates.yml` 第 447 行，deploy 的 concurrency group 是**常量** `workspacex-devapp-deploy`。
GitHub 同一 group 只保留**一个 pending**（这条规律该文件第 80 行自己写着），
而 main 的推送间隔 ~5 分钟、门控要 25–40 分钟 ⇒ 每个 deploy 在轮到自己之前必被下一个顶掉。
#3048 那次修复把 `run_id` 加进了 **run 级** 的组，**deploy job 自己那个组没改**。

你说已经有 agent 在处理，我就没动。但**这意味着这三轮（以及今天合掉的迭代 13）都还没上 devapp**。

## 本地全量测试：干净跑一次是全绿的

`apps/web` **271 文件 / 2295 条全绿，退出码 0**（`/tmp/clean.log`）。
2295 正好等于预期（迭代 15 后 2287 + 迭代 16 新增 8）。

⚠ 中途出现过一次「Test Files 1 failed / 0 条断言失败」，我一度以为是回归。
**根因是我自己**：并行叠了 24 个 vitest 进程互相抢资源，某个 worker 崩掉 ⇒
那个文件被计为 failed 而它的用例一条都没跑。杀干净重跑即全绿。

教训与本仓 `agent-resource-cleanup-sop.md` 同一条：**自己起的东西自己要收**。
我在"等结果"的时候反复另起新的全量跑，是这次噪声的唯一来源。

## ⚠ 我在收尾时犯的一个错（已修，但你该知道）

把 handoff 提交到了错的分支，再 cherry-pick 到 iter16 时，那个 commit 的 diff 里带着
「回到迭代 14 状态」的删除动作——**一次 cherry-pick 把迭代 15 与 16 的代码全 revert 了，
而且推上去了**（commit `a5268d53`）。

已用 `git revert` 修回（forward-only，没有改写历史），并逐字节核对过
`git diff 46fd8591 HEAD` 为空 = 内容与迭代 16 完成时完全一致。

留下的痕迹：iter16 分支上多了一对「坏提交 + revert」。没有清掉它们，因为共享 checkout
里改写历史会让别的会话看到 commit 无声消失（hook 也会挡）。看 PR diff 不受影响。

教训记在这里：`git reset --hard` 之后再 `git add -A`，提交的是「工作树 vs HEAD」的差，
而当时 HEAD 与工作树分属两个不同的状态——这正是本仓那条「静态痕迹 ≠ 动态事实」的 git 版本，
我应该在 commit 之前先 `git status` 看一眼要提交什么。

## 早上建议的顺序

1. 处理 #3162 的 head 问题（关掉重开，或你有别的偏好）。
2. 三个 PR 依次 review + 合并（15 依赖 14，16 依赖 15）。
3. 补签两份 delta。
4. 等部署链路修好后在 devapp 上实测：F59 三步问答、F63「不专业」有没有改善、
   以及这三轮的设备模拟 / 图层 / 页管理。

## 仍然悬着的（昨天就有）

- **F59–F65 拿不到 `passing`**：它们不在任何 sprint、没有 issue，而完成定义第 5 条要求
  「有对应 issue 且已由 PR 关闭」。三个方向见本文件上一版（git log 可查），我倾向承认
  这是 ad-hoc 交付并改规则，但那是流程决策，等你定。
- **issue #3138**：三个 playwright project 从未在 CI 上跑过。这三轮新写的 e2e 同样落在那里。
- **`harness readiness` 队列顶部 #2307 已经关闭了**（8/28 由 PR #2309 合并关闭）。
  「唯一取活口」指着一件做完的活——队列没有校验 issue 的当前状态。我记下来了，没深查。

## 三个 PR 的 CI 状态（2026-09-08 18:5x 收尾时实测）

**没有一个是红的。** 逐个：

- **#3173（iteration 15，base = `claude/iter14-devices-only` @ `a65c03f9`）**：进行中，
  已完成的全绿——`merge-gate` / `gates-runtime` / `gates-fast` / `verify-affected` /
  `verify-full-compile` 全 success，`fullstack-smoke`、`verify-control-plane` 在跑，
  gates-test ×4 / e2e-core-loop / native-* 还在排队。0 个 failure。
- **#3174（iteration 16）**：18:43–18:44 刚起，17 个 check 里 3 个 skipped、其余排队。还没有结论。
- **#3162（被污染的 `claude/iter14-device-simulation`）**：所有 check 在 18:29–18:30
  被 **cancelled**（不是失败）——被后续 push 的并发组挤掉。这个 PR 本来就要按上面第 1 条处理。

另外一条对早上 review 有用的事实：**base 提交 `a65c03f9`（纯 iteration 14）已经单独跑完
一整轮 CI 并且 `conclusion: success`**（`claude/iter14-device-simulation` 的 run #2775）。
也就是说三个叠放 PR 的最底层已经被独立验证过一次绿。

⚠ 排队中的 check 会继续跑完，早上看到的结论可能与此处不同——**以你打开 PR 时的实际状态为准**，
这一节只是「我离开时没有红」的存档。按人类指令，我没有合并其中任何一个。

### 19:49 复查更新

- **#3173**：17 个 check 里 16 个已完成、**全 success**（含 e2e-core-loop、fullstack-smoke、
  native-*、gates-test 1/2/4），只剩 `gates-test (3)` 在跑。仍然 0 failure。
- **#3174**：13 个已完成、**全 success**（含 gates-test 1/3/4、e2e-core-loop、fullstack-smoke、
  verify-*、merge-gate），`native-document-chain` 在跑、`gates-test (2)` 排队。0 failure。
- #3162 无变化（cancelled，早上处理）。

### 20:35 复查更新

- **#3173：17 个 check 全部完成、全绿。**（`deploy` 是 skipped——PR 分支本来就不部署。）
- **#3174：`gates-test (3)` 红了一次**，其余 16 个全绿。失败的是
  `apps/api/tests/agent-runtime/bailian-image-bounds.test.ts >
  「deadline aborts a stalled submission body and does not resubmit」`，
  报 `Test timed out in 60000ms`，同 shard 另外 238 个文件 / 1951 条用例全过。

  判断依据（不是「大概是 flake」）：
  1. 这个文件测的是**百炼图片 provider 的超时/取消边界**，跟这三轮改的
     design-workbench 没有任何调用关系——迭代 16 的 diff 一行都没碰 agent-runtime。
  2. 用例自己给 provider 的 deadline 是 **100ms**、断言 `< 2000ms`，却卡到 60s 超时。
     这是「机器被压住、定时器没按时跑」的形状，不是断言失败的形状。
  3. **#3173 的同一个 shard（gates-test (3)）跑同一份 agent-runtime 代码是绿的。**
  4. 本地复现不了——**这个远程会话没有 docker daemon**，`tests/support/db-global-setup.ts`
     起不来（`failed to connect to the docker API at unix:///var/run/docker.sock`）。
     所以我没有「本地也绿」这条证据，只有上面三条。

  处置：按 drive-to-green 的规则用掉**唯一那一次**重跑（`rerun_failed_jobs`，
  run 34271233835）。**如果重跑还红，那它就不是 flake，是真问题，要当成真问题查**——
  下一次复查会看结果。

⚠ 顺带记一笔：这个测试用**真实计时**断死 2000ms 上界，在满载 runner 上天生脆。
如果它再红，值得单开一个 issue 让它用假时钟，而不是继续靠重跑糊过去。

### 21:24 复查更新 —— 上一节的判断错了一半，这里是订正

重跑**同样红、同一条用例、同样 60s**。按我自己写下的判据，它就不是 flake。往下查的结果：

**根因不在我的 PR，但也不是「机器压住了」——是 main 上的一个真 bug，而且已经修好了。**

- `readBoundedJson(response)` 不收 `AbortSignal`。`generateImage` 造的
  `AbortSignal.timeout` 只传给了 `fetch`，而 `fetch` 在**响应头一到就 resolve**；
  之后 `reader.read()` 能不能被打断，完全取决于底层 transport 肯不肯销毁 body 流。
  活性被外包给了 transport 的善意 —— 于是「100ms deadline」的用例能挂满 60s。
- **main 上同一条用例在 run 34257392836 就红过**，已由 **PR #3176**（`c73cee81`，
  已合入 main）修复：signal 传进 `readBoundedJson`，读循环每轮与 abort 竞速。

处置（按 drive-to-green「修法已存在就 port 进来」那一条）：
`git cherry-pick -x c73cee81` 进 `claude/iter16-page-management`。等 main 合进来时它自动 no-op。

验证（本地都真跑了，不是推断）：
- `git diff 442fc417 HEAD` 与 `git show c73cee81` **逐字节相同**——cherry-pick 没夹带别的。
- 隔离跑该文件（绕开需要 docker 的 globalSetup）：**9/9 绿，297ms**。
- **反证**：只把 provider 源码退回修复前、保留新测试 → 新增的
  「enforces its own deadline when the transport ignores the abort signal」
  红在 `Test timed out`，与 CI 上一模一样的签名；装回 → 9/9 绿。
  这条 port 是有承重的，不是摆设。

⚠ 订正上一节：我当时把它归给「满载 runner 上定时器被争用」。那个解释是错的——
真相是 promise 从来没 settle。**「卡满整个超时」和「计时被争用打飞」形状不同**，
前者是死等，后者会晚一点点但仍会 settle。我当时没有区分这两种形状就下了结论。
