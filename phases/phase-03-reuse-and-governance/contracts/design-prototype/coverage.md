# 契约束 `design-prototype` — 支撑材料：UC 覆盖证明

> 覆盖 feature：**B5.3**（派生视图；权威是 `design-signoff.md` frontmatter `covers:`）。
> 验收线索 V10–V15 来自 [usecases.md](./usecases.md)。

## 一、UC → API

| V | 一句话 | API 操作 / 契约面 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V10 | 合法 `prototype` ⇒ frames + prototype 原子写回，画布渲染树 | `designWorkbench.appendProjectChat`（`DesignChatWriteback.prototype`；`DesignProject.prototype`） | `design-detail-phone-tree` / `design-detail-chat-applied` | ✅ |
| V11 | 切页看对应树 | `DesignProject.prototype[i]` ↔ `frames[i]` | `design-detail-frame-{i}` → `design-detail-phone-tree` | ✅ |
| V12 | 只改标签 ⇒ 树清空 | `DesignProjectPatch.frames`（仓储 CASE） | `design-detail-phone-placeholder` | ✅ |
| V13 | 超限/非法 ⇒ 字段级拒绝 | `PrototypeScreen.refine` / `parseWriteback` | 「已更新」不含原型画布 | ✅ |
| V14 | 生成中提示；失败退固定回执 | `appendProjectChat`（`reply.source`） | `design-detail-generating` / `design-detail-turn-fallback` | ✅ |
| V15 | 导出设计文档 | 无接口（客户端 `lib/design-doc-markdown.ts`） | `design-detail-export-doc` | ✅ |
| V24 | 对话质量（迭代 9） | `DesignChatReply.suggestions` / `DesignChatSuggestion` / `DESIGN_WORKBENCH_STARTERS` | `design-detail-starters` / `design-detail-suggestions` | ✅ |
| V23 | 导出升级 + 交互说明（迭代 8） | `DesignChatReply.suggestions` / `DesignChatSuggestion` / `DESIGN_WORKBENCH_STARTERS` | V24 |
| `PrototypeScreen.notes` / `DesignProject.frameNotes` / `PrototypeVersionSummary.notes`（导出无接口） | `design-detail-export-*` / `design-detail-notes` | ✅ |
| V22 | 生成体验（迭代 7） | `coercePrototypeRaw` / `parseWritebackDetailed` / 修复轮（无契约变化） | `design-detail-elapsed` / `design-detail-cancel` / `design-detail-retry` | ✅ |
| V21 | 原语扩充 + 设备（迭代 6） | `PrototypeNodeType`（21）/ `isPrototypeContainer` / `PROTOTYPE_SCHEMA_GUIDE` | `[data-proto=hero|grid|stat|…]` / `[data-device]` | ✅ |
| V20 | 直接编辑（迭代 5） | `patchPrototype` / `PROTOTYPE_PATCH_REJECTED` | `design-inspector-*` | ✅ |
| V19 | 画板视图（迭代 4） | 无接口（纯前端 `prototype-board.tsx`） | `design-detail-board` / `design-detail-view-*` / `design-detail-zoom-*` | ✅ |
| V18 | 版本历史（迭代 3） | `listPrototypeVersions` / `getPrototypeVersion` / `restorePrototypeVersion` | `design-detail-history-toggle` / `design-history-*` / `design-detail-preview-banner` | ✅ |
| V17 | 画布选中态 + focusNodeId（迭代 2） | `appendProjectChat.in.focusNodeId` / `findPrototypeNodePath` / `prototypeNodeLabel` | `design-detail-focus` / `design-detail-focus-clear` / `[data-node-id]` | ✅ |
| V16 | patch 局部改（迭代 1） | `DesignChatWriteback.patch` / `applyPrototypePatch` / `ensurePrototypeIds` | `design-detail-phone-tree` / `design-detail-chat-applied` | ✅ |

## 二、API → UC

| 契约面 | 要它的 UC |
|---|---|
| `designPrototype.PrototypeNode` / `PrototypeScreen` / `DesignPrototypeWriteback` | V10 V11 V13 |
| `designPrototype.PROTOTYPE_SCHEMA_GUIDE` | V10（模型能按闭集输出的前提） |
| `DesignProject.prototype`（+ `superRefine`） | V10 V11 V12 |
| `DesignChatWriteback.prototype` / `DesignWritebackField = "prototype"` | V10 V13 |
| `PrototypeNodeId` / `PrototypePatchOp` / `DesignPrototypePatch` / `PROTOTYPE_PATCH_GUIDE` | V16 |
| `appendProjectChat.in.focusNodeId` / `findPrototypeNodePath` / `prototypeNodeLabel` | V17 |
| `patchPrototype` / `PROTOTYPE_PATCH_REJECTED` / `PrototypePatchRejectReason` / `PROTOTYPE_FIELDS` / `PROTOTYPE_PROPS_SCHEMAS` | V20 |
| `PrototypeScreen.notes` / `DesignProject.frameNotes` / `PrototypeVersionSummary.notes` | V23 |
| `PrototypeVersion(Summary)` / `listPrototypeVersions` / `getPrototypeVersion` / `restorePrototypeVersion` / `VERSION_NOT_FOUND` | V18 |

没有任何契约面找不到 UC；没有任何 V 找不到契约面。迭代 3 起本束新增三条路由（版本历史），都挂在 `/pm-designs/:projectId/versions` 下。

## 三、验证命令（本 PR 已跑绿）

```
pnpm --filter @repo/contracts exec vitest run tests/design-prototype.test.ts tests/design-workbench.test.ts
pnpm --filter api exec vitest run tests/design-workbench            # 需要 PG（本会话无 Docker：用去 globalSetup 的临时配置跑了纯逻辑四文件）
pnpm --filter web exec vitest run tests/ui/design-loop.test.tsx tests/ui/design-doc-markdown.test.ts
pnpm --filter web lint && pnpm --filter web typecheck && pnpm --filter api lint
node .harness/scripts/lint-ui-material.mjs
```
