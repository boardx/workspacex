---
status: pending                # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: templates
scope: getBlueprintDesignFacets-read-endpoint
confirmed_by: null
confirmed_at: null
---

# templates 束 delta —— 蓝本读路径缺口（新增 `getBlueprintDesignFacets`）

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的
`contracts/templates/design-signoff.md`（2026-07-30，covers F17-F30 + F174/F175/F177/F179/F181）。
本文件的 `status` 变更归人类所有——**agent 不得改**（ADR-023）。

提出：2026-08-15（dev-project）。起因：BP-06（蓝本设计器 `/tpl/designer` 真实接线）动手前
发现设计器页面需要「读一个蓝本已填的设计环节内容」，而契约里**没有任何操作能做这件事**——
只有写端点（`updateDesignFacet`）和聚合读（`listBlueprints.out.completeness` 只给计数）。
这与 BP-03 实测发现的 T13（`setDurationTier.expectedVersion` 无读路径）是同一个根因的两处
表现，本 delta 一次性解决两者。

---

## 变更：`getBlueprintDesignFacets` —— 新增读端点

**形状与字段依据见同目录 `contract.md`；可执行验收见 `verification.md`。**

```ts
getBlueprintDesignFacets: {
  method: "GET",
  path: "/blueprints/:blueprintId/design-facets",
  in: z.object({ blueprintId: z.string() }).strict(),
  out: z.object({
    revision: z.string(),
    designFacets: z.array(
      z.object({
        designFacetKey: z.string(),
        content: z.string(),
        itemRevision: z.string(),
      }).strict(),
    ),
  }).strict(),
  err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
}
```

## 为什么这次是新端点，不是像 T14（复制蓝本）那样只登记不处理

`copyBlueprint` 缺失（T14）有替代路径（`createBlueprint(origin=copy)` 已实现且真库测试覆盖），
所以只登记、不着急补。**本次没有替代路径**——蓝本设计器和 BP-03 的前端接线两处都是
**结构性卡死**，不补这个端点，两块工作都无法真正让用户在界面上走通（track P 的 P1/P2/P3
会一直停在 🟡「后端有前端接不上」）。

## 影响范围核对（三条件，供签核时核对，不是我在自行认定已满足）

1. **是否新增设计面**：是——这是一个全新 operation，不属于「零新增设计面」的自追加范围
   （不同于 F175/F174/F177/F179/F181 那五次 covers 自追加），因此**没有**由 agent 自行加进
   `covers:`，走的是本 delta 独立签核，符合 `contract-design.md` 的既定流程。
2. **是否影响已签核的读写形状**：否——三个已签核操作（`updateDesignFacet`/`setDurationTier`/
   `listBlueprints`）字段与错误码一字未动。
3. **是否需要新表/新迁移**：否——`revision`/`item_revision`/`content` 三列均已存在
   （分别来自 BP-03/F177、BP-02/F174 的既有迁移），本端点是纯读，不改存储结构。

## 采纳后的后续工作（本 delta 只批契约面，不含实现）

- 仓储 + 控制器实现（真库测试见 `verification.md`）——这部分工作量与 BP-01/BP-02 的读端点
  实现相当（复用同一批 SELECT 语句，无需新查询逻辑，`readDesignFacets` 内部方法已存在，
  只是没有暴露成 HTTP 路由）。
- BP-06：`/tpl/designer` 消费该端点，替换页面当前硬编码 `BLUEPRINT[0]` 的写法，接上真实
  blueprintId 路由参数。
- BP-03 遗留：前端换档位交互接上 `revision` 作为 `expectedVersion`，`KNOWN_CONTRACT_GAPS.T13`
  可从「缺口」状态改为「已解决」（届时需要人类在 `templates.ts` 里把 T13 的措辞更新或移除，
  这也是 agent 不该自行做的事——注释里逐字写着「不是本 feature 能单方补的」）。
