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
| `src` + `tests` 树摘要 | `sha256:e99b8d83c38746df6d252a60622e16bee928106bc80819aab586f9285223a74d`（2026-08-22 回流后，见下方「上游回流记录」；并入当时的原始值 `sha256:55199e79f433bdbc0ee50c479631589edfd28fb1516b58e354fac6a29fa67f99` 留痕） |

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
| `src/**`（除 `templates-entry.ts`）、`tests/**` | 2026-08-22 起有一处真实改动 | 见下方「上游回流记录」；222 个单测一个未改（改动不影响既有测试覆盖，新增覆盖在 `apps/web` 那一侧） |

## 上游回流记录

| 日期 | 文件 | 改了什么 / 为什么 |
|---|---|---|
| 2026-08-22 | `src/fabric-objects.ts` | 人类要求"review 可视化的连线的问题"后实测发现：`FlowEdge` 被选中时没有任何贴着线本身的视觉反馈——只有 Fabric 默认的 `hasBorders` 给的一个轴对齐外接矩形，密集图上很难看出选中的到底是哪条线（对弯曲边/mindmap S 曲线尤其明显，`setEndpoints` 给弯曲边留的 padding 本来就比直线宽松）。改法：`lineColor()`（`_render` 主描边 + `renderMarker` 箭头/marker 共用同一个方法）在这条边是 canvas 当前 active object 时换成 `SELECTED_EDGE_STROKE`（同 `NODE_STROKE` 一个色号，选中语言跨节点/边统一），`_render` 的 `ctx.lineWidth` 同时加粗到 1.6 倍——描边色 + 线宽两个信号一起变，不依赖用户去找那个松散的外接矩形。上游 222 个单测 + 本仓 `apps/web/tests/ui/canvas-stage-edge-editability.test.tsx` 新增回归全绿，已用 stash 反证过（回退这处改动后新增测试确实会红）。⚠ 第一版直接调用 `this.canvas?.getActiveObject()` 撞出一个真实回归——`getActiveObject` 只在交互式 `Canvas`/`SelectableCanvas` 上有，`apps/api/tests/canvas/coords-not-written-back.test.ts` 这类服务端/无头渲染路径用的是不带这个方法的 `StaticCanvas`，直接调用会在异步渲染帧里抛 `getActiveObject is not a function`（`pnpm --filter api exec vitest run tests/canvas` 从 0 errors 变成 6 errors，测试本身仍全绿但有未处理异常，靠这个信号抓出来的，不是靠读代码猜到的）。改成新增的 `isSelected()` 私有方法做鸭子类型判断（`typeof c?.getActiveObject === 'function'`），两条渲染路径都安全。 |

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
