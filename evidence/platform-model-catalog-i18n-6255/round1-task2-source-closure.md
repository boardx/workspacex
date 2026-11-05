# Task 2 round 1 scoped SOURCE closure

Verdict: **原两条 finding 均在 SOURCE 层关闭；本轮范围内无新增 finding。** 这不是 gate、native、布局、PNG 或整页验收通过。

精确绑定：ROOT 提供的提交 `1592030295da4111e380a340a4ef22b63735e5cf`，输入 diff 为本目录 `round1-task2-review.diff`（`26538a499f39ab127f11f7587a1a61069cce2829` → `159203…`，仅一个 spec）。后续 login WIP/round 2 不在范围内。已用 narrow `git show 159203…:PATH` 独立复核固定提交的源码/哈希，避免后续工作树变化混入。

- 固定提交 spec SHA-256：`36f91b792ac1db06b18e3cc0638191104cdaecc4949d95e6f0a8d4bef6fa9bee`。
- 固定提交 config SHA-256：`5b5e8fe32f03826d970fd36d1df7e901c30dce6595ed5e89280eb63f29264a2d`，与原审查相同。

## Finding 1 — drawer top anchor：SOURCE CLOSED

`apps/web/e2e/platform-model-catalog-i18n.spec.ts:285–289` 将原 fixed header heading 改为 exact English `Model ID` label 的父 KV row，并断言该 row 包含 canonical `model.modelId`。固定提交的 `KV` 是同一父 div 内的 label/value 两个 span；public detail 的首个 metadata KV 正是 Model ID。因此新的 anchor 指向实际 scrolling body 内的首行，而非外部 header。

原 `shots` 流程保持：先逐元素 audit，再对传入的 body row 原生 `scrollIntoViewIfNeeded`、ratio-1 断言，然后取 top viewport PNG；bottom 仍锚最后 source link。修复直接解决原先只滚已经可见 header、无法重置 sibling body 的问题。没有加入样式改动、强制点击、预算扩大、截图覆盖豁免或 provider 行为。本轮没有发现该改动引入的 selector/内容绑定问题。

这里只证明 source anchor/流程正确，不证明实际 first row 或其他内容已完整出现在任何 PNG 中。真实嵌套滚动、遮挡、375/1280 geometry、长参数列表中间内容覆盖仍须运行及逐图检查。

## Finding 2 — budget claims：SOURCE CLOSED

`task-2-report.md` 和 `task-2-draft-report.md` 已在前台明确更正：选中的 `seeded-github-import` 项目与 config root 不设置 test/assertion timeout 或 workers；继承默认 **30s/test、5s/assertion**。固定 config root 的 `retries: process.env.CI ? 1 : 0` 是 **CI 1 / 非 CI 0**。根 `verify:fullstack-smoke:raw` 命令只额外设置 `--max-failures=1`，不建立 120s/20s/1-worker/0-retry。

报告明确 workers 随实际 invocation/artifact 决定；ROOT 提供的旧 run `41917734613` 为 2 workers，只是旧 run 的事实，不能证明新 spec 的有效 worker 数。该旧 run artifact 未由本 reviewer 独立读取。没有找到 `task-2-canonical-discovery.md`；只在本 plan 私有目录内定位到上述两份更正报告，没有扩大查找或重审范围。

公开源码/config 没有为满足旧声明增加 timeout/retry/worker override，原 unsupported 声明被明确承认为不成立。预算问题以准确说明继承事实关闭，不以虚构 runtime budget PASS 关闭。默认预算能否容纳 audit 工作量仍完全未知。

## 执行与范围边界

本轮仅只读源码/diff/私有报告及哈希，并仅写本文件。无 tests、collection、typecheck、lint、build、browser、services、DB、网络、Git mutation、源码修改或子 agent。三个 native case、最多 22 个计划 PNG 和新 source gates **全部仍未运行**；不能据此主张实际 worker 数、耗时、截图数量、视觉质量或 native PASS。后续 login 消费时序修复须另按 round 2 的固定 diff 审查，未被本次 closure 覆盖。
