---
---
status: confirmed              # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: model-pool-listing
base_bundle: agent-runtime
scope: model-pool-admin-listing-plus-local-model-seed
# 不设 covers：F48 的 feature 归属已由 agent-runtime 束的签核声明，本 delta 只扩展它的
# 契约面（新增 listModelPool），不重新认领 F48 的 covers——避免「同一事实声明在两处」
# （doctor 的签核链检查会为此报 FAIL，已实测验证过）。
confirmed_by: "usamshen"
confirmed_at: "2026-08-16T08:43:22+08:00"
ruling: "usamshen 在会话中拍板：批准新增 listModelPool；删除维持停用语义（2026-08-16）。PR #1395 已于 2026-08-15 23:47 UTC 合入 main（usamshen 本人合并）；本次签核为补签，令记录与已上线的事实对齐。"
---
---

# 模型池列表读取 —— 设计签核（#1381）

这是一份**新的 delta 包**。它不修改、也不重新确认 `agent-runtime`
（F48–F60 + F129–F131）已签核束的其余部分——那份签核（2026-07-30，
`phases/phase-01-run-a-project/contracts/agent-runtime/design-signoff.md`）保持
`status: confirmed` 原样不动，本 delta 只在它之上加一条契约操作。本文件的每一次 status
变更都归人类所有——**agent 不得改 status**（ADR-023）。实现已按会话内的裁决开工，
**合并前需人类把 status 改 confirmed**。

规范来源：[contract.md](./contract.md)。验证证据：[verification.md](./verification.md)。

## ① UI

`apps/web/components/admin/model-screen.tsx` 沿用既有的卡片/列表两种视图（人类此前已
核准的「后台统一改版」结构），字段不变、testid 不变——变的只是数据源（`MODELS` mock
→ `listModels()` 真实调用）。新增一条页头说明 `ModelScreenNotice`，如实标注这屏是混合态
（列表/接入真实，启用/停用/测试判读仍本地演示，等 F50）。无新截图需要——没有新增交互面。

## ② 用例

`application/model/list-model-pool.ts` 是 F48 落地时就写好的既有代码（`listModelPool(orgId,
repository)`），本 delta 第一次给它接上 controller 路由，逻辑本身零改动。

## ③ API 契约

一处新增（`listModelPool`），零处修改——见 [contract.md](./contract.md)。

---

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字>"
confirmed_at: "<ISO8601 时间戳，如 2026-08-16T12:00:00+08:00>"
```

如果只同意契约新增、但对 `ModelScreenNotice` 的措辞或位置有意见，那是实现细节，可以在
PR 里直接改，不影响这里签的是不是「新增一个只读操作、不引入新错误码/新字段语义」这件事。
