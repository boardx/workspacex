# 契约束 `review-governance` — 支撑材料：UC 覆盖证明

> 本束无对外 API，「API 操作」列统一记为 `N/A（内部治理数据）`。

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| UC-1 写入评审记录（08-R3, 08-R12） | N/A | `.harness/state/uiux-review-log.jsonl` | ⏳ 待 F13 落地 |
| UC-2 Top5 扣分维度统计（08-R3, 08-R12） | N/A | 统计脚本 CLI 输出 | ⏳ 待 F13 落地 |
| UC-3 chat 主屏正式评审（09-R3, 09-R12） | N/A | `chat-main-fidelity-rubric.md` 评审记录 | ⏳ 待 F14 落地 |
| UC-3 profile/org-admin 正式评审（09-R6, 09-R12） | N/A | `uiux-screenshot-review-profile-org.md` 评审记录 | ⏳ 待 F15 落地 |
| UC-4 全站终验（10-R3, 10-R12） | N/A | 终验报告 | ⏳ 待 F16 落地，依赖 F01-F15 |

## 覆盖状态图例
- ✅ 已落地并有自动化验证　⏳ feature 未开工，UC 已定义　❌ 有缺口需要处理

## 门控命令映射（形态 B，签核③ 见 `domain.md` 声明）
本束无对外 HTTP 面。下表以 R12 验收线索为行键，记录证明本束不变量成立的可执行门控命令。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | 评审日志结构化落盘 + Top5 统计 | `pnpm --filter api exec vitest run tests/uiux/review-log-schema.test.ts`；`pnpm --filter api exec vitest run tests/uiux/review-log-stats.test.ts` | F13 | 待落地 |
| V2 | chat 主屏保真度 ≥9 门槛断言 | `pnpm --filter api exec vitest run tests/uiux/review-log-chat-threshold.test.ts`；`pnpm --filter web exec playwright test -c playwright.chat-shots.config.ts -g 'chat fidelity shots'` | F14 | 待落地 |
| V3 | profile/org-admin 保真度 ≥9 门槛断言 | `pnpm --filter api exec vitest run tests/uiux/review-log-profile-org-threshold.test.ts`；`pnpm --filter web exec playwright test -c playwright.self-service-profile.config.ts -g 'profile fidelity shots'` | F15 | 待落地 |
| V4 | 全站终验：机械门控全绿 | `pnpm --filter web run lint:design`；`pnpm --filter web run contrast`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'axe full-site'`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'keyboard'` | F16 | 待落地 |
