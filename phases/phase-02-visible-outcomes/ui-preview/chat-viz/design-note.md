# VZ-01 设计说明 —— AI 气泡内 markdown + ```mermaid 渲染

> ADR-023 签核第 ① 件（UI）支撑材料。给 coord / 人类评审看"怎么做的、为什么、
> 单源纪律怎么守的"。截图与状态清单见同目录 `README.md`。

## 1. 目标与边界

- **要补什么**：现有 chat AI 气泡把正文当纯文本渲染（`<p>{msg.text}</p>`），
  markdown 语法与 ```mermaid 图都原样显示星号/围栏。VZ-01 把这一行换成真正的
  markdown + 图渲染。属于 R8 里的**原型待补**（气泡在、正文渲染没接线）。
- **纯客户端**：渲染的是 `msg.text: string`（后端将下发的 markdown 源），不接后端、
  不引后端逻辑。签核后由 requirement-author 把 testid 锚进 feature_list 的 verification。
- **唯一改的现网行 line**：`apps/web/components/chat/ai-message.tsx` 里
  `<p className="text-13 text-card-foreground">{msg.text}</p>` → `<MarkdownMessage text={msg.text} />`。
  消息头/工具调用链/引用列表**不动**。

## 2. 依赖新增（coord 审批点）

| 包 | 版本 | 用途 | 为什么是它 |
| --- | --- | --- | --- |
| `react-markdown` | ^9 | markdown → React 元素 | React 生态事实标准；不 `dangerouslySetInnerHTML` 整段，按 AST 出元素，插件化 |
| `remark-gfm` | ^4 | GFM 扩展 | 表格 / 删除线 / 任务列表 / 自动链接——R8 的"富文本"要表格 |
| `rehype-sanitize` | ^6 | HTML 清洗 | **安全刚需**：markdown 来自 AI/人类，未清洗则 `<script>`、`on*`、`javascript:` 链接可注入。挂在 rehype 阶段，默认白名单剥危险节点/属性 |
| `mermaid` | 11.16.0 | 图 → SVG | 已在仓内（fabric-markdown 的依赖），**pin 同版本**避免双版本。web 原先无直接依赖，本次显式加为 web 直接依赖（否则 `import "mermaid"` 在 web 解析不到、tsc 报 TS2307） |

**为什么必须 sanitize**（写给评审）：react-markdown v9 默认**不**渲染 raw HTML（安全），
但一旦有人加了 `rehype-raw` 或 markdown 里的自动链接带 `javascript:`，就有 XSS 面。
`rehype-sanitize` 是"默认拒绝"的一道闸，成本极低，先加上。mermaid 侧另用
`securityLevel: 'strict'`（禁 HTML label、禁点击跳转脚本）。

## 3. 组件结构

```
ai-message.tsx
  └─ MarkdownMessage (client)            components/chat/markdown-message.tsx
       ├─ 用 extractMermaidBlocks 把 text 切成 [md 段 | mermaid 段] 交替序列
       ├─ md 段  → <ReactMarkdown remarkPlugins=[gfm] rehypePlugins=[sanitize]>
       └─ mermaid 段 → MermaidDiagram (client)   components/chat/mermaid-diagram.tsx
            ├─ resolveDiagramType(code)  ← lib/mermaid-diagram-type.ts
            ├─ 在白名单 → dynamic import mermaid → parse+render → 内联 SVG
            └─ 越界 / parse 抛错 → 诚实错误盒 + 回显原文
