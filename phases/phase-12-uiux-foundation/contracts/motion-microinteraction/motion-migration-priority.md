# 全仓存量裸 duration/ease 迁移优先级（F03；R5）

> requirements/02-motion-token-system.md#R5：「全仓存量的 167 处手写 transition 逐步
> 迁移（可分批，不要求本 feature 一次性改完，但需给出迁移优先级：先改高频交互组件）」。
> 本文件是那份优先级清单。存量豁免的机械登记见同目录
> `../../../../apps/web/scripts/motion-legacy-allowlist.txt`（下称"豁免清单"，
> 单一事实源；迁移完一批就同步从那份清单删掉对应行，不要在这里重复记录数值）。

## 现状（本次生成时点）

F03 已把 `dialog.tsx` / `dropdown-menu.tsx` / `select.tsx`（+ `kitchen-sink` 展示区
`primitives-gallery.tsx`、`page.tsx` 各一处）迁移到 `duration-base`/`ease-base`。
`tooltip.tsx` 的 `TooltipContent` 迁移前没有 `transition-*`，本次未新增行为。

迁移后豁免清单里还剩 **189 条**（198 处原始命中，同文件内完全相同的重复行合并计数），
按顶层目录统计的密度如下（越靠前建议越先排期）：

| 目录 | 命中数 | 备注 |
|---|---:|---|
| `components/ui` | 11 | **最高优先级**——每一个都是全仓复用的基础原语（`avatar`/`badge`/`button`/`checkbox`/`input`/`progress`/`tabs`/`textarea`/`toggle`），改一处等于全站生效。`button.tsx` 还额外带着本仓最后一处裸 `ease-in-out`。 |
| `components/shell` | 10 | 顶栏/侧栏导航壳，几乎每个页面常驻可见（`icon-rail`/`org-menu`/`personal-menu`/`theme-toggle`/`top-bar`/`mobile-tabs`）。 |
| `components/chat` | 20 | 主力功能区，用户停留时长最高的界面；数量最多但耦合度也最高（消息流、附件、面板），建议拆多个小 PR 而非一次性大改。 |
| `components/projects` / `components/files` | 9 / 12 | 高频次级入口（项目卡片、文件树），复用度仅次于 `ui`/`shell`。 |
| `components/canvas` / `components/interview` / `components/admin` | 13 / 12 / 15 | 单一领域内高频，但不跨域复用，可按领域各自排期。 |
| 其余（`survey`/`rec`/`itv`/`tpl`/`entry`/`live-collab`/`tasks`/`skill`/`research*`/`org-admin`/`studio`/`agent-runtime`/`brain`/`profile`/`feedback`/`state`、`app/preview/*`） | ≤7 每项 | 使用面窄或位于 `/preview` 演示页，最低优先级；`app/preview/*` 是原型/演示路由，不承载真实用户流程。 |

## 排期建议（三批）

1. **第一批（P0，建议紧随 F03 之后）**：`components/ui/*` 9 个文件 + `components/shell/*`
   6 个文件——共 21 处，全部是"改一处、全站受益"的基础层，风险低（纯类名替换，
   `duration-200 → duration-base`，数值不变），建议作为 F04 或独立小 feature 的
   前置清理一次性做完。
2. **第二批（P1）**：`components/chat`、`components/projects`、`components/files`——
   高频功能区，建议跟随对应功能线的下一次改动顺手迁移（不建议单独开一个"改
   41 处"的大 PR，风险与 review 成本不成比例），每次改动记得同步删豁免清单对应行。
3. **第三批（P2，机会性迁移）**：其余领域专属组件——数量少、复用面窄，随该领域
   下次有实质性改动时顺手迁移即可，不必专门排期。

## 已知例外（R4-A1，不计入上表迁移范围）

- 无——本次扫描到的命中全部是可直接替换的 `duration-<数字>`（150/200/300 三档
  覆盖了几乎全部数值）或 `ease-in-out`（`button.tsx` 一处），没有发现依赖具体
  数值联动第三方库的特例。若未来发现这类特例，按 R4-A1 记录到组件自身注释里，
  并在豁免清单对应行旁加一句原因，不要静默绕过 U10。
