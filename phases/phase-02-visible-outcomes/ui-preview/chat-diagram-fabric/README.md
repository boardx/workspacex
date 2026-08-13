# chat-diagram-fabric（VZ-02）UI 预览 · 截图索引

聊天内 ```mermaid 图从 VZ-01 的**静态 SVG** 换成 **fabric.js 渲染**，并支持
**最大化 / 编辑 / 保存**。纯前端 mock，不接后端。

预览页：`/preview/chat-diagram-fabric?scene=fabric|error`
（真实组件：`AiMessage → MarkdownMessage → ChatDiagramFabric → ChatDiagramCanvasModal(复用 CanvasStage)`）

## 每屏每态对应哪个 UC 的哪节
| 截图 | 界面态 | 对应 |
| --- | --- | --- |
| `VZ-02-bubble-default.png` | 气泡内 fabric 只读渲染 | 用户诉求「必须用 fabricjs 渲染」；VZ-01 R8 图渲染线索 |
| `VZ-02-modal-editable.png` | 最大化 → 全屏**可编辑**画布（默认） | 用户诉求「必须可以最大化」+「可编辑」 |
| `VZ-02-modal-after-edit.png` | 编辑后（＋节点，未保存 → 显示「有未保存的改动」）| 用户诉求「修改渲染以后的内容」 |
| `VZ-02-modal-saved.png` | 保存后（「已保存」+ 右栏显示将落 canvas artifact 的 mermaid 源）| 用户诉求「可以保存下来」 |
| `VZ-02-error-box.png` | 非法/越界 mermaid → 诚实错误框（无破损画布，页面不崩）| VZ-01 R8 诚实错误态，原样沿用 |

七态映射（本 feature 天然只涉及其中几态，其余不适用）：
- **默认**：`VZ-02-bubble-default` / `VZ-02-modal-editable`
- **加载**：`chat-diagram-loading`（校验+渲染中；截图为渲染完成态，加载态短暂）
- **成功**：`VZ-02-modal-saved`（编辑落盘回环）
- **校验失败**：`VZ-02-error-box`（越界图类型 + 语法错，两个错误框）
- 空 / 依赖失败 / 无权限：本 feature 不适用（图渲染是纯客户端、无数据依赖、无角色分叉；
  权限视角在承载它的聊天/画布壳层，不在单张图这一层）。

## data-testid（verification 锚点）
- `chat-diagram-fabric`（气泡内只读 fabric 容器，带 `data-ready`）· `chat-diagram-fabric-surface`（canvas）
- `chat-diagram-maximize`（最大化按钮）
- `chat-diagram-canvas-modal`（全屏可编辑覆盖层）
- `chat-diagram-tool-select|node|edge|delete`（工具条：选择/＋节点/连线/删除，见决定 ③）· `chat-diagram-zoom-fit` · `chat-diagram-close`
- `chat-diagram-save`（保存）· `chat-diagram-saved`（已保存态）· `chat-diagram-saved-source`（将落盘的 mermaid 源）· `chat-diagram-dirty`（未保存提示）
- `chat-ai-mermaid-error`（诚实错误框，**沿用 VZ-01**，结构/文案不变）

## 我替 UC 做了哪些没写明的设计决定（人类逐条看）
1. **气泡内只读、编辑走最大化**——UC 只说「可编辑」，未说气泡内是否可直接编辑。选择只读以避免误拖。
2. **保存目标 = canvas artifact**，且原型只 mock 持久化（展示会落盘的 mermaid 源）。真实接线见 design-note。
3. **最小工具条只给 选择/＋节点/删除**——CanvasStage 还支持 便签/连线/源码，未全暴露。
4. **「先判后挂」架构**：先 `mermaid.parse` 校验、通过才挂 fabric canvas——为规避 fabric+React 的
   `removeChild` 崩页（实测栽过，详见 design-note A/B 节）。非纯 UI 取舍，但直接决定了错误态的可靠性。

## R8 线索间的矛盾及处理
- VZ-01 既有原型是「静态 SVG、happy-path」；用户诉求要「fabric 可编辑可保存」。二者对**同一张气泡内图**
  给了不同渲染方式 → 本次以用户 devapp 实测诉求为准，把渲染换成 fabric，但**错误态契约（白名单闸门 +
  诚实错误框 + 回显原文 + 不崩）逐字沿用 VZ-01**，不另起一套。

## 建议束级 design-signoff.md 第 ① 件签核时重点核对 3 处
1. **四个设计问题 main agent 已定**（2026-08-12 人类授权）：保存语义=派生 canvas artifact、气泡内只读、
   工具条加连线、`<` 保存边界解转义——逐条与理由见 `SIGNOFF-INCREMENT-fabric-canvas.md`。人类可驳回任一条。
2. **round-trip 保真**：saved 截图右栏源已是 `D1{"< 18 个月?"}`（解回，落盘那份正确）;**画布内显示**仍 `&lt;`
   （markdownToCanvas 转义，纯视觉残留，待 fabric-markdown 包级修复）——核对这条「存对、显示待修」的边界。
3. **错误态是否真的不崩**：核对 `VZ-02-error-box.png` —— 两个错误框都在、且**没有**残留破损画布，
   整条消息其余 markdown 正常（这正是 VZ-01 零异常态缺陷的补齐点）。

## 复现
预热并起在 3198 端口（首个路由编译约 30–40s，离线环境 google 字体拉取会告警但不影响）：
```
cd apps/web && NEXT_DIST_DIR=.next-dbg npx next dev -p 3198
# 浏览 /preview/chat-diagram-fabric?scene=fabric  和  ?scene=error
```
取证脚本：`apps/web/e2e/vz-fabric-shots.spec.ts`（对已预热 server 跑 `playwright.vzfabric.config.ts`）。