```

- **切段用既有实现**：`extractMermaidBlocks`（`@repo/fabric-markdown/markdown`，DOM-free）
  是仓内唯一的围栏抽取器，**不另写一份**。它返回每个围栏的 `{code, lang, start, end}`，
  据此把整段 text 切开，图前后的 markdown 各自正常渲染（支持"文字—图—文字"交替）。
- **mermaid 动态 import**：重依赖 + 仅客户端可用，`await import("mermaid")` 放进 effect，
  SSR 不触碰。渲染中显示 `chat-ai-mermaid-loading`。

## 4. 白名单门 + 错误态（单源纪律的关键点）

- **白名单唯一源** = `@repo/contracts` 的 `MermaidDiagramType`（zod enum，12 种，web 可 import）。
  `lib/mermaid-diagram-type.ts` 取围栏正文**首个非空 token**，拿这个枚举校验：
  - 命中 → `mermaid.parse` 通过后 `mermaid.render` 出 SVG；
  - **不命中** → 错误盒 `data-error-reason="whitelist"`，文案"不支持的图类型：X"，回显原文；
  - 命中但 `parse/render` 抛错（语法错） → 错误盒 `data-error-reason="syntax"`，回显原文。
  三条出口都不静默丢弃、不崩整条消息。
- **⚠ 不复制 api 的 `detectDiagramType` 正则**：api 侧的"首行→类型"正则住在
  `apps/api/src/domain/canvas/mermaid-whitelist.ts`，web **不能** import apps/api，
  也**没有**把那份正则抄进 web。web 只做"首 token + 枚举校验"这一最小推断——**枚举本身
  就是白名单单源**。若将来需要更丰富的识别（别名、参数解析、与 api 完全一致的判定），
  正确做法是把识别逻辑**下沉进一个 web 与 api 共享的包**，而不是在 web 再写第二份正则。
  这一点已在代码注释里写死，避免后人手滑复制。
- **别名**（我加的，非 UC 要求）：`graph`→flowchart、`statediagram-v2`→stateDiagram。
  这是 mermaid 语法名与契约枚举名的最小对齐；是否保留请 coord 定（README 决定点 1）。

## 5. 设计 token / 排版

- 全部走既有 token：字号取 `lib/font-scale.ts` 档位（H1=text-16、H2=text-14、H3/正文=text-13、
  表格=text-12、码=text-11；**无 text-15 档位**故 H1 用 16），色彩走 `globals.css` CSS 变量
  （card-foreground / muted / border-subtle / primary / destructive）。markdown 排版类写在
  `globals.css` 的 `@layer base` 里的 `.chat-markdown` 作用域，**无裸数值**。
- `pnpm --filter web lint:design` 通过（token / 字号 / MD 残留 / testid 命名 全绿）。

### 一处 lint 交互值得记一笔
markdown 源天然含 `**加粗**`，若把样本内联进 `.ts` mock 会被 `lint-design.sh` 的
「MD 残留」规则误报（该规则只扫 `.ts/.tsx`，专拦 JSX 文本里手滑的 `**`）。
处理：把三段 markdown 源放进真·`.md` 文件（`apps/web/lib/mock/chat-viz-md/*.md`），
server component 用 fs 读入。既让 lint 规则继续保护 JSX、**不给它开洞**，又让 markdown
源以最自然的形态存放。

## 6. 与既有设计语言的一致性

- 气泡容器、头部（AI 角标 / agent·角色 / skill / 思考摘要 / 时间 / 角标）、工具调用链、
  引用列表**全部保留**，只换正文渲染。
- AI 在场方式仍是"线程里的同事"（气泡形态不变），未另起一套。
- 视角/权限：VZ-01 是纯渲染层，不涉及 R5 多角色；权限是服务端投影，本层不做。

## 7. 自检结果

- `pnpm --filter web exec tsc --noEmit` → exit 0（无 web 报错）。
- `pnpm --filter web lint:design` → 全部通过。
- dev server 起得来，三 scene 均 HTTP 200，Playwright 探测**零 console error**：
  - markdown：`chat-ai-markdown`×1，无图；
  - mermaid：`chat-ai-markdown`×1 + `chat-ai-mermaid`×1（SVG）；
  - error：`chat-ai-markdown`×1 + `chat-ai-mermaid-error`×2（whitelist + syntax），无 loading 残留、不崩。
- 每个可交互/关键展示元素带 testid：`chat-ai-markdown` / `chat-ai-mermaid` /
  `chat-ai-mermaid-error`（带 `data-error-reason`）/ `chat-ai-mermaid-loading` /
  场景切换 `chat-viz-scene-*`。

## 8. 变更清单

新增：
- `apps/web/components/chat/markdown-message.tsx`
- `apps/web/components/chat/mermaid-diagram.tsx`
- `apps/web/lib/mermaid-diagram-type.ts`
- `apps/web/lib/mock/chat-viz.ts` + `apps/web/lib/mock/chat-viz-md/{markdown,flowchart,error}.md`
- `apps/web/app/preview/chat-viz/page.tsx`
- `apps/web/scripts/shot-chat-viz.mjs`
- `phases/phase-02-visible-outcomes/ui-preview/chat-viz/`（本目录：3 张截图 + README + 本文件）

改动：
- `apps/web/components/chat/ai-message.tsx`（正文 `<p>` → `<MarkdownMessage>`）
- `apps/web/app/globals.css`（新增 `.chat-markdown` 排版，全 token）
- `apps/web/package.json`（+react-markdown/remark-gfm/rehype-sanitize/mermaid）

**未触碰**：任何 `apps/api/**`、任何 `packages/contracts/**`、任何 `requirements/**`、
任何 `design-signoff.md` 的 status。
