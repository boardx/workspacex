# W10 验证证据（云端执行）

基线：`f1ecb4734940ac30a8e260f5b71eb69d83d3f26f`。日期：2026-09-07。

## 已通过

1. `pnpm@9.15.0 install --frozen-lockfile`：退出 0，lockfile up to date。
2. `pnpm --filter @repo/contracts exec vitest run tests/standard-browser-tools.test.ts`：3 tests passed。
3. `pnpm --filter @repo/api exec vitest run --config vitest.browser-adapter.config.ts`：6 tests passed，真实 browser lane 1 test skipped（需显式环境开关）。覆盖固定 Playwright MCP 真实 listTools/schema、只暴露五项、逐次授权拒绝零调用、run-bound opaque refs、动作后旧 ref 失效、跨 run ref 拒绝、表单上游映射、PNG尺寸/hash/workspace写回。
4. `uv run --extra dev --frozen pytest -q tests/test_standard_browser_tools.py`：7 tests passed。覆盖 LangChain tool schema、可信身份注入、伪造字段拒绝、响应上限、无秘密错误和失败不重试。
5. `node --import tsx skills/standard-web/scripts/verify.ts`：两个完整 4-file skills 的字节、摘要、许可证、缺失 root 和篡改反证通过；命令明确不代表真实模型 G-SKILL。
6. `tsc --noEmit --lib ES2022,DOM --skipLibCheck`：W10 文件无错误；全命令仍因两个既有测试的 `BlobPart` / `ArrayBufferLike` 类型错误退出 1。
7. API 的 error-leak、permission-path、no-builtin-capabilities、naming-single-source 与 architecture-deps 五项 lint 均退出 0。

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
- adapter 在单进程、单 binding 内串行化副作用并对每次 dispatch 重新授权；跨进程重启仍需主协调者接入现有持久化 `toolCallId` receipt/journal，当前分支不具备可声称的 durable exactly-once 保证。
- DNS rebinding 的最终安全边界依赖部署层 egress proxy/容器网络，应用层 DNS 检查不是完整替代。
