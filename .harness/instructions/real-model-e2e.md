# 真实模型 e2e：另加的那一条 lane

> issue #2802。**不替换**现有 86 个 spec 的回环模型配置——那是有价值的确定性回归门禁，
> 必须继续按原样绿。这里加的是**另一条**链路。

## 为什么需要它

全部 86 个全栈 e2e spec 都跑在 `playwright.fullstack-smoke.config.ts` 的**确定性回环
模型提供方**上。那个设计本身是对的（回归门禁需要可预测的上游），但它意味着下面这一整类
行为**从来没有被任何自动化路径接触过**：

| 失败类型 | issue | 回环模型为什么测不出 |
|---|---|---|
| 真实模型思考数分钟 → SSE/WS 被网关掐断 | #2795 | 回环模型毫秒级返回，撞不到超时 |
| 模型自主决定多调一步工具 | #2793 | 回环模型不会自主决定调什么 |
| 规划句经两条通道各发一遍 | #2780 | 要流式 + 真实工具调用同时发生 |
| 真实技能端到端产出文件 | #2768 | 回环模型不触发真实技能调用 |

后果是实测出来的：#2786 / #2793 / #2795 **全部发生在 CI 全绿的提交上**，而且每一轮排查
都只能做静态代码分析，直到人类手动打开 DevTools 截图才第一次拿到真实报错。

## 一份 spec，两条 lane

断言只写在 `apps/web/e2e/real-model-pdf-smoke.spec.ts` 一处，**不分叉**。

| | devapp lane | 本地 lane |
|---|---|---|
| 怎么触发 | GitHub Actions 手动跑 `real-model-chat-evidence` workflow | `pnpm run e2e:real-model-smoke` |
| 被测对象 | devapp 上正在跑的真实部署（走公网入口，因此**含 Caddy 网关**） | `e2e-up.sh` 起的本地真栈 |
| 凭据 | 那台机器上已有的 `/opt/workspacex/real-model-e2e.env` | `./.env.local`（或 `$WORKSPACEX_ENV_FILE`） |
| 账号 | 那套部署上的一个已有账号 | fullstack 种子里的引导师账号（显式 opt-in） |
| 起前端 | 不起——被测的就是线上那份 | config 起一份 `next build && next start` |

差异全部落在 `apps/web/playwright.real-model-smoke.config.ts` 里，spec 一个字不变。

## 断言判的是结构，不是模型措辞

真实模型是不确定的，断言它说了什么就是在断言噪音。八条断言判的都是结构事实：

1. 真实 `/chat` 可用（composer `data-send-state=ready`）
2. run 真的起来过并走到终态（`sawRunning` + 终态，见 spec 里那段头注：少了前半句会在毫秒级假通过）
3. 全程没有工具授权/审批弹窗（`pdf-create` 自 #2782 起是 L0）
4. 全程没有错误横幅（`copilotkit-v2-error` 节点在不在，不做文案子串匹配）
5. 助手气泡没有逐字重复（#2780）
6. 真的产出 PDF —— **按字节判**：把产出卡的 blob 拉下来看 `%PDF-` 魔数与长度
7. SSE/WS 全程没被掐断（CDP `Network.loadingFailed` + 传输层控制台报错，#2795 那次两条都命中）
8. 没有未捕获的页面异常

**失败时不早退**：每条先记录再判定，全部记完才让用例红——早退会丢掉后面几条的证据，
而这条 lane 存在的全部意义就是产出证据。

## 证据包里有什么

目录 `apps/web/test-results/real-model-evidence/`，devapp lane 上传成 artifact
`real-model-chat-evidence`（保留 30 天）：

```
00-context.json          lane / baseURL / 账号来源 / threadId / agentRunId / 耗时
01-verdict.txt           逐条断言结论（同一份内容也打进 job log）
10-assertions.json       同上，结构化
20-console.json          浏览器控制台全量（#2795 的真因就在这里）
21-page-errors.json      未捕获页面异常
30-network-failures.json 失败/4xx/5xx 的请求
31-stream-lifecycle.json SSE 逐块到达时刻（CDP 旁路观测，不改变传输）
32-websocket-lifecycle.json  WS 建立/收发/关闭时刻
40-assistant-bubbles.json / 41-produced-files.json
60-api-journal.log 等   后端日志节选（脱敏）
90-final-screen.png / 91-produced.pdf / playwright-artifacts/（trace）
```

判决**同时打进 job log**：远程协调员读 `get_job_logs` 就能拿到结论，不必先下载 artifact。

## 脱敏

写盘的每一个字符串都过 `scrubSecrets`（`apps/web/e2e/support/real-model-evidence.ts`，
门控 `apps/web/tests/e2e-support/real-model-evidence.test.ts`）：进程环境里像凭据的变量值
逐字打掉 + 一组形态正则（Bearer / sk- / Authorization / password 字段）。后端日志走同一条
规则（`scrub-file.ts` 是那份规则的薄壳，不是第二套规则）。

## 缺凭据时会发生什么

spec **显式 skip 并把缺的变量名打进 stdout**。绝不无声跳过，更不会退回回环模型再把结果
说成真实模型跑通——#2802 的整条 issue 就是这件事。`e2e-up.sh` 同理：缺 `DASHSCOPE_*`
逐个点名后红退。

## 边界：这条通道对 devapp 做什么

写：在给定账号下开**一条新线程**、发一条消息、跑一次真实 run、下载它产出的 PDF。
读：journalctl / docker logs / `deploy.env` 里三个开关 key / `git log -1` / `systemctl is-active`。
不做：不重启服务、不改 deploy.env、不跑迁移、不装系统包、不写 `/opt/workspacex`、
不碰其它账号的数据。与 `live-evidence.sh` 同一条边界，逐字写在 workflow 头注里。

## 已知边界（如实记，别当它已经验过）

- 本地 lane 是否也走 deep-agent 内核，取决于本机有没有跑 `deep-agent-service`
  （`KERNEL_DEEP_AGENT_BASE_URL`）。没跑时这条 spec 仍然跑真实模型 + 真实技能沙箱，
  但**不经 deep-agent 内核**——`00-context.json` 会如实记下这次走的是哪条，不要因为
  本地绿了就以为线上那条链路也验过了。
- devapp lane 需要那台机器上有 `/opt/workspacex/real-model-e2e.env`。刻意**不**走 GitHub
  secret：凭据不离开那台机器是本通道的设计前提。文件不在 ⇒ preflight 红退并点名。
