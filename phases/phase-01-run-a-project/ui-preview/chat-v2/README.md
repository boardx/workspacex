# UI 先行原型 v2 · `chat`（对话） · `/chat/preset` 预设对话与技能 —— ADR-003 关卡材料

> **本目录是 chat 束的新签核材料集**（`ui-material-map.json`：chat → `ui-preview/chat-v2`）。
> 本轮只重画**一屏**：`/chat/preset`（UC-8.4，11 张 `uc-8-4-preset-*`）。
> `/chat/landing`（UC-8.3）的 9 张**原样承载**自 v1；`/chat` 主屏（S1）仍零截图（v1 就缺，非本轮）。
> v1 目录 `ui-preview/chat/` 保留不动。逐条偏移对照见同目录 `V1-WAS-WRONG.md`。
>
> 共 **20 张 png**（11 预设 + 9 落地），命名 `<uc-id>-<屏名>-<状态/视角>.png`。
> 路由 `/chat/preset`，七态（`?state=`）× 四视角（`?as=`）。真实组件 + mock，非设计稿。

---

## 一、截图 → UC → feature 映射（重画屏）

| 截图前缀 | 屏 | 对应 UC / 节 | 覆盖状态 |
|---|---|---|---|
| `uc-8-4-preset-*` | 预设对话与技能（四列表 + 编辑器弹层 + 点开即用消费端） | UC-8.4 R3/R5/R8 · F115 | 七态全 + observer/member 消费端 + 编辑器开态 + 越界拒发 |

落地屏 `uc-8-3-landing-*`（9 张）映射见 v1 目录 `ui-preview/chat/README.md`（未变）。

### 关键 testid 锚点（预设屏）
`chat-preset`（根）· `chat-preset-new` `chat-preset-new-inline`
`chat-preset-answered` `chat-preset-answered-{id}`（三条原型已答）
`chat-preset-table` `chat-preset-row-{id}` `chat-preset-skill-{id}-{name}` `chat-preset-scope-warn-{id}` `chat-preset-to-{id}` `chat-preset-used-{id}` `chat-preset-rule`
`chat-preset-consumer` `chat-preset-consumer-item-{id}` `chat-preset-open-{id}` `chat-preset-consumer-note`
`chat-preset-editor` `chat-preset-editor-title` `chat-preset-editor-vis` `chat-preset-editor-start-{name}`
`chat-preset-editor-name` `chat-preset-editor-skills` `chat-preset-editor-add-skill` `chat-preset-editor-context`
`chat-preset-editor-targets` `chat-preset-target-{id}` `chat-preset-ctx-{label}` `chat-preset-editor-opening`
`chat-preset-editor-save` `chat-preset-editor-cancel` · 校验保留名 `err-preset-scope`

---

## 二、三条 v1「待裁决」的原型答案（签核第一件要看的）

| 问题 | 原型答案 | 出处偏移 | 界面落点 |
|---|---|---|---|
| 谁能给谁下发预设？ | 引导师下发给组长 / 组员 | 弹层标题 16836655 | `chat-preset-answered-who-can-dispatch` + 编辑器标题 |
| 被下发者能不能改？ | 能改（引导师已配好，可增减） | 15574080 | `chat-preset-answered-can-recipient-edit` + 编辑器「预设技能」区 |
| 被下发者能不能拒 / 忽略？ | 上架供取用「点开即用」，不是推送 | 15448694 / 16837179 | `chat-preset-answered-can-recipient-refuse` + 规则条 + 消费端 |

**这三条不再是待裁决**——签核时若产品认可原型口径即可通过；若产品要另立口径，才需裁决。

---

## 三、界面上无法自洽的点（签核重点看）

1. **下发对象：角色范围 vs 组覆盖，两种粒度并存。**
   原型列里 `to` 是角色范围（全部组长/组员），编辑器里又有「只给第 4 组」的组覆盖。
   我把角色范围做成主模型（`DispatchTargetKind` 三值）+ 组覆盖作为编辑器里的可选叠加。
   **越界拒发的判定（V1c）建在组覆盖上**（含仅某组可见的 skill 时下发给别组即拒）。
   若产品要「组下发」成为一等档，`DispatchTargetKind` 要扩。

2. **屏的归属：顶层 `/chat/preset` vs 工作坊范围内。**
   原型预设屏在**工作坊详情 → 对话子页**（`wsPhase="chats"`，项目/组作用域），页头是「{组名} 的对话」。
   我沿用 v1 的顶层路由 `/chat/preset`（左栏是「本线程的 AI 团队 · 6」，非工作坊上下文）。
   **这是 v1 的落点取舍，v2 未改**——签核时若判定预设必须在工作坊范围内，路由与左栏上下文要改。

3. **使用计数口径。** 原型「使用」列是 `9 次 / 4 次 …`（真实使用实例数，AC1），不是下发人数。
   我按「真实实例数」呈现。若「被下发者改了预设后再用」是否计入同一预设的实例数，原型未明说——
   这与问题②「能不能改」耦合（能改 ⇒ 改后是否还算同一实例）。

---

## 四、本版相对 v1 推翻了什么、为什么（详见 `V1-WAS-WRONG.md`）

| # | v1 的做法 | v2 推翻为 | 为什么 |
|---|---|---|---|
| 1 | 「预设原型 0 命中、每个控件都是新设计」 | 按原型 9 处命中逐字复原一整屏 | 原型是完整一屏（15442983 起 + chatPresets 16974471 + 编辑器 16836655） |
| 2 | 三条权限规则渲染成「待裁决」卡 | 换成「原型已答」三卡（带出处偏移） | 三条原型全部答死（16836655 / 15574080 / 15448694） |
| 3 | 下发对象 = 组范围（全场/指定组/指定角色） | 角色范围（全部组长/组员）+ 可选组覆盖 | 原型 `to` 是角色范围，编辑器才有「只给第 4 组」 |
| 4 | 预设语料 = 战略咨询团队 | 现场小组工具（补齐产出缺口/唱反调/事实核查/汇报稿三句话） | 原型 chatPresets 全是组员现场小工具 |

**v1 的截图与目录 `ui-preview/chat/` 保留不动**（推翻要留痕）。

---

## 五、建议 sign-off 时重点核对的 3 处

1. **三条「原型已答」是否被产品接受为最终口径**（§二）——若接受，UC-8.4 的权限模型即可定；
   若产品要另立（例如允许组长下发），这三条要显式改，别默认沿用原型。
2. **下发对象的角色范围 vs 组覆盖 + 越界拒发时机**（§三.1）——V1c「下发时即拒」建在组覆盖上，
   这决定 F115 落库的下发对象模型基数，做错返工面大。
3. **预设屏的归属：顶层 `/chat/preset` vs 工作坊范围内**（§三.2）——原型在工作坊详情下，
   v1/v2 都放在顶层，这是尚未确认的落点取舍。
