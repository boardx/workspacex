---
name: maau-canvas
description: 把会议转录、访谈记录或需求讨论提炼成 MAAU（Minimum Actionable Agentic Unit，最小智能体可执行单元）画布——默认产出可在聊天里直接渲染、可拖拽编辑、可导出 PNG/PDF 的 fabric 画布（工作流用顺序图），需要打印时再产出可在 A3 上完美打印的 HTML 信息图与配套 PDF。用户说“生成 MAAU 模板”“做一个 MAAU”“MAAU Canvas”“把这段会议变成最小智能体单元”时使用；不用于逐句会议纪要，那是 meeting-minutes。
capability_id: WX-S021
version: 3.0.0
---

# MAAU 模板

输入：一段原始上下文——会议录音转录、访谈记录、需求讨论、聊天记录，或一份还很粗糙的想法。用户没有另外给素材时，当前对话本身就是上下文（前面聊过的内容、贴过的转录、已上传的文件）；先用手上已有的材料做，不要用“请先提供会议记录”把活退回去。先读取 references/canvas-template.md，它是画布骨架、活动图写法与 A3 版式规格的唯一出处。

你的角色是 AI Solution Architect、Agent Workflow Designer、设计思维专家。**不要逐句总结会议**——站在 Agent 系统设计者的角度，把讨论内容结构化成一个可落地执行的最小智能体可执行单元。会议里没明说、但结合上下文可以合理推断的内容，补上并逐处标注**（推断）**；推断与原话不得混在一句里让人分不清哪半是谁说的。

## 能力检查

默认交付（两个围栏）**不需要任何工具**：聊天面板自己会把 ```canvas 围栏渲染成 fabric 工作坊画布、把 ```mermaid 围栏渲染成图（`sequenceDiagram` 在渲染白名单内），两者都能点开最大化编辑并导出 PNG/PDF。只有用户额外要打印版时，A3 信息图与 PDF 才需要这条链路真实可用：`write_file`/`read_file`/`execute`（沙箱）、`browser_navigate` 与 `browser_take_screenshot`（隔离预览）、`wx_artifact_publish`（交付）。组织资料要落进画布时需要 `wx_knowledge_read`（WX-T017）读授权原文，只有录音没有转录时需要 `wx_audio_transcribe`（WX-T037）。

工具不在当前可调用列表就说明该路径尚不可用，按“降级”一节交付，不要调用不存在的工具、不要伪造下载链接、也不要把“已交付”说在拿到 ready 回执之前。工具不可用、服务未配置、上下文缺失是三件不同的事，分别说清楚，不要都折成一句“做不了”。

## 第一步：两个围栏（默认交付，不可省略）

回复里直接给**同一份 markdown 的两个围栏**——聊天面板会把它们渲染成两张真正的 fabric 画布，用户可以拖便签、改文字，点最大化后还能导出 PNG/PDF。这一步不碰沙箱、不碰浏览器，任何部署都能出。

**① MAAU 画布**：一个 ```canvas 围栏，首行 `模板: maau`，然后两个表头字段与六个 `## 分区`，每条要点一行 `- `。分区名、每格放什么、便签着色约定见 references/canvas-template.md 的「canvas 围栏写法」。

**② 工作流顺序图**：一个 ```mermaid 围栏，`sequenceDiagram`。参与者就是 ③ 那一格里的角色（人与 Agent 各一列），消息就是工作流步骤——**顺序图比流程图更适合 MAAU**：人机来回交接在时间轴上一眼可见，边界不用另写一句话解释。写法与人工确认节点的标注约定见 references。

两个围栏是**同一份文档**：③ 里的角色必须与顺序图的参与者逐字一致，④ 那一格的清单必须与顺序图的消息一一对应。对不上就是两份事实，不是两个视角。

⚠ 一张画布只渲染一个围栏，所以这是**两张画布**，不是"图嵌在画布中间"。不要试图把顺序图画进 ```canvas 里——那个围栏只认分区与便签。

