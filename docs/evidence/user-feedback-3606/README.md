# #3606 查看项目按钮

附件指定 `/studio/agents` 示例卡片右下方。两张卡片都新增标准 Button + Next Link，进入现有 `/projects` 列表。示例智能体未绑定项目，不构造关联项目 ID，不改 API、鉴权或运行能力。

验证通过：
- `./init.sh`（依赖与快速健康检查，exit 0）。
- `pnpm --filter web typecheck`（exit 0）。
- `pnpm --filter web lint`（ESLint、light-scope、design lint，exit 0）。
- `node docs/evidence/user-feedback-3606/browser-check.cjs`（exit 0）：1280px / 375px，两张卡片链接为 `/projects`；Tab 聚焦、Enter 导航后真实项目页组件可见，浏览器返回正常，卡片与页面无横向溢出。截图已人工查看。

浏览器为真实 Chromium + 独立 Next dev，但身份接口和空项目列表是明确的 UI fixture；本证据证明导航和响应式布局，不声称真实认证/后端端到端验证。复现：先在仓库根启动 `NEXT_DIST_DIR=.next-feedback-3606 pnpm --filter web exec next dev -p 3606`，再执行上述脚本。服务已停止，无 Docker 资源。
