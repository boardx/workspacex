# session-handoff — Phase 03 · 迭代 13 收尾（2026-09-08）

## 一句话状态

迭代 13 的七个 feature（F59–F65）**代码已合入 main（`4da85d57`）并随合并部署到 devapp**，
PR #3115 合入时 18 个 check 全绿。但它们在 `feature_list.json` 里仍是 `not_started`，
**而且按现有规则无法合法转 `passing`**——差的不是代码，是一道可见性门。

## 需要人类裁决的一件事

### F59–F65 拿不到 `passing`，因为它们从来没有过 issue

完成定义第 5 条：「该 feature 在 GitHub 上有对应 issue，且该 issue 已由 PR 关闭」。

现状：
- 这七个 feature `sprint: null`、`owner: null`、`github_issue: null`；
  phase-03 目录下**没有 `sprints/`**，它们从来没被领进任何 sprint。
- `sync-github.ts` 头注逐字：「只对当前/近期 sprint 开 Issue」——补 issue 要先补 sprint。
- 关闭它们的 PR（#3115）**已经合了**。事后手工建 issue 再手工关，不等于「由 PR 关闭」，
  而 `doctor` 第 ⑤ 条判的是合入时刻的事实。
- 第 6 条（实现已在 main）与第 7 条（合入时 CI 全绿）**都满足**。

成因不是疏忽：人类 2026-09-08 交办的是「按照你的计划，不要再问我问题，你要直接迭代出来
PR 直接推倒 Devapp」——一条刻意绕开 sprint/issue 流程的快车道。AGENTS.md 为这种情况留了
`ad-hoc-fix-pr-sop.md` 这个逃生口，但那条口子写的是「bug 修复、小功能点」，而这七条是
`feature_list.json` 里的正式 feature。**规则与实际工作方式之间有一道真实的缝，需要人类决定怎么合。**

三个可选方向（我不替你选）：

| | 做法 | 代价 |
|---|---|---|
| **A** | 补一个 sprint，把七条领进去，`harness sync --apply` 建 issue；后续每条各开一个小 PR（哪怕只是补 evidence），由那个 PR `Closes #N` | 七个 PR 的开销，但审计链完整、`doctor --strict` 会绿 |
| **B** | 承认这是一次 ad-hoc 交付，把七条移出 `feature_list.json` 或标注为「已交付但不走 passing 门」，并在 `ad-hoc-fix-pr-sop.md` 里把「用户直接交办也可能是 feature 级」这条写进去 | 规则要改，但改的是一条本来就与实际不符的规则 |
| **C** | 放着不动 | `feature_list.json` 长期谎报——七件已经上线的东西显示 `not_started`。**这是最坏的一种**，因为清单是权威 |

我的倾向是 **B**：这七条确实是人类直接交办、不经 sprint 的产物，规则该承认这条路径存在，
而不是让清单持续失真。但这是流程决策，不是技术决策，该你定。

⚠ **不要因为 `pnpm harness doctor` 本机报 0 FAIL 就以为没事**——它那行
`读不到 GitHub issue（gh 未登录 / 离线）—— 本次跳过` 说明第 5 条根本没被检查。
本会话所在的远程环境没有 `gh`，CI 上 `--strict` 才是真判据。

## 已经做完、不需要再动的

- 代码、测试、门控：全部在 main 上，CI 合入时全绿。
- `progress.md` 已记本轮完整经过，含 CI 抓到的两个真 bug 与反证抓到的六处「为错误理由通过」。
- cloud session（F61）已归档；PR #3115 已 unsubscribe。

## 待办（不阻塞，已建 issue 或已写清）

1. **issue #3138** —— `design-prototype-loop` / `design-loop-responsive` / `axe-keyboard-focus`
   三个 playwright project **从未在 CI 上跑过**。按本仓判据它们等于不存在，本轮新写的
   V60 参考图拖拽 e2e 也在其中。建议给它们一个不带 docker webServer 的独立 config
   （它们全靠 `page.route()` 夹具、不读库，为它们起一整套 compose 不划算）。
2. **F63 需要人类实测** —— 视觉判据是 prompt 改动，单测只能证明约束进了提示词，
   证明不了产出更好看。请在 devapp 上真实生成一轮，看「不专业」这条反馈有没有真的解决。
3. **可能的迭代 14** —— 用紧凑 DSL 替代冗长 JSON。已实测过压缩比：同一棵树 JSON 324 字符
   vs 紧凑 DSL 111 字符（2.9×）。它直接缓解「单页超输出预算」那条根因，比降级重试更治本。

## 下一轮开工先做

1. 读本文件顶部那件需要裁决的事，拿到人类的选择再动 `feature_list.json`。
2. `pnpm harness readiness` 看统一队列，从队列顶部取活。
