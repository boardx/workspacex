# contract · chat 建议行按上下文推荐后台画布模板

> 规范唯一来源。签核见 `design-signoff.md`，验收见 `verification.md`。
> 触发缘由：人类 2026-09-06 当面交办 + 同日两轮实测反馈（issue #2825，PR #2832 / #2846）。

## §0 现状与病根

改动前，chat 建议行里的「生成用户画像」是 `copilotkit-v2-panel-body.tsx` 里一条**写死的
常量 chip**：19 个内置 + 组织自建的画布模板里只有 `persona` 一个进得了建议行，文案永远
相同，后台 template-admin 里新建/改名/停用模板对它毫无影响。

与 issue #1493（chat 指引写死清单）、`persona-summary.ts`（字段清单写死）同型——都是
「后台改了、chat 照旧」。

人类原话：「可否变为一个动态的、更具上下文来推荐可视化模板的地方，而不只是用户画像，
比如上面是用户画像，就可以推荐用户旅程图、同理心地图等，主要渲染我们在后台定义好的
画布模板」。

## §1 数据：推荐关系进模板注册表，后台可编辑

- `canvas_templates.recommend_after text[]`（迁移 `20260906130000_…`）。同 `tags` 的形状。
- 契约 `canvas.updateTemplateMetadata` 收/回 `recommendAfter`；`listTemplates.out` 带上它。
  与 title/footer/promptText 同类：**元数据**，对任何状态生效，物理上碰不到 `sections`。
- **不加外键**：「现在还存不存在、可不可见」只有读取那一刻的 `listTemplates` 知道
  （可见性按人算，数据库约束按行算，判不了同一件事）。消费端按当次已发布清单取交集，
  解析不到的 key 安静跳过。
- 内置 19 个模板的默认推荐图 `BUILTIN_RECOMMEND_AFTER`（`domain/canvas/builtin-template-config.ts`）
  只是**读路径对 `builtin` 行空值的兜底**，与 `prompt_text` 的既有兜底同一条纪律。
  组织自建模板留空是合法状态，不兜底。

## §2 规则：一个纯函数

`domain/canvas/template-recommendation.ts`，不碰 I/O：

输入两件事实——① 这条线程已经画过哪些模板（扫 canvas/persona 围栏的 `模板: <key>`，
即 issue #1493 那套既有语法；再加 `PERSONA_SUMMARY_AUTHOR_ID` 那条产出，它落的是
mindmap 围栏、扫不出来）；② 已发布模板各自的 `recommendAfter`。

**三个梯队依次兜底**，直到凑够 `limit` 或没得推：

| 梯队 | 内容 | 排序 |
|---|---|---|
| ① | 已画过的模板明确配了的下一步 | 被推荐次数，并列按模板库顺序 |
| ② | 起点模板里还没画的（推荐图入度为 0） | 出度（能带出更多后续的在前），并列按库顺序 |
| ③ | 其余还没画过的已发布模板 | 模板库顺序 |

已画过的自始至终排除在外；库里每一张都画过 ⇒ 返回空（不推荐一件刚做完的事）。

⚠ **梯队②③是同日第二轮实测反馈之后加的**（「我看到第二轮以后就没有了，每一轮都要有
推荐的下一步的动作」）。只有梯队①时，组织自建模板的 `recommend_after` 是空的，模型一
画出这类模板就再也拿不到任何建议。

## §3 端点

`GET /chat/threads/:threadId/canvas-template-recommendations`（`chat.recommendCanvasTemplates`）：

- 判权与 `getThread` 同一条守卫读路径（`resolveVisibility` → `findMessages` → `discloseDecided`）；
- **不调模型、不写库**；模板库读不到时返回空 `items` 而不是报错（建议行是锦上添花）；
- `out.items[]` = `{ key, displayName, prompt }`，上限 4，当前渲染 3（`MAX_RECOMMENDATIONS`）；
- `prompt` **服务端拼**：围栏格式约定属于 `buildCanvasTemplateGuidance` 那一份，前端再拼
  一遍就是第二份副本。

## §4 前端只渲染与分派

- chip 文案 = 后台 `displayName`；非 `persona` 的点击 = 发服务端给的 `prompt`（普通消息，
  由已注入 system prompt 的 canvas 指引带模型产出围栏，**不需要新端点**）；
- `persona` 仍走已签核的 `summarizePersonaFromThread`（delta `chat-persona-roundtrip`）——
  它产出 mindmap 消息 + 一份 draft Artifact，改成发消息会悄悄取消那份已签核的落地行为；
- 关闭状态按 (线程, 模板 key) 存 `localStorage`；`persona` 沿用 issue #2694 的旧键名。
- 后台编辑器「用完之后推荐」：只渲染已选中的几条 + 「＋ 添加」浮层（搜索 + 限高滚动）。
  第一版摊开整库，人类实测「有可能会有 50 个 chips，现在的办法有问题」。

## §5 请人类拍板的两处取舍（实现已按下述先做）

1. **三梯队兜底** vs. 「没配过就不推」（只留梯队①）。
   实现选前者。理由：对没配过任何推荐关系的组织，**梯队②本身就等于整个库**（没有边时
   所有模板入度为 0、全部算起点），所以梯队③只在「配了图、且起点都画过」时兜一次底；
   收紧省下的噪音很少，代价是把「每一轮都有下一步」重新变成有条件的。
   ⚠ 起点模板之间按**出度**排是一个启发式，不是断言"出度高就该先画"；它比 key 字典序
   诚实（实测字典序选出来的是「AI 战略画布 / 汉堡沟通模型 / 戏剧结构金字塔」）。
2. **一次最多推 3 条**（契约上限 4）。建议行里还并排渲染 CopilotKit 的模型追问建议，
   两边加起来超过一行会把 composer 顶下去。

## §6 这套排序 schema 表达不了

`out.items` 只是一个有序数组。权威描述是**三处**：本文件 §2、`chat.ts` 里该操作的头注、
以及 `template-recommendation.ts` 那个纯函数与它的测试。改行为时三处一起改。
