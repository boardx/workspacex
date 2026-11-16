# 最终源码栈的无模型浏览器前置验收

固定产品源码 `696e5da061977eb961c4d9bae4a3a5e9447cccf7`，新隔离 stack-context-02。所有自动执行及起标题模型关闭，模型请求未获授权。A6 使用真实 SDK 发送一次，A1 不发送消息或调用模型。

A6 报告 attempt01：保存、单次 SDK send、精确 selector、持久 human 原文、queued 与单一 focus pin 均通过；5 秒内没有出现材料回执 UI，测试失败。finally 通过既有 cancel 端点得到 202，并回读 cancelled；浏览器已关闭。该 UI 红例保留，不能将后端受理通过说成整场通过。

## A1 独立只读核对

- 恰好一条 run：`a346cc6f-039b-4e07-a0b0-835826637a10`，终态 cancelled，活动 run 为 0。
- 实际输入 human 数为 1；实际 run pins 为单一 `aidt-empathize`。selector 为本组 S1 V1、S2 V1；run marker 等于 snapshot selector hash，快照行真实存在。
- application journal 为 0，符合本轮只 prepared、没有 assembled/dispatch 的事实。未读取或输出学生原文及参考块正文。
- physical request、usage receipt、credit request、钱包 holds/unbounded 均为 0。
- financial ledger 前后 SHA256 完全一致，原付费预算账本前后 SHA256 也完全一致。
- actual requester 匹配 lead fixture，但实际组织角色为 admin、general 项目成员角色为 owner；不是 funded-admin fixture，没有钱包及正余额。此结果不冒充学生付费模型验收。

对应机器回执：`context-stack02-before-browser.json`、`context-stack02-after-browser.json`、`context-stack02-prepared-run.json`、`context-stack02-prepared-actor.json`。

## UI 缺口的源码审阅

`ProjectAidtChat` 只有收到 host accepted observation 后才保存 runId、挂载回执。原生 panel 的 host acceptance 当前等待新的 `runTrace.liveSignal`；queued 且 executor 关闭时，不会产生 running/execution 事件。AGUI 当前 onStarted 只携 SDK client runId 与真实 threadId，没有把已受理的真实 backend runId 通知该宿主。这条源码链与“首次独立回执 GET 前 UI 就缺失”的失败现象相符。

A1 已将准确位置交 A3/A4/root；不跨 owner 改文件，不用 SDK client ID 假冒真实 run，不通过收费执行去补一个本应在 prepared 时出现的 UI。当前执行继续关闭，付费验收暂停。
