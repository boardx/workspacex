# 蓝本读路径缺口 delta —— 可执行验收

采纳后，实现方需要满足：

## 真库测试（新增，参考 `apps/api/tests/templates/create-blueprint-persistence.test.ts` 既有约定）

1. **空蓝本读取**：刚建好、零设计环节已填的蓝本 → `designFacets` 为空数组，`revision` 非空字符串。
2. **填了若干项后读取**：与 `updateDesignFacet` 写入的内容逐项一致（key/content/itemRevision 三者都对得上写入时返回的值）。
3. **revision 随行级写操作滚动**：`setDurationTier`（BP-03，已实现）成功写入后，再次读取 `getBlueprintDesignFacets`，`revision` 与写之前不同。
4. **单条 `updateDesignFacet` 不影响 `revision`**：`updateDesignFacet` 只滚动它自己的 `itemRevision`，不动蓝本级 `revision`（两个令牌独立，见 contract.md「为什么合成一个端点」一节的前提——它们服务不同粒度的并发控制，合并读取不等于合并语义）。
5. **蓝本不存在**：`BLUEPRINT_NOT_FOUND`。
6. **权限**：非组织成员 → `ROLE_INSUFFICIENT`（复用既有 `requireCapabilityAdmin`/`requireOrgMember` 判定，读操作用哪一档跟随实现方裁决，需在 PR 里写清楚为什么）。
7. **反证**：并发对同一蓝本两条不同 key 各写一次，读回的 `designFacets` 两条都在、`itemRevision` 互不相同（同 F174 已有的「revision 不共享」反证同款套路）。

## 前端消费方（BP-06 designer wiring 落地时补，不在本 delta 范围）

- `/tpl/designer` 用 `revision` 作为后续 `setDurationTier` 调用的 `expectedVersion`。
- `/tpl/designer` 用每项 `itemRevision` 作为对应 `updateDesignFacet` 调用的 `expectedItemRevision`。

## typecheck

`pnpm --filter @repo/contracts run typecheck` + `pnpm --filter api run typecheck` 全绿。
