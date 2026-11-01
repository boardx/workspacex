# 中美定价 UI 原型进展

2026-11-01，用户要求 UI 先行，再按阶段完成。Issue #6086。唯一工作区 `.worktrees/cn-us-pricing-ui`，分支 `worker/cn-us-pricing-ui`，基线 `48ac496d5`，PR 目标 develop。

## 已交付到本地

- apps/web 真实组件与 `/preview/pricing` 路由，纯模拟数据；生产 billing 路由未替换。
- 个人／Team 账户双栏、Pro／Team 月年付选择、三档充值包、Free、Team 增员及到期、Enterprise 管理员升级和额度添加。
- 七种可切换状态及截图，索引见 `../../ui-preview/pricing-v1/README.md`。
- init 快速健康检查、Web typecheck、定向 ESLint、design lint 和五项浏览器测试通过，命令输出归档到 `evidence/`；后续修正须刷新证据。
- 只读审查发现购买周期污染账户周期、Team 过期历史矛盾两项 P2，已修正并补浏览器断言。

## 尚未完成

UI 已由用户在 2026-11-01 本会话明确确认；正式 API 契约、后端支付、真实权限校验、Free 发放、年度调度、旧订阅清理、发布均未开始。未修改 feature 状态或人工签核状态。PR #6087／CI 当前状态以 GitHub 为准，不把本地验证当作 CI 绿。

## 证据与资源

`evidence/` 保存命令输出；截图位于 `ui-preview/pricing-v1/`。本轮不启动 Docker、不访问生产服务器，不占用其他会话的 Chrome／Workbench。隔离 worktree 为后续阶段保留；本地预览端口 3526 用于人工审阅。

## CI 迭代

verify-control-plane 的跨层接线检查发现新增预览路由未登记。使用标准 `lint-ui-wiring.mjs --update` 生成原型分类，保持原棘轮上限和规则不变；本地复验通过。
