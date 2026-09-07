# W10 浏览器工具接线与验收

2026-09-07，WX-T022–T026 / WX-S013。生产 composition 使用 `PlaywrightMcpBrowserAdapter`、`PgBrowserExecutionReceipts`、`PublicBrowserNetworkPolicy` 和 `RemotePlaywrightMcpSessionFactory`。kernel 通过 `WORKSPACEX_BROWSER_MCP_ENDPOINT` 与现有 `NATIVE_SESSION_SOCKET` 接入；未配置时服务不可用，不回退到无隔离浏览器。Python 标准工具已通过既有 native factory 与可信工具快照接入。

固定上游为 `@playwright/mcp@0.0.80`（Apache-2.0；tag commit `4c1fb03bad3bae379b0ae0e3d81d2660de56bd91`），镜像内 Playwright 为 `1.63.0-alpha-2026-08-31`。镜像 digest、启动参数、官方 seccomp 来源及真实部署差异见 [运行时说明](../../../apps/browser-runtime/README.md)。不使用运行时 latest 安装。

标准包发布目标是 `standard-web/1.1.1.json`，其中 `web-artifact` 为 1.0.1；已发布的 1.1.0 保持原字节。`web-research` 对象保持不变。新包复用现有平台 seed，不创建另一套发布器。

验收证据见 [真实浏览器记录](evidence/W10-real-browser/current-acceptance.md) 和 `evidence/W10-real-browser/production-runtime/`：本地实际 Chromium 3项、实际 PG receipt 6项、生产 Remote MCP 的导航/快照与桌面手机预览，以及私网 CONNECT 拒绝/直接公网绕过失败。独立 S013 实际模型验收另外记录，不能用组件测试替代。

## 部署边界

- `apps/browser-runtime/docker-compose.browser.yml` 是生产默认：官方 MCP runtime 只加入 `internal: true` 的 control network，唯一出站 peer 是双网卡 Squid；MCP 端口只绑宿主 loopback。两个 image 都是无默认值的必填 `@sha256` 引用，缺少审核 digest 会在 compose 展开阶段失败。
- Chromium 强制使用 proxy、取消隐式 loopback bypass、禁 shared context、启用 sandbox/non-root/read-only/cap-drop。Squid 在连接侧 DNS 后拒绝 loopback、RFC1918、link-local、云元数据、mapped IPv4、NAT64、组播和保留段。browser runtime 本身没有 public network，即使页面尝试绕开 proxy 也没有公网路由。
- adapter 的第一道 URL/DNS 门直接复用既有 `classifyAddress`，覆盖 WHATWG canonicalized `::ffff:7f00:1`；它是快速拒绝和审计层，最终 socket 边界仍由上述网络拓扑及 proxy 提供。Playwright MCP 的 origin flags 不被当作安全边界。
- screenshot 只返回经过 PNG 尺寸/hash和 sandbox读回验证的 `/workspace/browser-<hash>.png`；需要用户交付时继续调用既有 `wx_artifact_publish`，`staged` 不得写成 ready。
- `WX-S013` 预览使用保留的 `https://preview.workspacex.invalid/workspace/web-artifact/*.html?viewport=desktop|mobile`。adapter 在逐次权限和 owner 校验后从当前 binding 的 workspace 读回自包含 HTML，通过 Playwright MCP 官方 `browser_route` 临时装载并随后 `browser_unroute`；CSP 默认拒绝网络、表单提交、frame 和 object。desktop/mobile 只映射 1280×720 与 390×844，并由官方 `browser_resize` 执行，不接受模型提供任意尺寸，也不建立公网预览服务。
- 当前 controller 统一把拒绝、失败、未知结果映射为无细节 503，避免模型按未知结果自动重放有副作用操作；现有 authority 仍是逐次授权单源。
- `PgBrowserExecutionReceipts` 复用既有 `mcp_tool_executions` 持久状态机：外部 dispatch 前原子 claim；相同 `(org,run,toolCallId)` 仅回放 schema 校验过的 succeeded result；pending/unconfirmed 或参数冲突一律拒绝，不会重新点击/填写/导航。adapter 没有无 receipt 的构造默认值。
- 单一 30 秒 deadline 从 invoke 入口开始，覆盖 owner/authority、receipt claim、MCP state 创建和同 binding 串行排队。每个 MCP 动作之后以及成功 receipt 发布之前再次检查权限和 owner；取消、lease/attempt 失效或超时均不返回/发布成功结果，DB finish 也在 run row lock 下复核取消、attempt、lease 与 receipt deadline。
