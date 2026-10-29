# #5954 — 画像生成成功后的测试读取竞态

2026-10-27，基于 `origin/develop@78a91f5965222eef6ef5a77faf01837c877b204f`，复用 e435。

## CI 反证

run 40499219659 / chat-read job 122172380213 中 CK-P6 超时，但 trace 显示：

- `POST persona-summary` 在 12:17:52.905 返回 200，耗时 53.648ms。
- 随后的 messages GET 200，包含画像消息 `pmsg-ce87c3bd-3630-4239-bca9-3222de3146b5`；失败快照已有 Fabric 只读预览。
- `trigger.count()` 返回 1 后，成功状态将 chip 移除；紧接着的 `trigger.textContent()` 自动等待这个已消失的元素约 120557ms，最终测试结束。

因此这次失败不能推断为画像生成失败或会话失效。两个异步读取之间存在竞态。

## 修复

将 count + textContent 改成单次 `allTextContents()` 无等待快照。按钮消失仍代表轮询结束，但最终成功仍由无失败提示、一个真实图表块、刷新后仍为一个图表块共同把关。不改超时、不跳过测试、不改产品实现。

## 验证

- 定向 lint：exit 0。
- web typecheck：exit 0。
- 本地 repeat3 / 3 workers：3 failed，均在登录页加载脚本时耗尽 300 秒，未进入画像业务，不计为修复通过。
- 本地 repeat3 / 1 worker：第一轮在 runtime info 预热请求 15 秒 / poll 120 秒预算内失败，第二轮仍在页面加载阶段超时；停止剩余重复，保留 trace。独占隔离栈由外壳清理，不改变断言或预算来掩盖失败。
- CI run [40520502682](https://github.com/boardx/workspacex/actions/runs/40520502682)：3 passed，单 worker 三次真实生成与刷新旅程分别 33.7s、55.6s、35.0s，含标准隔离链路启动/收尾共 4m51s，exit 0。

CI 验证分支 `codex/validate-persona-5954@e45b352e7` 基于修复提交 `262377ad0`，仅额外替换临时 workflow，使用同一标准 chat-read config、隔离外壳、真实数据库/API/浏览器与既有 loopback provider。没有 HTTP 拦截或替换画像结果；此用例仍验证真实画像写库与刷新后渲染。临时 workflow 不进入产品 PR。本证据文档在验证后追加，不改变已验证的 spec。

验证命令：`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.chat-read.config.ts --project=chat-read e2e/copilotkit-v2-persona-archived.spec.ts --grep CK-P6 --repeat-each=3 --workers=1`。

结论仅覆盖 CK-P6 三次真实旅程；不冒称完整 chat-read 或整个 develop workflow 已通过。
