# Work Stack 专项浏览器验收

从仓库根目录运行 `pnpm run verify:work-stack-browser`。该入口使用标准 test-isolation 分配数据库、Docker compose 项目与服务端口；每次运行通过已有 fullstack seed 建立隔离数据，依次验收官方数字人和 W029 工作流。单 worker、无自动重试，导入及审批状态不会跨项目并发修改。

需要仓库标准 Node/pnpm、已安装依赖、可用 Docker 与 Chromium。默认使用 Playwright bundled Chromium（`pnpm --filter web exec playwright install chromium`）；需要已有浏览器时可设置 `WORK_STACK_BROWSER_EXECUTABLE_PATH` 为可执行文件绝对路径。生产模式 `next build`/`next start` 使用独立 `.next-work-stack-browser` 目录，每次清理该目录后构建，避免开发模式冷编译影响浏览器稳定性。构建需充足内存和时间；超时沿用 fullstack 的 `FULLSTACK_E2E_SERVER_TIMEOUT_MS` 配置。

`:raw` 入口仅供已经处于标准隔离外壳的调用方使用，不应直接连接共享或生产数据库。基础设施和 Next/Nest/PG/Redis、seed、确定性模型/技能沙箱上游均复用 `playwright.fullstack-smoke.config.ts`，不写死容器或端口，不拦截浏览器业务网络。

输出位于 `apps/web/test-results/work-stack-browser`，汇总为 `work-stack-browser-summary.json`，保留 trace 与截图。运行失败后应根据证据修复，再从标准入口重新创建隔离环境运行；不能依赖同一库内重试恢复导入前状态。

这是 loopback 上游下的技术链路验收：证明角色导入、选择、对话接线、工作流执行与产物持久化行为。它不证明真实模型的产品经理专业能力、回答质量或部署站点供应商可用性；这些需要另外执行真实模型及部署验收。
