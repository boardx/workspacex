---
phase: "19"
covers_bundles: [board-fabric-surface]
status: confirmed
confirmed_by: "shenyanbin"
confirmed_at: "2026-09-25T09:16:28Z"
confirmed_via: "用户在 Codex 会话明确回复：确认 Phase 19 S01 设计签核和一致性复核，继续开发；在获知签核状态是唯一信任根后再次回复：我批准"
---

# Phase 19 阶段一致性复核

> 当前复核范围只有第一轮 `board-fabric-surface`。后续五个能力束加入时必须扩展
> `covers_bundles` 并重新做人类复核；本文件不能被解释为提前确认未出现的束。

## 复核范围

| 束 | feature | 核心不变量 | 主要交叉边界 |
|---|---|---|---|
| `board-fabric-surface` | BV01 BV02 BV03 | Yjs canonical、Fabric 增量 projection、object id 单源、echo suppression、DOM a11y mirror | whiteboard metadata、phase-01 canvas/DiagramModel、未来 storage/collaboration/AI/import |

## XC-01 · Board 身份与事实源只有一套

- [ ] `packages/contracts/src/whiteboard.ts` 的 `BoardId`/role 继续作为 metadata 与 ACL 单源；
  renderer 不复制第二套 Board identity 或 role enum。
- [ ] `Y.Map key == BoardObject.id == Fabric data.boardObjectId == DOM mirror key`。
- [ ] Fabric JSON 不进入 PG、blob/file content、Yjs update、checkpoint、backup、API 或 export canonical payload。

## XC-02 · Fabric 与既有 Canvas/Diagram 能力的边界

- [ ] Phase 01 `packages/fabric-markdown` 的 `DiagramModel` 只用于 Chat/Mermaid/模板的导入边界。
- [ ] 导入时转换为同一组 Board commands；之后只编辑 Board/Yjs，不双写 DiagramModel，也不重新布局覆盖用户点击时看到的坐标。
- [ ] ADR-100 的“坐标不写回 Mermaid”继续成立；Board 的世界坐标保存在 Board canonical model，viewport 仍是本地状态。

## XC-03 · 人、AI、导入器与 API 最终共用 command

- [ ] S01 只先交付人类 Fabric gesture adapter，但 command 归 `whiteboard-core` 而不是 `apps/web` 私有类型。
- [ ] 后续 AI proposal、Chat 插入、Miro/Mural import 和 public API adapter 只能调用同一 command/transaction 入口，不能各自直接写 Yjs map 或 Fabric object。
- [ ] renderer event 不直接成为公开 API；公开 API 需要独立 zod envelope、ACL、幂等与审计设计。

## XC-04 · 数据落点与恢复

- [ ] PG 只保留 metadata、ACL、索引、版本/内容指针和审计引用；Board/Yjs 内容与媒体由后续 file/blob 束负责。
- [ ] 本束 context lost 从 Y.Doc 重建 Fabric；后续灾备从版本化 Board/Yjs 文件恢复，二者都不能把 Fabric snapshot 当捷径。
- [ ] 单对象 adapter fault 与对象存储/协作依赖失败有不同粒度：前者隔离一个对象，后者禁止假成功并保留可恢复状态。

## XC-05 · 可访问性不是第二份对象模型

- [ ] React DOM mirror 读取同一 canonical projection 与 selection store，操作发送同一 Board command。
- [ ] mirror 可以有展示字段和焦点状态，但不能另存对象内容、顺序或权限事实。
- [ ] Canvas 不可见、context recovering 或低性能模式下，mirror 仍需保留核心阅读/选择路径且服从同一 ACL。

## XC-06 · 迁移与验收不能把 preview 当生产

- [ ] `/preview/board-fabric-v01` 只用于设计签核，明确是本地 mock、未接 Yjs/服务端。
- [ ] S01 的完成证据必须来自正式 `/studio/board/:boardId`：真实 Fabric registry、双浏览器 viewport、1000 patch、ACL、context lost、七态与 DOM mirror。
- [ ] 旧 DOM/SVG renderer 可在开发期开只读对照，但不能持久化独立状态；迁移通过后从正式路由删除。

## 待人类裁决

1. 是否接受 BV01–BV03 先冻结 renderer/protocol 边界，再由后续对象、协作、AI、storage 束扩展同一 command。
2. 七态与完整 accessibility 材料是否必须在首次签核前全部补齐；本文件建议“必须”，避免 happy-path 原型被误当实现契约。
3. S01 是否需要公开 Board operation HTTP API；本文件建议“不需要”，只保留 metadata HTTP + Yjs collaboration protocol，公开 API 放到后续专束签核。
4. 正式迁移是否允许短期双 renderer 对照；若允许，必须限定为同一 Y.Doc 的投影且正式用户只看到 Fabric。

## 人类确认动作

先确认 `contracts/board-fabric-surface/design-signoff.md` 的 ① UI、② 用例、③ API/协议契约，
再逐项确认 XC-01～XC-06 与四个待裁决问题。只有人类可以修改本文件 frontmatter 的签核字段；
当前状态必须保持 `pending`。
