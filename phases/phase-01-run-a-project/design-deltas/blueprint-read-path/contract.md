# 蓝本读路径缺口 contract delta（#991 / BP-06 前置）

本文件描述**契约面的一处变更**。`design-signoff.md` 是签核件，本文件是它的依据材料。

---

## 背景：两个已登记但一直没补的读路径缺口，同一个根因

`packages/contracts/src/templates.ts` 的 `KNOWN_CONTRACT_GAPS` 已经记了两条相关缺口：

- **T13**（BP-03/F177 实测发现）：`setDurationTier.in.expectedVersion` 要求调用方传，但没有
  任何操作把它读出来——`listBlueprints.out` 不含蓝本级并发令牌，也没有 `getBlueprint`。
- 同类问题在 BP-06（蓝本设计器接线）尝试接线时**再次撞上**，而且更严重：`/tpl/designer` 要
  显示「这个蓝本哪些设计环节已经填了、填的是什么」，但契约里**连读一个蓝本已填内容的操作都没有**
  ——`updateDesignFacet` 是纯写端点（`PUT /blueprints/:id/design-facets/:key`），
  `listBlueprints.out.completeness` 只给聚合计数 `{done, denominator}`，不给逐项内容。

**两处都是「写端点齐全、读端点缺失」的同一个根因**：BP-01/BP-02/BP-03 三轮实现只顾着接写路径
（因为那是可以直接测出「东西存进去了」的部分），读路径被签核时漏掉了。

## 变更：新增 `getBlueprintDesignFacets`

```ts
getBlueprintDesignFacets: {
  method: "GET",
  path: "/blueprints/:blueprintId/design-facets",
  in: z.object({ blueprintId: z.string() }).strict(),
  out: z.object({
    /** 蓝本级并发令牌——解决 T13：setDurationTier/setFormatAndLanguage/setModelStrategy/
     *  setQuotaPolicy 的 expectedVersion 都从这里读，不用各自再造一个读端点。 */
    revision: z.string(),
    designFacets: z.array(
      z.object({
        designFacetKey: z.string(),
        content: z.string(),
        /** 逐项并发令牌，updateDesignFacet 的 expectedItemRevision 用这个（哨兵 '' 表示未填） */
        itemRevision: z.string(),
      }).strict(),
    ),
  }).strict(),
  err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
}
```

### 字段命名的依据（不是新造，是对齐既有三处）

| 字段 | 依据 |
|---|---|
| `revision` | 与 `blueprints.revision`（BP-03/F177 迁移已加的行级 CAS 列）同名，不另造第二个名字指同一件事 |
| `designFacetKey` / `content` / `itemRevision` | 逐字对齐 `updateDesignFacet.in`/`out`（BP-02/F174 已签核落地的写端点），读写用同一套字段名，不产生「写时叫 X、读时叫 Y」的错位 |

### 为什么不是两个端点（一个给 CAS 令牌、一个给内容）

`setDurationTier` 与 `updateDesignFacet` 都发生在设计器同一屏——调用方（设计器页面）打开时
必然同时需要「当前填了什么」与「当前版本号是多少」两样东西。拆成两次请求会让「页面首次加载」
产生一次不必要的竞态窗口（两次响应之间蓝本被并发修改，页面拿到的 revision 和 designFacets
不是同一个时间点的快照）。合成一个端点、仓储层用同一个 `SELECT ... FOR UPDATE`（或至少同一个
读事务）取，天然是一致快照。

### 范围边界

- **不新增错误码**——三个错误码全部是既有码的复用（`BLUEPRINT_NOT_FOUND`/`ROLE_INSUFFICIENT`
  已在 `updateDesignFacet.err` 里；`DEPENDENCY_UNAVAILABLE` 是本束权限判定服务不可用时的既定用法）。
- **不改任何已签核操作的形状**——`updateDesignFacet`/`setDurationTier`/`listBlueprints` 一字不动，
  纯新增。
- **不解决 T3/T5/T7 等其它已登记缺口**（哪些设计环节 required=true、可选/必留判据、已试跑判据）
  ——那些是各自 D-2/D-8/D-6 的裁决范畴，与本 delta 的「读路径缺失」是不同性质的问题。
