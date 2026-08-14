# canvas-template-gallery · UI 预览 · 截图索引

「新建画布 → 选模板」入口原型（ADR-003 UI 先行 · ADR-023 签核第 ① 件材料）。

把 `packages/fabric-markdown` 里**已迁移就绪**的 19 个工作坊模板 +（思维导图 / 空白）两个起点，
投影成一个可点、可预览的**画廊**；选中后交给**真实** `CanvasStage`（fabric + mermaid 引擎）渲染，
证明「选了模板 → 画布真的从那个模板起手」这条链路在原型里是通的。**纯前端 mock，不接后端。**

预览页：`/preview/canvas-template-gallery?state=<态>&as=<角色>`
真实组件链：`CanvasTemplateGallery`（新增）→ 选中 → `starterMarkdownFor(key)` → `CanvasStage`（复用真实画布本体）

## 每屏每态对应哪个界面态
| 截图 | 界面态 | 说明 |
| --- | --- | --- |
| `CTG-gallery-default.png` | **默认** | 模态打开，21 个起点按「用户研究 / 战略分析 / 叙事沟通 / 从空白起手」四类分组 |
| `CTG-gallery-loading.png` | **加载** | 画廊 skeleton（`data-testid="loading"`），模板注册表加载中 |
| `CTG-gallery-empty.png` | **空** | 搜索/筛选无结果（`data-testid="empty"`），引导清除筛选或从空白开始 |
| `CTG-gallery-invalid.png` | **校验失败** | 「空白快建」未起名 → 结构化错误（`role="alert"` + `data-testid="err-name"`）|
| `CTG-gallery-dep-failed.png` | **依赖失败** | 模板引擎（fabric-markdown）初始化失败 → 诚实错误框（`data-testid="dep-failed"`）+ 重试 |
| `CTG-gallery-denied.png` | **无权限** | 观察者视角无法新建画布（`data-testid="denied"`）；切到其它三视角即可创建 |
| `CTG-success-persona-canvas.png` | **成功** | 选中「用户画像」→ 真实 CanvasStage 渲染 persona 模板（含拟真示例内容）|

## 交互补充（同属「成功」链路的其它起点）
| 截图 | 说明 |
| --- | --- |
| `CTG-gallery-filter-user.png` | 分类过滤到「用户研究」，只留该类卡片 |
| `CTG-success-journey-canvas.png` | 选「用户旅程图」→ 真实画布起手（拟真旅程便签）|
| `CTG-success-mindmap-canvas.png` | 选「思维导图」起点 → 真实 mindmap 渲染（演示 Tab/Enter 编辑的落点）|

七态映射：默认=default · 加载=loading · 空=empty · 校验失败=invalid(err-name) · 依赖失败=dep-failed · 无权限=denied(观察者) · 成功=success(saved + canvas-tpl-started)。

## data-testid（verification 锚点）
- `canvas-tpl-gallery`（画廊根）· `canvas-tpl-state-<态>` / `canvas-tpl-role-<角色>`（预览切换器）
- `canvas-tpl-card-<key>`（21 个起点卡片，key = persona/empathy/jtbd/journey-map/value-proposition/adlib/hmw/pestel/swot/bmc/mvp/three-horizons/ai-strategy/ai-bmc/freytag/burger/golden-circle/three-lenses/storyboard/mindmap/blank）
- `canvas-tpl-search` · `canvas-tpl-filter-all|user|strategy|story|blank` · `canvas-tpl-section-<cat>`
- `canvas-tpl-seeded-toggle`（示例内容开关）· `canvas-tpl-close` · `canvas-tpl-clear-filter` · `canvas-tpl-retry`
- `canvas-tpl-name` + `err-name` + `canvas-tpl-quick-create`（空白快建校验）
- **成功链路**：`canvas-tpl-started`（起手标题条）· `canvas-tpl-back`（换模板）· 复用 `canvas-stage` / `canvas-fabric-surface`（真实画布）
- 保留态名：`loading` / `empty` / `dep-failed` / `denied` / `saved`（七态门控锚点，见 `lib/ui-state.ts`）

## 我替产品做了哪些没写明的设计决定（人类逐条看，见 design-note.md）
1. **交互形态选「模态」**——新建画布是聚焦短暂动作，与既有 `template-apply-dialog` 一致。
2. **入口落点 = 项目画布页「新建画布」**（现状永远从硬编码「谁在买储能」示例起手，这里换成「可选起点」）。
3. **分类四组**（用户研究 / 战略分析 / 叙事沟通 / 从空白起手）——注册表本身没有分类字段，这是新加的展示层归类。
4. **缩略图用单字形 emoji 占位**，不渲染完整画布缩略图（成本/收益取舍，见 design-note）。
5. **「示例内容」开关**：默认开，让签核既能看拟真信息密度、也能看空框；只有 persona / journey-map 备了拟真种子。
6. **卡片标题显示注册表 `title` 的中文头**；纯拉丁词开头的（HMW/PESTEL/SWOT/MVP/AI…）回退为完整双语标题——已知的轻微不一致，见 design-note「已知局限」。

## 建议束级 design-signoff.md 第 ① 件签核时重点核对 3 处
1. **入口落点与交互形态**：模态是否合适？入口是否应从项目画布页触发（而非独立页/侧栏）——这决定后续接线位置。
2. **分类与文案**：四类归属、每张卡的一句话 blurb 是否准确（这些是原型新造的展示事实，不在任何契约里，最需人拍板）。
3. **成功态链路是否可信**：`CTG-success-*` 三张确实是**真实 CanvasStage** 渲染出的模板框架（persona 表头+便签、journey 阶段、mindmap 树），不是截的静态图——这条「选模板→真起手」是本原型的核心主张。

## 复现
预热 dev server（首个路由编译约 20s，离线环境 google 字体告警不影响）：
```
cd apps/web && NEXT_DIST_DIR=.next-tplgallery npx next dev -p 3221
# 浏览 /preview/canvas-template-gallery?state=default 并逐个切 state / as
```
取证：对已预热 server 跑 `E2E_BASE_URL=http://localhost:3221 npx playwright test -c playwright.tplgallery.config.ts`。
