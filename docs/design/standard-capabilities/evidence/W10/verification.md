# W10 验证证据（云端执行）

最终重放基线：`414aca176dcd19d63c68b711a8436e05fe78ee74`（`origin/codex/standard-capabilities`，2026-09-07 再次 fetch 后）。初始开发基线为 `f1ecb4734940ac30a8e260f5b71eb69d83d3f26f`。日期：2026-09-07。

## 已通过

1. `pnpm@9.15.0 install --frozen-lockfile`：退出 0，lockfile up to date。
2. `pnpm --filter @repo/contracts exec vitest run tests/standard-browser-tools.test.ts`：3 tests passed。
3. `pnpm --filter @repo/api exec vitest run --config vitest.browser-adapter.config.ts`：16 tests passed，真实 browser lane 1 test skipped（需显式环境开关）。覆盖固定 Playwright MCP 真实 listTools/schema、只暴露五项、逐次授权与网络拒绝零调用、run-bound opaque refs、动作后旧 ref 失效、跨 run ref 拒绝、表单上游映射、本地/远端 PNG 回应写回，以及下述增量反证。
4. `uv run --extra dev --frozen pytest -q tests/test_standard_browser_tools.py`：7 tests passed。覆盖 LangChain tool schema、可信身份注入、伪造字段拒绝、响应上限、无秘密错误和失败不重试。
5. `node --import tsx skills/standard-web/scripts/verify.ts`：两个完整 4-file skills 的字节、摘要、许可证、缺失 root 和篡改反证通过；命令明确不代表真实模型 G-SKILL。
6. `tsc --noEmit --lib ES2022,DOM --skipLibCheck`：W10 文件无错误；全命令仍因两个既有测试的 `BlobPart` / `ArrayBufferLike` 类型错误退出 1。
7. API 的 error-leak、permission-path、no-builtin-capabilities、naming-single-source 与 architecture-deps 五项 lint 均退出 0。

## 有界修复反证

- WHATWG 实际把 `http://[::ffff:127.0.0.1]/` canonicalize 为 hostname `[::ffff:7f00:1]`；测试锁定该真实值，并证明复用的 `classifyAddress` 拒绝 mapped loopback、mapped metadata、NAT64 metadata及 DNS 返回 mapped loopback。
- receipt 测试以同一持久 DB seam 创建第二个 `PgBrowserExecutionReceipts` 实例：succeeded 结果跨实例回放而不产生第二次 MCP 调用；pending/unconfirmed 不重放；相同 callId 不同 digest 拒绝。
- deployment invariant 测试锁定 runtime 仅在 internal network、proxy 双网卡、MCP 仅 loopback、强制 proxy/loopback 不 bypass、无 shared context、无 `--no-sandbox`，并检查 proxy 的 IPv4/IPv6 拒绝范围。

仓库 `init.sh` 的依赖安装阶段通过，但后续 `tsx` 尝试创建 `/tmp/tsx-0/51.pipe` 时被云端沙箱以 `EPERM` 拒绝；因此改用不依赖 tsx IPC 的 `node --import tsx` 执行生成器和 skill 校验。该限制与 W10 源码无关，但阻止把整段 bootstrap 报为通过。

## 真实浏览器阻断证据

执行：

```text
pnpm --filter @repo/api exec playwright install chromium
```

固定 revision `chromium v1243 / Chrome for Testing 153.0.8010.12` 从 `https://cdn.playwright.dev/.../chrome-linux64.zip` 连续五次各 30 秒超时，最终 `Failed to install browsers`，退出 1。云端也没有 Docker、系统 Chromium或 Playwright browser cache。

随后执行：

```text
WORKSPACEX_REAL_BROWSER=1 pnpm --filter @repo/api exec vitest run \
  --config vitest.browser-adapter.config.ts \
  tests/agent-runtime/playwright-mcp-browser-real.test.ts
```

测试确实进入 `OfficialPlaywrightMcpSessionFactory.create`，因缺少 `/root/.cache/ms-playwright/chromium_headless_shell-1243/...` 退出 1。没有用 mock 替代这条 lane，也没有把它报告为通过。

## 未完成边界

- `WX-T022`–`WX-T026` 已有独立实现与代码级证据，但在可取得固定 Chromium 的 runner 上跑过真实导航/快照/填写/点击、cookie/localStorage 双 run 隔离、真实 PNG 写回之前，不能标完整验收。
- `WX-S013` 包完整性通过；尚未经过真实模型 G-SKILL、隔离预览、移动视口、未授权网络和最终 artifact ready 联合验收。
- 生产 composition root、native factory、风险表和标准 pack seed 由主协调者按接线说明完成；本任务按边界未修改这些共享文件。
- durable receipt 已实现为 adapter 必填依赖，但 composition root 尚未按接线补丁注入，集成前 browser service 仍不可用。
- 受控 egress compose 与 invariant tests 已提供；本云端没有 Docker/Podman/Squid，无法在这里启动该栈或取得其真实网络反证，因此生产网络验收仍未标通过。
