---
name: mod-fabric-canvas
description: >
  WorkspaceX 产品白板 Fabric.js 开发知识库：canonical Yjs/core 到 Fabric 投影、
  坐标与输入、对象变换、绘图擦除、协作事务及真实浏览器验收。修改
  apps/web/components/whiteboard/fabric 或白板交互时使用；Mermaid 文本转换使用 mod-canvas-diagram。
---

# Fabric Canvas 产品白板 — 模块知识库

## 一句话定位

维护产品白板的可丢弃 Fabric 渲染投影和交互桥，不把 Fabric JSON 当持久化文档。
本入口是经验目录；schema、算法、设计签核和交付状态仍以原有权威文件为准。

## 代码地图

- 交互编排：`apps/web/components/whiteboard/collaborative-thinking-editor.tsx`
- 渲染入口：`apps/web/components/whiteboard/fabric/board-fabric-surface.tsx`
- 纯投影：`apps/web/components/whiteboard/whiteboard-fabric-projection.ts`
- 文档/命令/历史：`packages/whiteboard-core/src/document.ts`、`packages/whiteboard-core/src/command-port.ts`、`packages/whiteboard-core/src/undo.ts`
- 权威契约：`packages/contracts/src/whiteboard-document.ts`、`packages/whiteboard-core/src/content-object-model.ts`
- 实时入口：`apps/web/components/whiteboard/live-board.tsx`、`apps/web/lib/whiteboard-provider.ts`

## 按任务加载

| 任务 | 阅读 |
|---|---|
| 生命周期、身份、增量更新、canonical 边界 | [架构](references/architecture.md) |
| wheel/pinch/pan、坐标、变换、控制点/菜单/连接线、单次创建 | [输入与投影](references/input-and-projection.md) |
| Pen/Marker/Pencil/Highlighter、压力、擦除、cache | [绘图](references/drawing.md) |
| 图片/文件、权限、异步竞争、撤销和同步 | [资产与协作](references/assets-and-collaboration.md) |
| debug、像素证据、浏览器/CI、完成边界 | [验收](references/verification.md) |
| 事故、来源、回流格式 | [经验](references/pitfalls.md) |

## 关键契约与不变量

- Fabric 是投影。交互提交经过 core command port；预览、视口、菜单位置不直接写 Yjs。
- 四类坐标不能混用：client/CSS canvas、world、对象局部/绘图 intrinsic、bitmap/DPR。
  换算使用既有 helper，不复制数学实现。
- 一次手势提交一个命令批次；取消/拒绝还原最新 canonical，不恢复过时快照。
- 只读、锁定、远端删除及异步完成竞争都要在实际提交处处理；UI disabled 不是权限证明。
- 旧 `packages/fabric-markdown` 的 Mermaid 不变量与协作快照不适用于本产品白板。
  改其转换链时另读 [mod-canvas-diagram](../mod-canvas-diagram/SKILL.md)。
- Connector 路径手柄、粗细和标签位置的实现/验收状态按候选树与 exact-SHA 证据判断；
  旧计划的「仅设计」和另一分支的「已实现」都不能证明当前运行环境已交付。

## 关联文档

- `phases/phase-19-board-visual-workspace/requirements/03-structure-connectors.md`
- 新体验设计/验收入口：[Connector #4878](https://github.com/boardx/workspacex/issues/4878)。
- 本轮交互修复与状态证据：[R1 #4858](https://github.com/boardx/workspacex/issues/4858)、
  [R2 #4859](https://github.com/boardx/workspacex/issues/4859)、
  [R3 #4860](https://github.com/boardx/workspacex/issues/4860)、
  [文件 #4861](https://github.com/boardx/workspacex/issues/4861)。
- 文件资产改动同时读 [mod-asset-artifact](../mod-asset-artifact/SKILL.md)。

## 模块 SOP

1. 读取当前 feature/issue、scoped 指令和对应 reference，确认目标运行路径不是 preview 组件。
2. 先定位 canonical → adapter → registry → Fabric event → command 的断点，再定义反例测试。
3. 在独占文件范围实现；读当前 schema/helper，避免第二份颜色、字号、几何或权限定义。
4. 以单测、真实指针/像素、API/刷新/第二浏览器分层验证；覆盖取消与失败路径。
5. 在 PR 附真实证据和缺口，依原有 harness 门控交付，不自行标 passing。

## 踩坑与经验

2026-10-01 本地源码审计沉淀见 [pitfalls](references/pitfalls.md)。这不是 merged/CI 全绿声明。
references 中 helper/测试/验收脚本按对应 issue 和当前 git 树确认，不一概视作未合入分支。
正式 native 验收导航见 [验收执行入口](references/verification.md#formal-native-acceptance)。
源码存在或启动门通过不证明业务已验收；缺失时不凭文档重建第二套算法。
技能任务来源：[issue #4880](https://github.com/boardx/workspacex/issues/4880)。
十轮证据账见 [候选与缺口审计](../../../docs/design/fabric-board-evidence-audit.md)；
它记录证据范围，不代替业务 feature 状态、GitHub 当前检查或 main 祖先关系。

## 技能验证

从仓库根运行 `node .agents/skills/mod-fabric-canvas/scripts/validate-links.mjs`，
以及 `node --test .agents/skills/mod-fabric-canvas/scripts/validate-links.test.mjs`。
链接可读只证明导航有效，不证明业务行为、PR 检查或合并完成。

## 知识回流规则

沿用模块模板：谁实施/复核谁回流，同一 PR 或紧随小 PR 追加真实经验。
历史结论被反证时保留并标明替代条目；结构调整走 review。
经验包含「日期、现象、原因、修正入口、反例测试、证据、验证范围」；格式见 pitfalls。
未验证推断明确标注，不把设计需求、测试数量或临时目录存在当动态交付事实。
