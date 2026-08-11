# chat-viz（VZ-01）UI 先行原型 —— 截图与状态清单

> ADR-023 签核第 ① 件（UI）材料。**人类**在束级 `contracts/<束>/design-signoff.md`
> 第 ① 件签核时看这里；本文件只列"待确认清单"，**不改任何 status**。

VZ-01 = AI 消息气泡内的 **markdown 渲染 + ```mermaid 内联图**。
纯客户端渲染 `msg.text: string`（markdown 源），**不接后端**。

## 预览怎么跑

```bash
cd apps/web && PORT=3131 pnpm dev
# 浏览器打开（顶部有场景切换 pill）：
#   http://localhost:3131/preview/chat-viz?scene=markdown
#   http://localhost:3131/preview/chat-viz?scene=mermaid
#   http://localhost:3131/preview/chat-viz?scene=error
# 截图复现：
BASE=http://localhost:3131 OUT=$(pwd)/../phases/phase-02-visible-outcomes/ui-preview/chat-viz \
  node scripts/shot-chat-viz.mjs
```

## 截图 ↔ 状态 ↔ 落点

| 截图 | scene | 对应 UC 节 | 覆盖状态 | 关键 testid |
| --- | --- | --- | --- | --- |
| `vz01-markdown.png` | markdown | UC-8.2 R3 步骤 3/4（AI 正文）· R8 富文本线索 | **成功（富 markdown）**：H2/H3、有序+无序列表、加粗、行内码、代码块、GFM 表格、blockquote、链接 | `chat-ai-markdown` |
| `vz01-mermaid-flowchart.png` | mermaid | 同上 · R8「结构化产出可视化」 | **成功（图渲染）**：白名单内 `flowchart` → 内联 SVG，图前后 markdown 正常 | `chat-ai-mermaid` |
| `vz01-mermaid-out-of-whitelist-error.png` | error | 同上 · 异常态 | **依赖失败/校验失败**：越界图类型（`xychart-beta`，白名单 12 种之外）+ 白名单内但语法错的 flowchart，两者各落诚实错误态并回显原文，整条消息不崩 | `chat-ai-mermaid-error`（`data-error-reason=whitelist \| syntax`） |

七态映射说明（VZ-01 是**纯客户端渲染**，天然只涉及其中几态）：
- 默认/成功 → markdown、mermaid 两屏
- 校验失败（语法错）+ 依赖失败（图类型越界/mermaid 抛错）→ error 屏两个错误盒
- 加载态 → 组件内有 `chat-ai-mermaid-loading`（"渲染图中…"），mermaid 异步 render 期间可见；
  截图脚本刻意等它消失后再拍，稳定态不含它（若要单独看，节流网络即可复现）
- 空 / 无权限 → **不属于本渲染层**：正文为空由上游消息流决定，权限是服务端投影，
  本组件只渲染拿到的 `text`，不做空态/权限判断（见下方待确认第 4 条）

## 我替 UC 做了哪些它没写明的设计决定（请逐条确认）

1. **图类型识别的来源**：web 不能 import `apps/api` 的 `detectDiagramType` 正则（单源纪律）。
   我在 `apps/web/lib/mermaid-diagram-type.ts` 写了一个**最小**识别：取围栏正文首个非空
   token，拿 `@repo/contracts` 的 `MermaidDiagramType` 枚举（12 种，唯一白名单源）校验。
   额外加了两个别名（`graph`→flowchart、`statediagram-v2`→stateDiagram）。
   **决定点**：别名表是我加的，UC 没说。若产品认为"只认规范枚举名、不认 mermaid 语法别名"，
   删掉别名即可；若要更丰富的识别，应下沉进 web+api 共享包，不在两处各写一份。
2. **越界 / 语法错都落同一个错误盒**，文案区分（"不支持的图类型：X" vs "语法错误"），
   并**回显原始围栏源**。这是"诚实错误态，不静默丢弃"的具体形态——UC 只说要诚实，
   具体长相是我定的。
3. **安全**：markdown 走 `rehype-sanitize`（剥 raw HTML/script/on*/javascript:），
   mermaid 走 `securityLevel:'strict'`。UC 未提 XSS，我按"AI/人类输入不可信"默认收紧。
4. **本层不做空态/权限态**：`MarkdownMessage` 只渲染传入的 `text`。空正文、无权限属于
   上游消息流与服务端权限的职责，不在此组件。请确认这个边界划分符合预期。
5. **排版档位**：H1→text-16 / H2→text-14 / H3→text-13、正文 text-13、表格 text-12、
   码 text-11 —— 全部取自 `lib/font-scale.ts` 既有档位（**没有** text-15，故 H1 用 16）。
   气泡底色沿用既有 `bg-ai-tint/40`，与现有 AI 气泡一致。

## R8 线索之间的矛盾 & 处理

- R8 既要"富文本可读"又要"结构化图形化"，两者在同一条消息里可能**交替出现**
  （文字段 + 图 + 文字段）。我用 `extractMermaidBlocks`（fabric-markdown 的 DOM-free
  抽取器，唯一实现）按 [start,end) 把正文切成交替序列，逐段渲染，避免"整条要么纯文
  要么纯图"的二选一。
- fabric-markdown 的抽取器还会认 `persona/canvas/usecase` 围栏；VZ-01 只处理 `mermaid`，
  其余围栏**留给 markdown 当普通代码块**渲染，不吞掉。

## 建议签核时重点核对的 3 处

1. **error 屏**：两个错误盒的文案 + 回显是否达到"诚实、可自查"的标准（这是 VZ-01
   与旧原型"happy path 零异常态"的关键差别）。
2. **图类型别名表**（决定点 1）：是否接受 `graph`/`statediagram-v2` 这两个 mermaid 语法别名，
   还是只认契约枚举规范名。
3. **markdown 屏的信息密度**：表格 text-12、正文 text-13 在真实体量下是否够读、与既有
   气泡字号档位是否一致（评分卡第 10 项"风格孤岛"）。
