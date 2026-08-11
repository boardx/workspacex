# 验收口径 · token 计量 / 成员配额 / 用量监控 / 限额策略

每条都要能在 CI 上跑出退出码 0，并把输出留到
`phases/phase-01-run-a-project/sprints/sprint-02/evidence/<F>.verify.log`。

## F159 计量单一写入点

| 断言 | 落点 |
|---|---|
| 一次成功的 agent run ⇒ 恰好一行 `token_usage_events`，`tokens_total` 等于 provider 返回值 | `tests/auth/token-usage-single-write-path.test.ts` |
| 模型调用失败 ⇒ 也有一行，`outcome='failed'`、`tokens_total=0` | 同上 |
| 源码扫描：`INSERT INTO token_usage_events` 只出现在计量仓储一个文件里 | 同上（**反证**） |
| UPDATE / DELETE 被数据库拒绝；组织删除的级联仍放行 | `tests/auth/token-usage-append-only.test.ts` |
| 跨租户不可见（RLS） | 同上 |

## F160 成员 token 配额

| 断言 | 落点 |
|---|---|
| 设额度 → 读回一致；`allocated` / `unallocated` 随之变 | `tests/auth/member-token-quota-allocation.test.ts` |
| 逐人之和 > 组织额度 ⇒ `QUOTA_OVERALLOCATED` + 响应带 `remainingTokens`，**且库里没写进去** | `tests/auth/member-token-quota-overallocation-rejected.test.ts` |
| 组织额度未设置 ⇒ `orgBudget`/`unallocated` 都是 `null`，不是 0 | 同上 |
| 非 admin ⇒ `FORBIDDEN` | 同上 |
| 界面三张卡与列表读真端点，`NoBackendNotice` 不再渲染 | `tests/ui/admin-members-quota-live.test.tsx` |

## F161 用量监控

| 断言 | 落点 |
|---|---|
| 四个窗口各自聚合：同一批事件下 `today` 与 `month` 的总数不同 | `tests/auth/usage-window-aggregation.test.ts` |
| 人×模型矩阵每格 ＝ 该人该模型在窗口内的 `SUM(tokens_total)` | 同上 |
| 零事件 ⇒ 空态（不是示例数字） | `tests/ui/admin-usage-monitor-live.test.tsx` |
| 切窗口触发新请求（**反证**：mock 快照做不到这一条） | 同上 |

## F162 限额策略

| 断言 | 落点 |
|---|---|
| 五值 `scope_kind` 从 `pg_constraint` 读回 == 契约枚举 | `tests/auth/limit-rule-crud.test.ts` |
| 增删改读回一致；删不存在 ⇒ `LIMIT_RULE_NOT_FOUND` | 同上 |
| 多规则同时命中 ⇒ 只记最先触发的那条的 `rule_id` | `tests/auth/limit-rule-first-trigger-wins.test.ts` |
| 触发后该事件出现在 `getUsageReport.recentLimitEvents` | 同上 |

## F163 管理员边界接线（无 delta，仅接线）

| 断言 | 落点 |
|---|---|
| 边界区计数来自 `GET /identity/personal-layer/summary`，响应体无内容字段 | `tests/ui/admin-members-boundary-live.test.tsx` + 既有 `tests/auth/admin-boundary-personal-counts-only.test.ts` |
| 「我的访问记录」来自 `listMyAccessLog` | 同上 |
