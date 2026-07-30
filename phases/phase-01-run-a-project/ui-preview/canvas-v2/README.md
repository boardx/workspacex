# UI 先行原型 v2 · `canvas`（画布） · 后台画布模板编辑器 —— ADR-003 关卡材料

> **本目录是 canvas 束的新签核材料集**（`ui-material-map.json`：canvas → `ui-preview/canvas-v2`）。
> 本轮只重画**一屏**：后台画布模板【编辑器】（`/canvas?screen=template-editor`，11 张 `uc-7-1-template-editor-*`）。
> 其余四屏（template-admin / segment-binding / ai-draft / editor / backflow，40 张）**原样承载**自 v1。
> v1 目录 `ui-preview/canvas/` 保留不动。逐条偏移对照见同目录 `V1-WAS-WRONG.md`。
>
> 共 **51 张 png**，命名 `<uc-id>-<屏名>-<状态/视角>.png`。
> 路由 `/canvas`，一页切六屏（`?screen=`）× 四视角（`?as=`）× 七态（`?state=`）。真实组件 + mock，非设计稿。

---

## 一、截图 → UC → feature 映射（新增屏）

| 截图前缀 | 屏 | 对应 UC / 节 | 覆盖状态 |
|---|---|---|---|
| `uc-7-1-template-editor-*` | 后台画布模板【编辑器】（设计对话 / fabric⇄Markdown / 分区属性含每区 AI 权限 / 版本历史 / 填充率） | UC-7.1 R3 · F100/F101 | 七态全 + observer + member + 选中「影响因素」区 + 发布二次确认 |

其余 40 张（`uc-7-1-template-admin-*` / `uc-7-1-segment-binding-*` / `uc-7-2-ai-draft-*` /
`uc-7-3-editor-*` / `uc-7-4-backflow-*`）的映射与说明见 v1 目录 `ui-preview/canvas/README.md`（未变）。

### 关键 testid 锚点（编辑器屏）
`canvas-template-editor`（根）· `tpled-publish` `tpled-tryrun` `tpled-back` `tpled-has-unpublished`
`tpled-design-dialog` `tpled-dialog-turn-{i}` `tpled-dialog-parsed-{i}` `tpled-dialog-upload` `tpled-dialog-quick-{q}`
`tpled-dual-sync` `tpled-sync-status` `tpled-mermaid` `tpled-rebuild` `tpled-dual-use-note`
`tpled-inspector` `tpled-infobar` `tpled-zones` `tpled-zone-{num}` `tpled-zone-fill-{num}` `tpled-zone-props`
`tpled-zone-prompt` `tpled-zone-required-{num}` `tpled-zone-ai-perm` `tpled-zone-ai-add-{num}` `tpled-zone-ai-edit-{num}`
`tpled-versions` `tpled-version-{v}` `tpled-version-diff-{v}` `tpled-version-rollback-{v}`
`tpled-usage` `tpled-fill-{num}` `tpled-diagnosis`
`tpled-confirm` `tpled-confirm-impact` `tpled-confirm-ok` `tpled-confirm-cancel` `tpled-readonly-note`

---

## 二、界面上无法自洽的点（签核重点看）

1. **每区 AI 权限（模板级）与项目级三开关、D-10「AI 默认落笔」三者的关系未定。**
   本编辑器把「允许 AI 补便签 / 允许 AI 改人写的便签」做成**模板分区级**的两个位（原型 15823358）。
   而 `ai-draft` 屏 / agent-runtime 侧有**项目级**三开关（O-23 默认全关）与 **D-10**（画布级默认直接落笔）。
   **三个粒度对同一件事各给了默认值**——模板级（本屏，原型未给默认，我置为「补便签多为开、改人写的便签多为关」）、
   项目级（全关）、画布级（默认落笔）。求交语义未定，签核需拍板谁压过谁。

2. **回滚的作用域。** 原型只写「回滚到此版」+「已用出去的画布锁在自己的版本上」。
   我把回滚实现为**只生成新的未发布草稿覆盖当前 v4**、不动 v3 发布版、不动历史画布，并在二次确认里写明。
   这是我替产品补的语义——若产品要「回滚 = 直接把发布版切回旧版」，二次确认文案与影响范围要改。

3. **填充率的 6 区里只有 4 区有数据。** 原型诊断只覆盖 4 个命名分区（96/88/61/17%）。
   我给新增的「动机」「关键场景」两区标「新区 · 无填充数据」，填充率区只列有数据的 4 区。
   若产品要 6 区全列（含 0% 空区），呈现要改。

---

## 三、我替 UC / 产品做的、UC 没写明的设计决定（逐条，请人类核对）

- **6 个分区的具体命名与颜色**：原型只逐字给了 4 个（痛点和挑战/目标和需求/行为与偏好/影响因素）+
  设计对话里提到「动机」。第 6 区「关键场景」与各区颜色是我按 persona 语义补的。
- **每区 AI 权限的默认档位**：原型给了控件但**没给每区的默认开/关**。我按「补便签普遍允许、
  改人写的便签默认收紧（仅影响因素区示范为开）」设默认，用只读 `StaticSwitch` 呈现档位。这是提案，需确认。
- **危险动作二次确认**：原型的「发布 v4」「回滚到此版」是裸按钮。我按 canvas 束的危险动作规范
  （删除/发布/回滚显式二次确认 + 影响范围）加了确认框与影响文案。力度需确认。
- **视角投影**：编辑器属组织后台，仅组织管理员 / 模板作者可编辑。observer 与 member 视角均只读投影
  （发布/回滚/编辑禁用），denied 态标为组织层限制。视角切换是预览手段，真实权限在服务端。

---

## 四、本版相对 v1 推翻了什么、为什么（详见 `V1-WAS-WRONG.md`）

| # | v1 的做法 | v2 推翻为 | 为什么 |
|---|---|---|---|
| 1 | 后台画布模板【编辑器】整屏未画，README 报「原型里根本不存在」 | 按原型 `isAdCvEdit`（15800335–15829400）四大块逐字复原 | 原型是成熟一整屏，7 个关键词在 v1 代码里全 0 命中 |
| 2 | 「每区 AI 权限」这条被 canvas 列为待裁决 | 做进分区属性（原型 15823358 已答死于模板层） | 模板级 AI 权限位原型明确给了，不是待裁决 |
| 3 | 版本历史 / 回滚 / 填充率诊断均无形态 | 版本历史 v4·v3·v2 + 回滚 + 填充率 + Ava 诊断 | 原型 15824817–15829400 逐条给了 |

**v1 的截图与目录 `ui-preview/canvas/` 保留不动**（推翻要留痕，不是抹掉）。
⚠ `segment-binding` 屏审计另判重做（原型 16625077「Skill 绑定 · 绑在环节上 + 降级阻断发布」），
**不在本轮范围**，其 v1 截图原样进 canvas-v2，签核时单独处置。

---

## 五、建议 sign-off 时重点核对的 3 处

1. **每区 AI 权限 × 项目级三开关 × D-10 的求交语义**（§二.1）——三个粒度对同一件事给了不同默认，
   这是最容易做出「两个 gateway」的地方，越早定越省。
2. **每区 AI 权限的默认档位**（§三）——原型给了控件没给默认，我提的默认档位需产品确认，
   它直接决定「AI 在哪些区能补/能改人写的便签」这条现场行为。
3. **回滚的作用域与危险动作二次确认力度**（§二.2 / §三）——回滚=覆盖草稿 vs 切回发布版，
   两种语义影响面差很大，二次确认文案按前者写，需确认。
