# 会话交接 — Sprint 01/08

## 当前已验证
- F180 保持 `in_progress`；功能定向测试全部通过：contracts 6、隔离 API 7、状态 13、UI 34、rewrite 1。
- Web typecheck、权限路径、架构依赖、UI 材料和设计 token 门禁通过。

## 本轮改动
- 新增研究步骤左侧上下文 Skill，建议必须显式应用且支持撤销。
- 主题、方向、大纲、演示资料研究、演示报告和显式完成按服务端持久化阶段顺序解锁。
- 首页完成态由持久化 status 驱动，显示「已完成」和「查看报告」。
- 最新 main 已合入；因 F174 被主干蓝本功能占用，本功能迁移为 F180 / Sprint 08。

## 仍损坏或未验证
- `pnpm --filter api run typecheck` 被未改动的 `packages/fabric-markdown` DOM 类型基线错误阻塞。
- 没有可用登录态，1280px / 1920px 的完整浏览器旅程仍未补；没有伪造截图证据。
- GitHub issue/PR 尚待发布；F180 不得手工改为 passing。

## 下一步最佳动作
- 完成整分支审查后创建 F180 issue，推送分支并开 PR；PR 明确披露两个剩余门禁。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/08`
- 定向 UI:`pnpm --filter web exec vitest run --pool=forks --maxWorkers=1 --minWorkers=1 tests/ui/guided-research-skill-assistant.test.tsx tests/ui/guided-research-visual-contract.test.tsx tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-home-live.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx`
