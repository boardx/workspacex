# VENDOR.md —— `fabric-markdown` 的并入基线

> 决策与理由见 **`docs/adr/ADR-100-fabric-markdown.md`**。本文件只记录**基线事实**，
> 让下一次上游回流有个可比对的起点。它是 ADR 决策五的落点。

## 基线

| 项 | 值 |
|---|---|
| 上游名称 / 版本 | `fabric-markdown` `v0.1.0` |
| 上游位置 | 本机 `~/Documents/projects/fabric-markdown`（**非 git 仓库，无 commit 可引**——这是本基线最薄的一环） |
| 并入日期 | 2026-07-30 |
| 并入内容 | `src/**`、`tests/**`（**逐字**，未改一行） |
| 未并入 | `demo/`、`dist/`、`vite.config.ts`、`package-lock.json`、`BACKLOG.md`、`node_modules/` |
| `src` + `tests` 树摘要 | `sha256:8f88262831bb4097079847de7b09d8622c7058e91a871c6366e2de37cae7c2dc`（合入 main 后，同时含 issue #2576（本 PR）与 issue #2575（并行落 main 的另一处改动）两处改动，见下方「上游回流记录」；此前的值依次留痕——issue #2576 单独改动后的值 `sha256:425b3417963c8cc59c73a79e9c06ff364a089c5ea9619fa05466ec85331cdf03`、issue #2575 单独改动后的值 `sha256:66f941734a4c2e5220307a211016a8ebc8008117d095e1828cc25e0bebeeb5ba`、2026-08-30 第三次回流后 `sha256:accef751e0515cda896c49262069d5782e492b30af708ca4da753c05e2e33be3`（2026-09-02 改动后未曾更新过本行，属既有缺口）、同日第二次回流的值 `sha256:7a5ae1ad8c6b7371c79cfe252c0fa120504eb0622b72d56a703e03e78cf1c2af`、第一次回流的值 `sha256:0e2350d6996acb0b842d81f3d491619765cf4eadbdc8ba788838ad9be22f5f06`、2026-08-22 回流后的值 `sha256:3d54b8c9057e93a3386b0417228263654c0c90d2bf9af4d51bd9bac1aaf3a2c4`、并入当时的原始值 `sha256:55199e79f433bdbc0ee50c479631589edfd28fb1516b58e354fac6a29fa67f99`） |

树摘要的复算方式（在上游目录里跑，结果应与上表一致）：

```bash
find src tests -type f | sort | xargs shasum -a 256 | shasum -a 256
```

上游没有 git 历史，所以「上游改了什么」只能靠这个摘要发现**是否改过**，
发现不了**改了哪里**。若上游后续进 git，请把这一行换成 commit hash。

## 本仓相对上游的改动清单（**完整**，改这里的同时必须改本节）

| 文件 | 性质 | 说明 |
|---|---|---|
| `package.json` | 新增 | `@repo/fabric-markdown`，workspace 私有包。`fabric` / `mermaid` 由 caret 改为**确切版本**（ADR-100 决策二） |
| `tsconfig.json` | 新增 | 沿用上游 compilerOptions，去掉 `demo` 与 `fabric-markdown` 自指 path 别名 |
| `vitest.config.ts` | 新增 | 从上游 `vite.config.ts` 里只取 `test` 段（jsdom + `tests/**`），不带 lib 打包配置 |
| `src/templates-entry.ts` | 新增 | **纯 Node 入口**：只激活 19 个 A0 模板，不触碰 `fabric` / `mermaid`（ADR-100 决策三） |
| `UPSTREAM-README.md` | 新增（重命名） | 上游 `README.md` 原文，改名以免与本仓文档混淆 |
| `VISUAL-SPEC.md` | 原样 | 上游同名文件 |
| `src/**`（除 `templates-entry.ts`）、`tests/**` | 2026-08-21～08-22 起有两处真实改动 | 见下方「上游回流记录」；222 个单测一个未改（改动不影响既有测试覆盖，新增覆盖在 `apps/web` 那一侧） |

## 上游回流记录

