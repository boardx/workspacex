# 登录后新建组织（Refs #5494）

基线：远程 main `0d4a041f3`；独立分支 `worker/codex-org-create`。

现有登录账号可从左上角组织菜单创建组织，名称 1–100 字符，创建者复用现有 admin 角色。成功后刷新并持久化组织列表，用户选择后走既有切换流程；创建、取消、失败均不改变当前组织。请求 UUID 与认证用户绑定，PG advisory lock 串行化重试，组织、管理员成员、三类系统 Agent 和幂等收据同一事务提交。未配置套餐/预算/私有模型保持未配置，与当前注册路径一致；不复制任何其他租户数据，不创建第二份账号或个人本地组织。

## 验证

- `./init.sh`：通过（标准快速初始化，非 `--full`）。
- API/Web/contracts typecheck、API/Web lint：通过。
- 新增后端：12 条通过，含真实 PG 并发、原子失败重试、RLS；真实 HTTP 默认鉴权、body 身份/租户注入拒绝与 409 契约。
- 既有注册与多组织成员/切换回归：18 条通过。
- UI：8 条通过，含校验、loading、重复提交、取消、重试同 key、组织列表持久化、切换及并发响应合并。
- contracts 全套：122 文件、1204 条通过。
- Playwright：1 条通过，创建/取消/失败重试/刷新/切换。
- 契约路由、同源 rewrite 覆盖：通过。
- 全局颜色 token 检查：失败；干净 main 基线重现相同错误，位于现有白板和模型目录文件，与此改动无关（对照日志）。
- Web 全套：仍在运行，最终结果将更新。已出现两条蓝图用例的 tsx IPC `EPERM`；干净 main 定向重现，放开 IPC 后定向重跑两文件 40 条全部通过。
- API 全仓、`verify:base`/`init.sh --full`、真实模型调用未运行。

数据库验证仅连接本机任务专属栈 `wsx-org-create-5494`、端口 `55494`、库 `wsx_org_create_5494`。测试夹具已清理；收尾释放任务栈。

## 浏览器证据

三张 PNG 来自**用户 Mac 上实际运行的 Chromium**，访问本地 `127.0.0.1:30494`。浏览器使用明确的 API 模拟夹具，不是生产截图或真实组织创建证明；数据库行为由独立真实 PostgreSQL 测试验证。已查看 `create-dialog.png` 核验布局。

可重跑：`pnpm --filter web exec playwright test --config playwright.organization-create.config.ts`。

未访问或更改生产、原发布目录、生产导入证据；未合并或部署。Word 参考未下载，本次依据用户完整提示实现。
