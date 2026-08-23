# 契约束 `accessibility-guardrails` — 支撑材料：UC 覆盖证明

> 本束无后端 API，「API 操作」列统一记为 `N/A（前端行为验证）`。

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| UC-1 chat/profile 键盘走查（03-R3, 03-R12） | N/A | `apps/web/app/chat/**`、`apps/web/app/profile/**` | ⏳ 待 F05 落地 |
| UC-1 org-admin 键盘走查（03-R6, 03-R12） | N/A | `apps/web/app/org-admin/**` | ⏳ 待 F06 落地 |
| UC-2 第三方样式登记（04-R3, 04-R12） | N/A | `globals.css` 登记表 + `lint-design.sh` U9 | ⏳ 待 F07 落地 |
| UC-3 图片/图标标注（05-R3, 05-R12） | N/A | 全站 `<img>`/`next/image`/图标使用点 | ⏳ 待 F08 落地 |
| UC-4 axe-core 接入（03-R6, 05-R3） | N/A | CI 流程 | ⏳ 待 F06/F08 落地 |

## 覆盖状态图例
- ✅ 已落地并有自动化验证　⏳ feature 未开工，UC 已定义　❌ 有缺口需要处理