| 日期 | 文件 | 改了什么 / 为什么 |
|---|---|---|
| 2026-08-21 | `src/interactions/mindmap-editor.ts` | `addChildOf`（Tab/Enter 加子节点/兄弟节点共用）加新连边时，此前用 `sendObjectToBack` 把新边甩到整个 canvas 对象栈的**绝对最前面**——不只是排到所有节点前面（视觉上"在节点下方"，这是原意图），还排到了所有**既有边**前面。`extractModel` 按 `canvas.getObjects()` 迭代顺序建 `model.edges`，`buildTree`（`diagrams/mindmap.ts`）按这个顺序给每个父节点的子节点数组追加成员，`layoutMindmap` 再按子节点数组顺序给叶子分配 `leafIndex`（越靠前 y 越小、越靠上）——于是新增的子节点/兄弟节点永远排到最上面，不是追加到最下面（人类实测反馈）。改法：新边改插到**已有边簇的末尾**（`canvas.insertAt`，紧跟最后一条既有边、仍在所有节点之前）而不是整个栈的最前面——既保住"连线在节点下方"的原意图，又保住"新连线追加在已有连线之后"的正确顺序。上游 222 个单测 + 本仓 `apps/web/tests/ui/canvas-stage-mindmap-keyboard.test.tsx` 新增的两条排序回归全绿，已用 stash 反证过（回退这处改动后新增的两条测试确实会红）。 |
| 2026-08-22 | `src/fabric-objects.ts` | 人类要求"review 可视化的连线的问题"后实测发现：`FlowEdge` 被选中时没有任何贴着线本身的视觉反馈——只有 Fabric 默认的 `hasBorders` 给的一个轴对齐外接矩形，密集图上很难看出选中的到底是哪条线（对弯曲边/mindmap S 曲线尤其明显，`setEndpoints` 给弯曲边留的 padding 本来就比直线宽松）。改法：`lineColor()`（`_render` 主描边 + `renderMarker` 箭头/marker 共用同一个方法）在这条边是 canvas 当前 active object 时换成 `SELECTED_EDGE_STROKE`（同 `NODE_STROKE` 一个色号，选中语言跨节点/边统一），`_render` 的 `ctx.lineWidth` 同时加粗到 1.6 倍——描边色 + 线宽两个信号一起变，不依赖用户去找那个松散的外接矩形。上游 222 个单测 + 本仓 `apps/web/tests/ui/canvas-stage-edge-editability.test.tsx` 新增回归全绿，已用 stash 反证过（回退这处改动后新增测试确实会红）。⚠ 第一版直接调用 `this.canvas?.getActiveObject()` 撞出一个真实回归——`getActiveObject` 只在交互式 `Canvas`/`SelectableCanvas` 上有，`apps/api/tests/canvas/coords-not-written-back.test.ts` 这类服务端/无头渲染路径用的是不带这个方法的 `StaticCanvas`，直接调用会在异步渲染帧里抛 `getActiveObject is not a function`（`pnpm --filter api exec vitest run tests/canvas` 从 0 errors 变成 6 errors，测试本身仍全绿但有未处理异常，靠这个信号抓出来的，不是靠读代码猜到的）。改成新增的 `isSelected()` 私有方法做鸭子类型判断（`typeof c?.getActiveObject === 'function'`），两条渲染路径都安全。 |
| 2026-08-30 | `src/fabric-objects.ts` | issue #2373，人类实测反馈：流程图里一条跨度很大的"回边"（循环/往返关系）画出的弧线夸张地绕到画布很远的一侧，途经一堆无关节点。根因：`FlowEdge._render` 算控制点法向偏移量（bow）的公式 `Math.max(len * k, 14)` 只有下限没有上限——边越长偏移量线性放大，长回边（`dominant < -20` 时 `k` 再乘 1.8）能被推到边长的三分之一左右。改法：加一个 `MAX_BOW = 60` 常量，公式改成 `Math.min(Math.max(len * k, 14), MAX_BOW)`——短边仍保留 14px 的下限（用来区分重叠/近平行连线的原始设计意图不受影响），长回边不再无上限放大。上游 224 个单测 + 本仓 `apps/web/tests/lib/canvas-flowedge-bow-cap.test.ts` 新增回归全绿，已反证过（stash 掉这处改动后，长回边用例测出的 bow 从 60 变回 338.5，短边用例不受影响）。 |
| 2026-08-30（同日第二次） | `src/diagrams/template-engine.ts` | issue #2372，人类实测反馈（截图对比）：拖拽式模板编辑器里配好的分区位置/列数/贴纸颜色，chat 模拟与真实 chat 渲染出来完全对不上——根因在 apps/web 侧（`buildAutoTemplateSpec` 把每个分区降维成 5 个字段，`layout` 半路被丢），但即使 apps/web 侧接对了数据源，**vendor 的 `TemplateSpec` 本身也接不住"每个分区各自的列数/颜色"**：`sticky`（贴纸网格 w/h/perRow）此前是 spec 级单一配置、所有分区共用同一份；贴纸颜色只能靠贴纸文本自带的 `#name` 标签逐条手写，没有"分区默认色"这个概念。改法：`TemplateSection` 新增两个可选字段——`sticky?: Partial<{w,h,perRow}>`（逐分区覆盖，缺的字段落回 spec 级默认，`buildTemplateModel` 里 `{...sticky, ...sec.sticky}` 合并）、`stickyColor?: string`（分区默认贴纸色，单张贴纸的 `#name` 标签仍然优先于它）。两个字段都是 `?:` 可选，不设置的既有模板逐字节保持原样。上游 224 个单测 + 本仓 `apps/web/tests/lib/explicit-template-layout.test.ts` 新增覆盖（`buildExplicitTemplateSpec` 按 `layout.cols`/`layout.tone` 产出这两个新字段）全绿；另外用一段独立 tsx 脚本直接跑 `registerTemplate`→`templateToModel` 端到端验证过，三个分区各自的 `stickyColor` 精确落到对应贴纸的 `data.color` 上（不是近似色，是逐字节那个 hex）。 |
| 2026-08-30（同日第三次） | `src/fabric-objects.ts` | issue #2383（#2372 的直接后续），人类实测截图反馈：上一条改动放开分区各自的贴纸颜色后，每张贴纸卡片仍然套着一层固定的琥珀色描边（`STICKY_STROKE='#f59e0b'`，`theme.ts`）——那是原先只有单一默认黄色贴纸时校准出来的颜色，现在跟蓝/绿/粉这些非黄色底色放在一起会显得突兀、像一层不该有的边框，而不是修饰。人类原话「渲染的 fabricjs 便利贴，不要 border」。改法：贴纸卡片（`makeStickyCard` 里的 `Rect`）去掉 `stroke`/`strokeWidth`，只留 `fill`——贴纸变成无边框的实色卡片，任何底色下都干净。`STICKY_STROKE` 常量仍留在 `theme.ts`（公开导出，没有别处在用它，但删导出属于更大的公开面改动，本次不动），只是 `fabric-objects.ts` 不再 import/使用它。上游 224 个单测 + 本仓新增 `apps/web/tests/lib/canvas-sticky-borderless.test.ts`（真实 `StaticCanvas` + 真实渲染管线，读贴纸 `FlowNode`（Group）里那个底层 `Rect` 的 `stroke`/`strokeWidth`）+ api canvas 432 个测试全绿；新增测试已反证过（stash 掉这处改动后测出 `stroke='#f59e0b'`/`strokeWidth=1`，断言失败，符合改动前的真实状态）。 |
| 2026-09-02 | `src/diagrams/template-engine.ts`、`src/fabric-objects.ts` | 人类实测截图（chat 里渲染的用户画像）：表头字段「姓名」的长值压过右边的「性别:」标签、最右一格「职位」的值画出表头框外（"文字跳出了区域"）。两个根因，各改一处：① `buildTemplateModel` 的表头字段几何此前对每个字段留死 `LABEL_W(96) + 6 + VALUE_W(150)`，不看格宽——组织模板把 9 个字段换成每行 6 个（格宽 ≈253px）时，值框比格子宽 23px，必然压进下一格；改成按 `cellW = hr.w / perRow` 反算：`LABEL_W = min(96, max(48, 0.4·cellW))`、`VALUE_W = min(150, cellW − 24 − LABEL_W − 6 − 12)`，格宽 ≥ 288 的内置模板（persona 恒 288）算出来仍是 96/150，几何逐字节不变（`tests/template-header-fields.test.ts` 钉死）；同时字段值节点带 `data.wrap = 'grapheme'` 与 `data.fitHeight = 行距 − 6`。② `FlowNode` 的 `text` 形状此前不换行（中文没有空格，fabric 默认按"单词"换行，整句当一个词一行画到底）、也不缩字号；现在按 `data.wrap === 'grapheme'` 开 `splitByGrapheme`、按 `data.fitHeight` 走贴纸同款 `shrinkTextboxToFit`（下限 7px，与贴纸一致），`setLabel` 编辑后同样重新适配。两个开关都是 opt-in，图表标题/坐标轴标签等其它 `text` 节点行为不变。上游 225 个单测 + 新增 `tests/template-header-fields.test.ts`（纯几何）+ 本仓 `apps/web/tests/lib/canvas-header-field-fit.test.ts`（真实 `StaticCanvas` 渲染，jsdom 里 node-canvas 解析不了 `FONT_FAMILY` 导致度量恒为 0，测试内换成确定性度量模型）全绿。配套的 apps/web 侧改动（表头带长高时正文分区整体下移，`explicit-template-layout.ts` / `auto-template-layout.ts`）不在 vendor 内。 |
| 2026-09-03 | `src/diagrams/template-engine.ts` | issue #2576，人类反馈：chat 里生成「三视角模型」画布只画出三个分区框和标题条，正文完全空白、无任何渲染。根因：`canvas-template-guidance.ts` 要求模型的 `## 分区名` 与模板分区名逐字一致，但三视角这类模板的 canonical 分区名是「中文 English」双语形式（如「人本期望 Desirability」），模型偶尔只写中文核心部分、丢掉英文后缀（如只写 `## 人本期望`）；`normalizeSectionKey`（#2549/#2551 加的近义词/标点兜底）只去空格与标点，不剥英文，两侧永远对不上，`lookupSectionItems` 静默 fallback 成空数组，`buildTemplateModel` 于是只画分区框、不画任何贴纸——正是截图症状。改法：新增 `stripBilingualSuffix`，只剥「末尾连续」的纯 ASCII token 再比较（剥完为空或没剥掉则原样返回，保证 golden-circle 这类纯英文分区名 WHY/HOW/WHAT 不被误剥空、不会互相碰撞），`lookupSectionItems` 在精确匹配、近义词兜底之后再加这一级双语核心名兜底。上游 236 个单测（新增 `tests/templates-story.test.ts` 两条：中文核心名命中三视角三个分区 + 纯英文分区不受影响）全绿；已用 stash 反证过（回退这处改动后新增的「中文核心名命中」测试确实会红，`expected [] to have a length of 1 but got +0`）。 |

