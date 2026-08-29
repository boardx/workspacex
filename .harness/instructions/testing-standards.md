# 端到端验证标准

> 对应 L10「跑通完整流程才算真正验证」。feature 的 `verification` 命令应是**可执行的端到端检查**,
> 而不是"代码无语法错误"这类宽松判据。
>
> ⚠ 2026-08-14 重写：此前的版本从项目初始化起从未更新过（模板脚手架原样留存），
> 里面的 `infra/docker-compose.yml`、curl+jq 全栈验证写法在本仓从未存在过——
> 实测全仓 975 条真实 feature `verification` 命令，**0 条用 curl，749 条用 vitest**，
> 其余是 shell 脚本（如 `verify-ui-states.sh`）。本次重写只描述本仓实际在用的模式。

## 验证分层(测试金字塔)
- 单元:纯逻辑,快;不算 feature 的完成判据,只是基础门槛。
- 集成:跨包/跨服务的真实交互(vitest + 真实 Postgres,不是 mock)。
- 端到端:从用户可见入口走到可见结果,**这才是 feature passing 的判据**。

## feature.verification 的写法(本仓实际使用的三类)

每条是一个 shell 命令,退出码 0 = 通过。三类命令,按占比从高到低:

1. **API 层集成测试**(占比最高):`pnpm --filter api exec vitest run tests/<域>/<用例>.test.ts`
   ——真起 Postgres,断言 HTTP 状态、响应体形状、DB 落库结果,不是纯内存 mock。
2. **前端组件测试**:`pnpm --filter web exec vitest run tests/ui/<组件>.test.tsx`
   ——断言真实渲染结果(testid 可见性、点击后的请求参数),不是浅层快照。
3. **专用 shell 脚本**(少数场景):如 `bash apps/web/scripts/verify-ui-states.sh`
   (七态互斥矩阵)、`grep -rq '<testid>' apps/web/components/<域>`(存在性检查)。

⚠ **裸跑 `vitest run` 会连上共享库,产生彼此踩踏的幻影失败**——所有真实数据库交互的
测试**必须**在 `pnpm harness verify`(自动包一层 `with-test-isolation.ts`)下跑,
或手动 `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- <命令>`。
唯一线索只有一行 `db=workspacex`(共享库名),看起来跟正常输出一模一样,
不是"跑起来没报错"就等于"跑对了"。

## 新增顶层页面必须验证"能被导航到"，不能只验证"URL 直达能用"

`pnpm harness verify` 通过只证明"给定这个 URL/接口，行为符合预期"，**不证明用户能从
产品里走到这个 URL**。这个盲区曾导致 Ava/Surveys/Admin 等多个已 passing 的顶层功能
在全站没有任何导航入口——功能存在，但对真实用户等于不存在（e2e 里都是 `page.goto()`
直达 URL，没人断言过入口本身）。

因此：**任何新增的顶层页面/路由（sidebar 一级入口、首页卡片、account 菜单项等），
其 feature 的 e2e verification 至少要有一条走"真实点击路径"的场景**，而不是全部
`page.goto(url)` 直达：

```ts
// 不够：只证明 URL 能用
await page.goto("/ai-store");
await expect(page.getByTestId("store-grid")).toBeVisible();

// 要加一条：证明用户能从已有入口点到这里
await page.goto("/home");
await page.getByTestId("enter-store-recentlyUsed").click();
await expect(page).toHaveURL(/\/ai-store/);
```

如果这个页面按设计就是"暂无独立入口、只能从别处间接进入"（比如 room-chat 内嵌的
Studio 面板），在 feature 的 `notes` 里显式写清楚这是故意的，而不是漏掉。

## 断言性质，不要断言字面值

本仓已多次因为断言太具体而被自己的测试反咬：断言精确文案（改个措辞就红）、
断言数组顺序/条数（正当新增被自己的测试拦下）、断言依赖不相等的两个数刚好巧合相等
（换错数据源都测不出来）。要断言的是**性质**——"这个集合与契约一致且未声明的值不能通过"，
不是"这个数组恰好长这样"。造反证时先让测试对着被破坏的实现跑一遍，
看它红在预期的那一条，不是先射箭再画靶。

## 全栈端到端（Playwright，真实浏览器）

真实全链路验证在 `apps/web/e2e/*.spec.ts`，由专门的 playwright config 接进 CI
（`playwright.fullstack-smoke.config.ts` / `playwright.chat-read.config.ts` /
`playwright.self-service-profile.config.ts` 等）。新增 spec 必须被某个 CI 可达的
config 覆盖，否则 `lint-spec-gate-coverage.mjs` 会挡：一个没人跑的 spec 红了没人发现。
纯取证/截图脚本（不承担 gate 职责）可以登记进该脚本的 `EXEMPTIONS` 并写明理由
（先例：`chat-main-shots.spec.ts` / `vz-fabric-shots.spec.ts`）。

**登录/账号**：新 spec 若不需要断言严格权限边界矩阵、也不需要与其它 feature 隔离账号，
优先用开发模式预设账号（`pnpm harness dev-mode seed` 种一次 + `apps/web/e2e/dev-mode-login.ts`
的 `loginAsDevRole(page, role)`），不要在文件里再复制一份 `loginAs(page, email, password)`。
需要严格权限矩阵/并发隔离的场景，仍然走 `fullstack-smoke-fixture.ts` 那套专属账号——两者
的取舍与边界见 `.harness/instructions/dev-mode-testing.md`。

## 假阳性防护
- 避免只检查"进程没崩";要检查"产出符合预期"。
- 验证脚本失败时保留输出到 sprint 的 `evidence/`,便于复盘。
- 谨防"扫描了 0 个东西也 exit 0"——门控自证有没有真的扫到东西，不只是退出码干净。
