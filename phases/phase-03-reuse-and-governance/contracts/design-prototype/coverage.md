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

## 二、API → UC

| 契约面 | 要它的 UC |
|---|---|
| `designPrototype.PrototypeNode` / `PrototypeScreen` / `DesignPrototypeWriteback` | V10 V11 V13 |
| `designPrototype.PROTOTYPE_SCHEMA_GUIDE` | V10（模型能按闭集输出的前提） |
| `DesignProject.prototype`（+ `superRefine`） | V10 V11 V12 |
| `DesignChatWriteback.prototype` / `DesignWritebackField = "prototype"` | V10 V13 |

没有任何契约面找不到 UC；没有任何 V 找不到契约面。本束**不新增路由**。

## 三、验证命令（本 PR 已跑绿）

```
pnpm --filter @repo/contracts exec vitest run tests/design-prototype.test.ts tests/design-workbench.test.ts
pnpm --filter api exec vitest run tests/design-workbench            # 需要 PG（本会话无 Docker：用去 globalSetup 的临时配置跑了纯逻辑四文件）
pnpm --filter web exec vitest run tests/ui/design-loop.test.tsx tests/ui/design-doc-markdown.test.ts
pnpm --filter web lint && pnpm --filter web typecheck && pnpm --filter api lint
node .harness/scripts/lint-ui-material.mjs
```