| 2026-09-03 | `src/diagrams/templates-story.ts`、`src/diagrams/template-engine.ts` | issue #2575，人类实测截图反馈：chat 里生成「故事板」画布，① 表头「故事主角/故事主题」这条带子比下方 3×2 分区网格外接框宽 28px（`headerRect` 原为 `x:820 w:1520` → 左右边界 60/1580，网格实际边界 73/1565），视觉上表头两端都探出网格外，像没对齐；② 6 个分区都没设 `stickyColor`、`sectionColors` 本就是"deliberately unused"的占位（`template-engine.ts` 注释原话），AI 生成的便签文本也不带 `#name` 颜色标签（`canvas-template-guidance.ts` 的 system prompt 不提颜色），于是全部落回 `STICKY_FILL` 默认黄——与后台管理面板预览（`TONE_COLORS`，`tone=i%4` 黄/粉/绿/蓝循环）不一致。改法：① `headerRect` 改为 `x:819 w:1492`，精确贴合网格外接框（73..1565）；② `templates-story.ts` 6 个分区各加 `stickyColor`，用引擎已导出的 `STICKY_COLORS`（贴纸颜色菜单同一份色板，不新开一份颜色事实）按 黄/粉/绿/蓝/黄/粉 循环——与后台 tone 序列语义一致，同时移除不再需要的 `sectionColors: [0,0,0,0,0,0]`；③ `template-engine.ts` 的 `serializeTemplate` 原先只把"非黄色"判成需要 `#name` 回写标签，只适用于"全局唯一默认色=黄"的旧世界——分区有了自己的默认色后，一个从未被手动改色、色号等于**所在分区**默认色的贴纸会被错误地回写出一个多余的 `#pink` 之类标签（`tests/roundtrip-guard.test.ts` 的 storyboard 用例抓到，round-trip 不再恒等）。改成按贴纸所在分区各自的默认色（`sec.stickyColor ?? STICKY_FILL`）比较，而不是硬编码"黄色即默认"。只改 `storyboard` 一个模板的布局数据 + 一处序列化判断，不涉及 19 个 key。上游 224 个单测（`pnpm --filter @repo/fabric-markdown exec vitest run`）+ `pnpm --filter api exec vitest run tests/canvas` 全绿。 |

## 回流规程

1. 在上游目录复算树摘要，与上表比对；不同 ⇒ 有改动。
2. `diff -ru <上游>/src packages/fabric-markdown/src`（`templates-entry.ts` 是本仓独有，忽略它）。
3. 按文件挑，**不整目录覆盖**——整目录覆盖会抹掉本表列出的本仓改动。
4. 挑完必须跑：
   ```bash
   pnpm --filter @repo/fabric-markdown exec vitest run          # 上游 222 个单测
   pnpm --filter api exec vitest run tests/canvas               # 本仓 key/displayName 契约
   ```
5. **任何改动 19 个 `key` 的上游提交一律拒收**（ADR-100 决策四 / 契约 I-1 I-36）。
   若上游确有改名需求，本仓保留旧 key 作为注册别名，注册表对外仍只暴露旧 key。
6. 改完回来更新本文件的树摘要与改动清单——**没更新 = 下一次回流没有基线**。
