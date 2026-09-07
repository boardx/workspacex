# W10 浏览器工具接线说明

基线：`codex/standard-capabilities@414aca176dcd19d63c68b711a8436e05fe78ee74`。本工作包实现 `WX-T022`–`WX-T026` 的独立契约、Playwright MCP adapter、controller、Python LangChain tools、测试与 `WX-S013` skill 包；按任务约束没有修改共享 composition root 或 native factory。

## 固定上游

- `@playwright/mcp@0.0.80`，Apache-2.0，tag commit `4c1fb03bad3bae379b0ae0e3d81d2660de56bd91`。
- 该版本固定 `playwright@1.63.0-alpha-2026-08-31`。浏览器二进制必须由独立 browser runtime/image 按此 revision 预装，不能运行时 `npx @latest`。
- adapter 使用官方 MCP 的 `browser_navigate`、`browser_snapshot`、`browser_click`、`browser_fill_form`、`browser_take_screenshot`；启动时检查实际 schema，缺字段即拒绝。

## 协调者接线补丁

以下是需要由主协调者在共享热点文件中完成的精确改动；本分支不代改。

### `apps/deep-agent-service/src/deep_agent_service/native_factory.py`

```diff
@@
 from .standard_web_tools import standard_web_tools
+from .standard_browser_tools import standard_browser_tools
@@
-tools=[artifact_publish_tool(), *standard_web_tools(), *standard_memory_tools(),
+tools=[artifact_publish_tool(), *standard_web_tools(), *standard_browser_tools(), *standard_memory_tools(),
```

`native_graph_context` 是 fresh/resume 共用 factory，必须只在这一处加入，避免两条路径工具集漂移。

### `apps/api/src/kernel.module.ts`

```diff
@@ imports
+import { STANDARD_BROWSER_SERVICE } from "./application/agent-run/standard-browser-tools";
+import { DATABASE_PORT, type DatabasePort } from "./application/ports/database.port";
+import { PlaywrightMcpBrowserAdapter, PublicBrowserNetworkPolicy, RemotePlaywrightMcpSessionFactory } from "./infrastructure/agent-run/playwright-mcp-browser-adapter";
+import { PgBrowserExecutionReceipts } from "./infrastructure/agent-run/pg-browser-execution-receipts";
+import { StandardBrowserToolsController } from "./interface/controllers/standard-browser-tools.controller";
@@ controllers
-StandardImageController, StandardScheduleController,
+StandardImageController, StandardBrowserToolsController, StandardScheduleController,
@@ providers（放在 STANDARD_WEB_SERVICE 后）
+{
+  provide: STANDARD_BROWSER_SERVICE,
+  useFactory: (owner: NativeSessionOwner | null, authority: ToolExecutionAuthority, db: DatabasePort) => {
+    const socketPath = process.env.NATIVE_SESSION_SOCKET;
+    const endpoint = process.env.WORKSPACEX_BROWSER_MCP_ENDPOINT;
+    return owner && socketPath && endpoint
+      ? new PlaywrightMcpBrowserAdapter(
+          owner,
+          bound => createNativeDraftSession({ socketPath, ...bound }),
+          authority,
+          new PgBrowserExecutionReceipts(db),
+          new PublicBrowserNetworkPolicy(),
+          new RemotePlaywrightMcpSessionFactory(endpoint),
+        )
+      : null;
+  },
+  inject: [NATIVE_SESSION_OWNER, TOOL_EXECUTION_AUTHORITY, DATABASE_PORT],
+},
```

`WORKSPACEX_BROWSER_MCP_ENDPOINT` 只接受 `http://127.0.0.1:<port>/mcp` 或 IPv6 loopback；缺失或非 loopback 时 browser service 不启动。adapter 按 native binding 的 `expiresAt` 自动关闭 MCP client/隔离 context；主运行在 terminal/cancel 时若已有统一释放回调，应额外调用 `STANDARD_BROWSER_SERVICE.release(bindingId)` 以提前回收，不能新建第二套 run 生命周期。

### `apps/api/src/application/agent-run/native-invocation.ts`

将下列五项加入既有 `NATIVE_PROFILE_TOOLS`：

```ts
"browser_navigate", "browser_snapshot", "browser_click",
"browser_fill_form", "browser_take_screenshot"
```

风险等级必须在既有 `tool-risk-tier.ts` 单源声明：`browser_click`、`browser_fill_form` 为 L2；`browser_navigate` 涉及外部动作，建议 L2；`browser_snapshot`、`browser_take_screenshot` 可按现有读取/文件政策评审后定级。不得在 adapter 新建风险枚举。

### 标准 skill 发布

`skills/starter-packs/standard-web/1.1.0.json` 含原 `web-research` 和新增 `web-artifact`。协调者在无并行冲突时把 `apps/api/src/infrastructure/skill/ensure-standard-skill-packs.ts` 的 `standard-web` 版本从 `1.0.0` 改为 `1.1.0`，然后运行现有平台 seed 集成测试。此分支未修改该共享发布源。

## 部署边界

- `apps/browser-runtime/docker-compose.browser.yml` 是生产默认：官方 MCP runtime 只加入 `internal: true` 的 control network，唯一出站 peer 是双网卡 Squid；MCP 端口只绑宿主 loopback。两个 image 都是无默认值的必填 `@sha256` 引用，缺少审核 digest 会在 compose 展开阶段失败。
- Chromium 强制使用 proxy、取消隐式 loopback bypass、禁 shared context、启用 sandbox/non-root/read-only/cap-drop。Squid 在连接侧 DNS 后拒绝 loopback、RFC1918、link-local、云元数据、mapped IPv4、NAT64、组播和保留段。browser runtime 本身没有 public network，即使页面尝试绕开 proxy 也没有公网路由。
- adapter 的第一道 URL/DNS 门直接复用既有 `classifyAddress`，覆盖 WHATWG canonicalized `::ffff:7f00:1`；它是快速拒绝和审计层，最终 socket 边界仍由上述网络拓扑及 proxy 提供。Playwright MCP 的 origin flags 不被当作安全边界。
- screenshot 只返回经过 PNG 尺寸/hash和 sandbox读回验证的 `/workspace/browser-<hash>.png`；需要用户交付时继续调用既有 `wx_artifact_publish`，`staged` 不得写成 ready。
- 当前 controller 统一把拒绝、失败、未知结果映射为无细节 503，避免模型按未知结果自动重放有副作用操作；现有 authority 仍是逐次授权单源。
- `PgBrowserExecutionReceipts` 复用既有 `mcp_tool_executions` 持久状态机：外部 dispatch 前原子 claim；相同 `(org,run,toolCallId)` 仅回放 schema 校验过的 succeeded result；pending/unconfirmed 或参数冲突一律拒绝，不会重新点击/填写/导航。adapter 没有无 receipt 的构造默认值。
