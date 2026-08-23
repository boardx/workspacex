# phase-12-uiux-foundation · UI 签核①材料（ui-prototyper 产出）

四个契约束的签核第①件（UI）材料，全部用 `apps/web` 的**真实组件 + mock 数据**产出，
非手绘 / 非编造。截图脚本：`apps/web/scripts/shot-phase12-signoff.mjs`
（`BASE=http://localhost:3199 node scripts/shot-phase12-signoff.mjs`，共 16 张）。

束 ↔ 目录 映射的唯一事实源是 `.harness/scripts/ui-material-map.json`；
每束引用集合与目录实存集合由 `node .harness/scripts/lint-ui-material.mjs` 逐张核对。

## 每个屏对应哪个束 / 哪一节

| 束 | 文件 | 来源 | 对应节 |
|---|---|---|---|
| interaction-primitives | f01-f02-primitives-default / f01-dialog-open / f01-dropdown-open / f02-select-keyboard-nav / f02-tooltip-focus | `/kitchen-sink` 新增「弹层原语」区（真实组件） | F01/F02 |
| motion-microinteraction | f03-motion-tokens-rest / f03-motion-tokens-hover | `/kitchen-sink` 新增「动效 token 档位对照」区 | F03/F04 |
| motion-microinteraction | f04-chat-message-list-default / f04-chat-panel-expanded-default | 对话主屏权威原型 | F03/F04 落点参考 |
| accessibility-guardrails | uc-a11y-chat-composer-thread-default | 对话主屏权威原型 | chat 输入区 + 会话列表 |
| accessibility-guardrails | uc-a11y-profile-form-default | `/profile/preview`（真实 ProfileScreen + 离线 mock session） | profile 资料编辑表单 |
| accessibility-guardrails | uc-a11y-orgadmin-members-default / uc-a11y-orgadmin-permission-dialog-default | `/org-admin/preview`（真实 OrgAdminApp + mock） | 成员列表 + 权限弹层 |
| review-governance | uc-review-chat-main-default | 对话主屏权威原型 | chat 主屏整体 |
| review-governance | uc-review-profile-default | `/profile/preview` | profile 整体 |
| review-governance | uc-review-orgadmin-default | `/org-admin/preview` | org-admin 整体 |

## 我（ui-prototyper）替 UC 做了哪些它没写明的设计决定

1. **裁掉了 Table/Menu/Breadcrumb/Pagination**（interaction-primitives）：本轮只做 01 号
   需求（F01/F02）的四个弹层原语，06 号需求 / F09 / F10 的复合组件跳过，留待 F09 盘点。
2. **Select 用 DropdownMenu.RadioGroup 组合，不引入 `@radix-ui/react-select`**：依赖里没有
   它，为不动依赖树用已在库的 dropdown-menu 组合出单选下拉（`components/ui/select.tsx`）。
   键盘模型与原生 select 等价；严格 combobox 语义留作独立 delta。
3. **动效档位定为 fast=150ms / base=200ms / slow=300ms**：UC 未给具体数值，我按现有
   Tailwind duration 档位并结合 `button.tsx` 既有的 `duration-200` 默认取的这三档。
4. **对话面（chat）三张参考图取自权威原型 `WorkspaceX Standalone.html`，不取线上 `/chat`**：
   线上 chat 未登录会跳 `/login`（需完整后端栈：docker + seed + 登录），而 UI 先行截图
   不应依赖后端；权威原型是已确认的设计语言，与 `shot-chat-prototype-ref.mjs` 同源。
5. **为 profile 新建了离线预览路径 `/profile/preview`**：把真实 `ProfileScreen` 组件套进
   新增的 `PreviewSessionProvider`（`components/session/session-provider.tsx`，注入 mock 身份、
   零网络）离线渲染。生产 `/profile` 的 session 行为一字未改。活动记录区因无后端显示
   「依赖不可用」，属预期——本图只为看资料表单落点。
6. **org-admin 权限弹层用 `?org=org-local` 解锁**：mock 身份只有 local org 才是 admin，
   邀请入口（= 权限设置弹层）对非 admin 禁用。顶栏因此显示为「本地」组织；成员列表与
   邀请弹层内容与 org 无关，是 mock 常量。

## R8 线索之间的矛盾与处理

- **a11y / review-governance 都要 chat/profile/org-admin，但线上这三页离线不可渲染**
  （chat/profile/org-admin 都走 session 门，未登录跳 `/login`）。处理：org-admin 有现成的
  mock 预览页 `/org-admin/preview` 直接用；profile 新建 `/profile/preview` 离线渲染真实组件；
  chat 无 mock 主屏路径，取权威原型。三种来源各取该屏最忠实的离线可渲染面。
- **motion 束②节人类已把编排动效扩到三类，但本轮范围仍是 F03/F04**（launching agent
  明确）。处理：只产出 token 档位 + 消息到达/面板展开落点，UC-5/UC-6（F17/F18）不产。

## 建议人类在束级 design-signoff.md 第①件签核时重点核对的 3 处

1. **interaction-primitives**：Select 用 dropdown-menu 组合（非 radix-select）是否可接受为
   本阶段的 Select 落点？还是要求先引入 `@radix-ui/react-select`？（见 f02-select-keyboard-nav）
2. **accessibility-guardrails / review-governance**：chat 三图取自**权威原型**而非线上页面，
   profile 取自新建的离线预览页——这些替代来源是否满足「确认签核①问的是正确页面」的
   目的？若必须是线上真实页面截图，需要另行安排带后端栈的取证。
3. **motion-microinteraction**：动效三档取值（150/200/300ms）与「消息到达 / 面板展开」的
   落点位置是否认可？编排动效的准确时间线仍待②节的编排时刻拍板后在 F04 落地。
