# 契约束 `motion-microinteraction` — 支撑材料：UC 覆盖证明

> 本束无后端 API，「API 操作」列统一记为 `N/A（前端展示层）`。

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| UC-1 动效 token 定义（02-R3, 02-R12） | N/A | `tailwind.config.ts`、`globals.css` 注释 | ⏳ 待 F03 落地 |
| UC-2 消息到达编排动效（02-R6, 02-R12） | N/A | `components/chat/**`（具体文件待 F04 开工时确认） | ⏳ 待 F04 落地 |
| UC-3 面板展开编排动效（02-R6, 02-R12） | N/A | 侧边面板相关组件（候选，待 F04 开工时确认） | ⏳ 待 F04 落地 |
| UC-4 微交互稽核（07-R3/R6, 07-R12） | N/A | 四域稽核报告 + 修复 PR | ⏳ 待 F11/F12 落地 |
| UC-5 首屏骨架屏过渡（02-R13，人类 2026-08-23 追加） | N/A | chat/profile/org-admin 路由骨架屏 | ⏳ 待 F17 排期，依赖 F03/F04 |
| UC-6 上传进度动效（02-R14，人类 2026-08-23 追加） | N/A | 附件/长任务上传相关组件 | ⏳ 待 F18 排期，依赖后端进度事件源就绪 |

## 反向核查
- ⚠ 全仓 167 处存量 `transition-*` 手写用法的迁移优先级清单，需在 F03 开工时产出并回填本表，
  此处先如实标注为「未核查」。

## 覆盖状态图例
- ✅ 已落地并有自动化验证　⏳ feature 未开工，UC 已定义　❌ 有缺口需要处理

## 门控命令映射（形态 B，签核③ 见 `domain.md` 声明）
本束无对外 HTTP 面。下表以 R12 验收线索为行键，记录证明本束不变量成立的可执行门控命令。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | 动效 token 语义档位定义 + lint 拦截裸 duration/easing | `pnpm --filter web exec vitest run tests/lint-design-motion-rule.test.ts`；`pnpm --filter web run lint:design` | F03 | 待落地 |
| V2 | 编排级动效 + reduced-motion 降级 | `pnpm --filter web exec vitest run tests/ui/motion-orchestration.test.tsx`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'reduced motion'` | F04 | 待落地 |
| V3 | chat/profile 微交互一致性 | `pnpm --filter web exec vitest run tests/ui/microinteraction-chat-profile.test.tsx`；`pnpm --filter web run lint:design` | F11 | 待落地 |
| V4 | org-admin/canvas 微交互一致性 | `pnpm --filter web exec vitest run tests/ui/microinteraction-orgadmin-canvas.test.tsx`；`pnpm --filter web run lint:design` | F12 | 待落地 |
| V5 | 首屏骨架屏过渡（暂记 F17，排期未定） | `pnpm --filter web exec vitest run tests/ui/motion-skeleton-transition.test.tsx`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'reduced motion skeleton'` | F17 | 排期未定 |
| V6 | 上传进度动效（暂记 F18，依赖后端进度事件源） | `pnpm --filter web exec vitest run tests/ui/motion-upload-progress.test.tsx`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'reduced motion upload progress'` | F18 | 排期未定 |
