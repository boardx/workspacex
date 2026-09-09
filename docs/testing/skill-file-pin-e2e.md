# Skill 文件保存与 Agent 绑定：真实浏览器验证

本测试通过真实登录、GitHub URL 导入、Next 页面、API 与 PostgreSQL 验证：修改 SKILL.md、新增 reference、删除一个导入文件在一次保存中发布；刷新仍在，旧快照不变；从编辑页点击进入绑定，固定新版本，恢复原空绑定并刷新确认。Agent 夹具也通过真实导入/发布 API 创建。

这条 lane 不执行模型，不启动模型替身，也不证明真实模型试跑。普通测试全集显式跳过它，跳过不算验收通过。

## 本地独立隔离栈

在仓库根目录运行：

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- node scripts/studio-skill-files-e2e.mjs
```

需要 Docker、已安装的 pnpm 依赖与 Playwright Chromium，以及服务端可以访问公开 GitHub 的网络。runner 用标准准入分配端口、数据库和 Compose project，仅起自己的 PostgreSQL/Redis/MinIO、API 和独立 dist 的 Next dev。它执行真实迁移、标准 dev-mode seed，并经 `/auth/login` 使用预设 admin；没有测试 principal 注入。

单 worker 专用配置为 `apps/web/playwright.skill-files.config.ts`。runner 设置 `STUDIO_LANE=1`，并要求报告恰好一个通过测试；all-skipped 不会当成功。Git HEAD、环境概要、receipt、截图和日志写入系统临时目录下 `studio-browser-<compose-project>`。API 加密 key 仅在进程内随机生成，不输出。不会写 auth token 到日志或录制含认证请求头的 trace。

退出时只结束自己的进程组、删除自己的 Next dist 及自动 tsconfig include；外层 isolation wrapper 清理自己的 Compose 资源。不要脱离外壳运行 runner。

## 已部署环境

需要已有合法管理员账号。通过安全环境变量提供 `STUDIO_LOGIN_EMAIL`、`STUDIO_LOGIN_PASSWORD`、`E2E_BASE_URL`、`STUDIO_API_BASE_URL`、`STUDIO_EVIDENCE_DIR`；不要把密码写到命令行或证据。

```bash
STUDIO_LANE=1 pnpm --filter web exec playwright test --config playwright.skill-files.config.ts
```

此模式**不要设置** `STUDIO_LOCAL_DEV_MODE`。测试会在目标组织真实创建专用 Skill 和 Agent，再恢复该测试 Agent 的空 pins；请使用获授权的验收组织。未获得实际会话或凭据时，不能用本地 dev-mode 冒充 devapp 验证。

可通过 `STUDIO_SKILL_SOURCE_URL`、`STUDIO_AGENT_SOURCE_URL` 使用已批准的 GitHub 来源；缺省复用仓库现有 GitHub 导入测试来源。公网可用性失败会真实报错，不回退 mock。