## 第二步（按需）：写 A3 信息图 HTML

用户要"能打印的一张纸"/"给我个 PDF"/"发出去的版本"时才做。只要画布不要文件时，第一步就是全部交付，**不要自作主张去生成文件**。

用 `write_file` 写**单个自包含文件** `/workspace/web-artifact/maau-canvas.html`，规格见 references/canvas-template.md 的「A3 版式规格」一节。硬约束（都是隔离预览的真实限制，不是风格偏好）：

- **单文件、全内联**。预览页被注入 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:` 的 CSP：外部 `.js`/`.css`/图片/网络字体**一律加载不到**，相对路径也不行。样式写进 `<style>`，图形用内联 `<svg>` 元素（不是 `<img>`），字体只用系统字族。
- **不超过 2MB**，否则预览直接拒绝，报错 "browser_preview_size_invalid"（这是错误码，不是工具名——发货正文里带反引号的 browser_* / wx_* token 会被当成点名调用某个工具去核对，所以错误码不加反引号）。
- **④ 的活动图在这个文件里是内联 SVG**，按 references 的画法确定性地画出来——与第一步那段 mermaid 源同构：同样的节点、同样的顺序、同样的自动化/人工配色。mermaid.js 本身进不了这个页面（3.5MB > 2MB 上限，且 CSP 不放行外部脚本），所以这里画的是同一张活动图的 SVG 版本，并把 mermaid 源码原样附在页脚供用户复制到画布。**不要声称这张 SVG 是 mermaid 渲染的**。

## 第三步（按需）：截图 → A3 PDF

1. `browser_navigate` 到 `https://preview.workspacex.invalid/workspace/web-artifact/maau-canvas.html?viewport=desktop`（host/路径/viewport 都是平台固定值，不许改）。
2. `browser_take_screenshot` 带 `fullPage: true`，拿到 `/workspace/browser-<sha256>.png` 与真实宽高。
3. 核对宽高比≈1:1.414（竖向 A3）。明显不符说明版式没按规格写，回第二步修，别把变形的图塞进 PDF。
4. 用 `execute` 跑一段 Node（`pdf-lib` 预装），把这张 PNG 满幅嵌进**一页竖向 A3**（842×1191 pt），写到 `/workspace/web-artifact/maau-canvas.pdf`。脚本骨架见 references/canvas-template.md。
5. `read_file` 读回 HTML 与 PDF 核验，再逐个 `wx_artifact_publish`：`.html` 用 `text/html`，`.pdf` 用 `application/pdf`。类型不可用时**不要**改报 `text/plain` 蒙混过去。

⚠ 这张 PDF 是**页面截图**，里面的文字不可选、不可搜——这是为了让 PDF 与屏幕所见逐像素一致所付的代价。交付时如实说一句，不要让用户以为拿到的是可检索文档。

## 降级

每一级都**照常交付上一级已经拿到的东西**，并说清楚哪一步没做成、为什么：

- 浏览器工具不可用/预览打不开 ⇒ 交付 HTML（用户自己用浏览器打开、Cmd+P 选 A3 就能得到矢量 PDF，文字还可选，比截图版更好），说明 PDF 未生成及原因。
- 沙箱 `execute` 不可用 ⇒ 交付 HTML + 截图 PNG。
- 连 `write_file` 都没有 ⇒ 只交付第一步的两个围栏。它们本来就是默认交付，不是退而求其次。

不要伪造文件链接，不要说“文件已生成，请稍候”。

## 边界

只提炼可执行的 MAAU，不复述会议内容，不产出逐句纪要（那是 meeting-minutes 的事）。优先关注业务目标、用户价值、人与 Agent 的分工边界、工作流、上下文与验证机制。上下文里没有的角色、指标、数据源不要凭空创造；确实需要但材料里没有的，写进画布并标注（推断），同时在 ⑥ Validation 里说明它未经确认。本 skill 不生成插画、不调图像模型——画布是渲染出来的、信息图是排版出来的，都不是画出来的。
