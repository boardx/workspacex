# 契约束 `motion-microinteraction` — 签核①：UI（界面落点）

> ## ✅ 自检（可机械核对）：**本文件引用 4 张截图，目录下实际 4 张。**
>
> 目录：`phases/phase-12-uiux-foundation/ui-preview/motion-microinteraction/`
> 由 ui-prototyper 产出（脚本 `apps/web/scripts/shot-phase12-signoff.mjs`）。
>
> ⚠ **本轮范围限定为原有 F03/F04**：动效 token 档位对照 + 对话面「消息到达 / 面板展开」
> 的界面落点参考。`design-signoff.md` ②节人类已把编排动效扩到三类（追加首屏加载
> UC-5、上传进度 UC-6），但那两类属未来 F17/F18，本轮**不产出**其材料。
> 静态 png 无法完整表达动效——这里给的是「取值对照 + 落点参考」，不是动效本身。

## 材料说明

- **动效 token 档位对照**：`/kitchen-sink` 新增「动效 token 档位对照」展示区，三档
  （fast 150ms / base 200ms / slow 300ms）套在同一组卡片上，附时长标注。静止态一张、
  hover 中档一张，用于人类确认取值与观感差异。取值不在组件里散写。
- **对话面落点参考（非编排动效本身）**：从对话主屏（权威原型 `WorkspaceX Standalone.html`，
  与 `shot-chat-prototype-ref.mjs` 同源）截「消息列表默认态」与「右侧过程区展开态」，
  作为「消息到达 / 面板展开」编排动效将来落地的**位置参考**。线上 `/chat` 未登录会跳
  `/login`（需后端栈），故对话面取自这份已确认设计语言的权威原型。

## 索引表

| 状态 | 文件名 |
|---|---|
| 动效 token 三档对照 · 静止态 | f03-motion-tokens-rest.png |
| 动效 token 三档对照 · hover 中档（200ms） | f03-motion-tokens-hover.png |
| 对话主屏消息列表默认态（消息到达落点） | f04-chat-message-list-default.png |
| 右侧过程区展开态（面板展开落点） | f04-chat-panel-expanded-default.png |

> 覆盖 feature 与依据见 `design-signoff.md`（权威）。设计决定与待确认清单见
> `phases/phase-12-uiux-foundation/ui-preview/README.md`。
