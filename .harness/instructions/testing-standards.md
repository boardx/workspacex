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

### 夹具 id 与全局作用域（#2989 / #2990 / #2982 的三次实测）

数据库测试的隔离靠两条,两条都会被安静地绕过:

1. **夹具 id 必须本文件唯一。** `agent_runs` / `agents` / `agent_versions` /
   `subtask_runs` / `chat_threads` 这些表的主键**只有 `id` 一列**,`org_id` 不在里面。
   org 随机化了但 run id 写死成 `'parent'`,就会跟任何挑了同一个字面量的文件撞
   `duplicate key`,**冲突是确定性的、受害者是随机的**(谁先插谁赢由 vitest 调度决定),
   所以它在 CI 上表现成 flake。别用"上一轮它是绿的"判断这颗雷不存在。
2. **写到自己 org 之外的夹具必须显式声明。** `resetOrgs(<自己的 org>)` 清不掉
   `org-platform` 名下的行,也清不掉没有 `org_id` 列的表。这类写入决定了"哪个文件
   先跑"就决定了"后面的文件看见什么" —— 失败长成『单独跑绿、全量跑红』的样子,
   是本仓最难归因的一类。由 `apps/api/scripts/lint-global-scope-test-fixtures.mjs`
   机械门控(已挂进 `pnpm --filter api run lint`):写全局作用域就得留一行
   `// @global-scope-fixture <key>: <谁收敛它>`,声明过期同样判红。
   当前清单 `node apps/api/scripts/lint-global-scope-test-fixtures.mjs --list`。

### 数据库授权（GRANT / REVOKE）是共享可变状态（#522）

本仓的「共享可变状态」清单从五条变六条：git 索引 / 工作树 / stash 栈（ADR-005 的 worktree
隔离）、开发库（`test-isolation`）、scratchpad（约定），第六条是**数据库授权**。
它的特别之处：**既不在文件系统里，也不在 git 里**——权限挂在**角色**上，
所以既有的隔离手段一条都挡不住。同一个库里所有并行 worker 共用同一个 `app_rw`。

实测（#413 / PR #516 的实现者，同语句、同角色、同库）：

```
revoke 前：org-f109badge 插入 chat_messages → INSERT 0 1
revoke 中：同一条                          → ERROR: permission denied for table chat_messages
```

`apps/api/vitest.config.ts` 是 forks 池 + `maxWorkers: 4` ⇒ **四个测试文件并行跑在同一个
Postgres 上**。某个文件用 `REVOKE INSERT ON chat_messages FROM app_rw` 注入写回失败，
别的文件的夹具只要在那个窗口里插同一张表就挂——**受害者是谁由 vitest 调度决定**，
于是它在 CI 上长成 flake，而单跑与单文件重跑永远是绿的。别用"上一轮它是绿的"判断这颗雷不存在。

**要注入权限失败，就限定到本用例自己的数据。** 范例是 PR #516 的修法
（`apps/api/tests/agent-runtime/no-tool-run-writeback.test.ts` 的
`installWritebackFailureInjector`）：装一个**双重限定**的触发器——只在
`NEW.org_id = <本文件的 org>` **且** body 带本文件的 sentinel 前缀时 `RAISE`，
安装期间别的文件观察不到任何差别；DDL 也从每用例两次降到每文件两次，
不再在并行跑的中间去拿表级锁。

⚠ **不是禁止一切 GRANT/REVOKE。** 由 `.harness/scripts/lint-test-shared-grant.mjs` 机械门控
（已挂进 PR 门控 `harness-verify.yml` 与 `verify:harness:raw`），判据是
**授权对象是否被本文件独占**，不是「出现了 GRANT 这个词」。这四类照常放行：

- 对象由本文件 `CREATE` 出来（自己的 schema 前缀，或自己建的探针表）；
- 接受方是本文件 `CREATE ROLE` 出来的角色（`app_rw` 的权限一个字节没动）；
- 只是读迁移文本**断言**里面有某条 GRANT，并不执行它；
- 文件显式声明独占一次性实例（`WORKSPACEX_DATA_TEST=1`），不在并行池里。

库级权限（`REVOKE CONNECT ON DATABASE …`）**刻意不判**：本仓的并行隔离单位就是库，
那一层的洞归 #468（端口碰撞）/ #487（拆库掐连接）。
存量豁免在 `.harness/state/test-shared-grant-allowlist.json`，只许变短，每条都写了怎么清掉。

断言侧配套:平台自有的 skill 一律**按归属**(`org_id = 'org-platform'`,用
`tests/support/platform-owned-skills.ts`)排除,不要按名字——按名字是同一事实的第二份
副本,第 5 个平台 skill 出现时就已经失效。

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

### spec 引用的 testid 必须在源码里存在（`lint:e2e-testid-gate`，#2128）

e2e 只认 `data-testid`，于是「**删掉一个 testid 而 spec 没跟进**」这个形状 2026-08-26
一天内咬了两次（`tpladmin-editor-add-section`；撤表格视图时连带没了的 `tpladmin-row-*`
与 `canvas-template-usage-*`）。两次都是**改动侧全绿**——lint / tsc / 单测都不看 testid
字符串，只有跑完整栈浏览器 e2e 才会红，那是最慢最贵、最容易被当成环境抖动的一层。

`.harness/scripts/lint-e2e-testid-gate.mjs` 把它提前到秒级：纯文本比对，不起浏览器、
不连库，`verify:harness` 里跑。它只回答一个问题——**这个 testid 在源码里出现过吗**；
不查它在不在正确的组件里，更不查它当前渲染得出来（那些只有真 e2e 能证），判据与
已知宽松点逐条写在脚本头注里。

「断言它不存在」的引用（如表格视图撤掉后断言 `tpladmin-table` 的 `toHaveCount(0)`）用
**行内标注**豁免，不维护允许清单：

```ts
await expect(page.getByTestId("tpladmin-table")).toHaveCount(0); // testid-gate: absent 表格视图已撤（#2123）
```

标注写在行尾只豁免该行，独占一行则豁免下一行；覆盖不到引用、或被豁免的 testid 又回到
源码里，都判红——豁免不会悄悄烂掉。

Chat Agent 的延迟、流式连续性、HITL 恢复、轨迹和画布性能门控统一见
[`chat-agent-performance-acceptance.md`](./chat-agent-performance-acceptance.md)。相关测试不得在
各 spec 内另写一套冲突阈值。

**登录/账号**：新 spec 若不需要断言严格权限边界矩阵、也不需要与其它 feature 隔离账号，
优先用开发模式预设账号（`pnpm harness dev-mode seed` 种一次 + `apps/web/e2e/dev-mode-login.ts`
的 `loginAsDevRole(page, role)`），不要在文件里再复制一份 `loginAs(page, email, password)`。
需要严格权限矩阵/并发隔离的场景，仍然走 `fullstack-smoke-fixture.ts` 那套专属账号——两者
的取舍与边界见 `.harness/instructions/dev-mode-testing.md`。

## 假阳性防护
- 避免只检查"进程没崩";要检查"产出符合预期"。
- 验证脚本失败时保留输出到 sprint 的 `evidence/`,便于复盘。
- 谨防"扫描了 0 个东西也 exit 0"——门控自证有没有真的扫到东西，不只是退出码干净。
