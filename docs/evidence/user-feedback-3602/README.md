# Issue #3602 — 智能体展示入口

范围：左侧 STUDIO 新增 `/studio/agents`；移动端入口复用同一导航项。页面沿用访谈的容器、标题计数和卡片布局，展示智能体1、智能体2。无标签、专家列表或未实现操作按钮；未新增业务 API、权限或真实运行能力。

验证：
- `./init.sh`：基础快速检查通过。
- `pnpm --filter web typecheck`：通过。
- `pnpm --filter web lint`：ESLint、light-scope、design lint 全部通过。
- `pnpm --filter web exec vitest run tests/ui/nav-ia-two-levels.test.tsx`：15/15 通过。
- `node .harness/scripts/lint-nav-reachability.mjs`：三个阶段可达性通过。
- 独立 Next dev（端口 3602）+ Chromium，`node docs/evidence/user-feedback-3602/browser-check.cjs`：桌面 1280px / 手机 375px，两张卡片、无标签专家、入口 active、直接访问与刷新、内容无横向溢出、访谈往返导航全部通过。

浏览器检查仅对身份接口提供明确的 UI 夹具；没有验证真实认证或后端业务。截图为该夹具下实际渲染，页面的两个智能体本身是用户要求的静态 mock。先启动 `CHAT_READ_E2E_API_ORIGIN=http://127.0.0.1:3604 NEXT_DIST_DIR=.next-feedback-3602-proxy pnpm --filter web exec next dev -p 3602`，再从仓库根执行脚本。

证据：`browser-result.txt`、`navigation-result.txt`、`agents-1280.png`、`agents-375.png`。等待 PR 合入后才能在部署环境使用，未自动合并。

CI 首轮发现 `lint-no-builtin-capabilities` 将页内数组识别为内置能力目录。已把用户明确要求的示例数据移到 `lib/mock/agent-previews.ts`，并通过现有 `DECLARED_MOCK_DEBT` 机制申报该精确文件。门控本体及未申报债务失败断言未改；新增一笔债务明确可见（violations=0、debt=92），不更改能力配置或运行时。标准隔离外壳下 `no-builtin-capability-lists.test.ts -t 'V1 static'` 五项通过，六项运行时测试未选择。

GitHub P2 review 指出 `/agents` 与空前缀 API rewrite 冲突。UI 已迁至 `/studio/agents`，原 `/agents` 页面删除且无重定向。启用 `CHAT_READ_E2E_API_ORIGIN`（未设 `FULLSTACK_E2E_API_ORIGIN`）时，实际 Next HTTP GET/POST `/agents` 均由独立上游 fixture 返回 JSON，并核对 method/path；再验证新 UI 与导航。此为真实 Next 代理路由验证，上游是可观测测试服务，不声称真实业务 API 验收。
