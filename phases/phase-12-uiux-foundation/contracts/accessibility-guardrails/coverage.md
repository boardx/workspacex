# 契约束 `accessibility-guardrails` — 支撑材料：UC 覆盖证明

> 本束无后端 API，「API 操作」列统一记为 `N/A（前端行为验证）`。

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| UC-1 chat/profile 键盘走查（03-R3, 03-R12） | N/A | `apps/web/app/chat/**`、`apps/web/app/profile/**` | ✅ F05 已落地 |
| UC-1 org-admin 键盘走查（03-R6, 03-R12） | N/A | `apps/web/app/org-admin/**` | ⏳ 待 F06 落地 |
| UC-2 第三方样式登记（04-R3, 04-R12） | N/A | `globals.css` 登记表 + `lint-design.sh` U9 | ⏳ 待 F07 落地 |
| UC-3 图片/图标标注（05-R3, 05-R12） | N/A | 全站 `<img>`/`next/image`/图标使用点 | ⏳ 待 F08 落地 |
| UC-4 axe-core 接入（03-R6, 05-R3） | N/A | CI 流程 | ⏳ 待 F06/F08 落地 |

## 覆盖状态图例
- ✅ 已落地并有自动化验证　⏳ feature 未开工，UC 已定义　❌ 有缺口需要处理

## 门控命令映射（形态 B，签核③ 见 `domain.md` 声明）
本束无对外 HTTP 面。下表以 R12 验收线索为行键，记录证明本束不变量成立的可执行门控命令。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | chat/profile 核心任务全键盘可达 | `pnpm run verify:chat-read`（含 `keyboard chat` 两条用例）；`pnpm run verify:self-service-profile`（含 `keyboard profile` 一条用例）——权威命令见 `feature_list.json` F05.verification，此处不重复第二份 | F05 | ✅ 已落地 |
| V2 | org-admin 键盘可达 + axe-core keyboard 扫描 | `pnpm --filter web exec playwright test -c playwright.config.ts -g 'keyboard org-admin'`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'axe keyboard'` | F06 | 待落地 |
| V3 | 第三方样式覆盖登记表 + lint 关卡 | `pnpm --filter web exec vitest run tests/lint-third-party-style-registry.test.ts`；`pnpm --filter web run lint:design` | F07 | 待落地 |
| V4 | 图片/图标可访问性标注 + axe image-alt | `pnpm --filter web exec vitest run tests/lint-image-alt-nextimage.test.ts`；`pnpm --filter web exec playwright test -c playwright.config.ts -g 'axe image-alt'` | F08 | 待落地 |
