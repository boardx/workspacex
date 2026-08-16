# 蓝本设计器 16 项面板内容 delta —— 可执行验收

本 delta 是设计材料，不含实现，因此这里的"验收"分两层：**签核本身的核对清单**（人类
签核时用）与**采纳后未来实现时的验收方向**（供后续 feature 参考，不在本 delta 交付）。

## 签核本身的核对清单

1. `contract.md` 的 16 项字段提议，每一项都能在
   `phases/phase-01-run-a-project/requirements/02-tpl/r10-design-facet-panels-draft.md`
   里找到对应的抽取依据小节（逐项核对，不接受本文件凭空新增的字段）。
2. 第 4 项「角色与权限」的命名与矩阵可编辑性描述，与人类已裁决的两点逐字对得上
   （命名="角色与权限"；`PermissionCell.editable` 字段存在且语义="灰色只读、其余可勾选、
   方法负责人可配默认值"）。
3. G1/G2/G3 三处未决问题，`contract.md` 与 `design-signoff.md` 均未给出臆造答案——
   核对方式：搜索这三处标注（`unknown-input-shape`/`不在本轮字段范围内`/"按草稿现状
   分别给出"）确认没有被替换成具体断言。
4. 第 16 项"基本配置"的字段提议**不包含任何新 `designFacetKey`**——核对方式：
   `contract.md` 第 0 项列出的四个引用操作（`getInitializationPreview`/
   `setDurationTier`/`setFormatAndLanguage`/`setModelStrategy`+`setQuotaPolicy`）
   均能在 `packages/contracts/src/templates.ts` 里找到对应的已签核 operation。
5. `design-signoff.md` 的 `status` 仍为 `pending`——本 delta 只是提案，agent 未越权
   自签。

## 采纳后（未来实现落地时）的验收方向，不在本 delta 交付范围

- 若某一项面板的结构化存储被排入某个 feature：该 feature 的 `verification` 应包含
  真库测试，断言写入/读出的字段与 `contract.md` 对应小节的结构一致（同本仓其余
  contract-delta → feature 落地的既有模式，如 `blueprint-read-path` delta → F186）。
- 权限矩阵灰色格子的具体值集（哪些 (capability, role) 组合恒 `editable=false`）需要
  实现前先补一次原型交互走查或产品确认，走查结论应作为该 feature 的一条注释登记，
  不由实现者自行猜测。
- 第 16 项聚合页 feature 的验收应包含：页面真实调用四个已实现端点（不是四份 mock
  拼接），且不新增任何后端路由/表。

## typecheck / lint

无——本 delta 只新增/修改 Markdown 文档，不涉及任何 `.ts`/契约文件改动，
`pnpm --filter @repo/contracts run typecheck` 与 `pnpm --filter api run lint` 均不受影响
（可选跑一次确认零回归，但不是本 delta 的必要验收步骤）。
