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
