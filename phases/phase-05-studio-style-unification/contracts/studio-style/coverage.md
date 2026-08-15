# 契约束 `studio-style` - ④ UC 覆盖证明

本束无对外 HTTP 面，见 `domain.md` 的形态 B 声明。“API 操作 / 门控命令”列记录可执行的现有行为回归命令，证明视觉统一没有改变既有契约。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | 三个列表页保留既有数据展示和操作行为 | `pnpm --filter web exec vitest run tests/ui/guided-research-home-live.test.tsx tests/ui/interview-studio-home.test.tsx tests/ui/personal-transcription-history.test.tsx` | F01 | 已验证 |
| V2 | 创建名称及最多五个标签的既有流程不变 | `pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx` | F01 | 已验证 |
| V3 | 样式使用设计 token，未引入硬编码违规 | `pnpm --filter web run lint:design` | F01 | 已验证 |
| V4 | 类型契约未被视觉改动破坏 | `pnpm --filter web run typecheck` | F01 | 已验证 |
