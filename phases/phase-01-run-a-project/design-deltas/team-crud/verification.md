# 团队 CRUD 可执行验收契约

这些命令就是实现的完成契约。部分文件尚不存在，**它们的缺席是预期的 RED**，
不是豁免、也不是"健康的空结果"。

## 包结构门（现在就能跑）

```bash
pnpm exec vitest run .harness/scripts/team-crud-design.test.ts
```

通过 = 这份待审包结构完整且硬边界没被磨掉。**不等于**人类批准了，
也**不等于**产品行为存在。

## 实现门（签核后才会有对应文件）

```bash
pnpm --filter @repo/api test -- tests/org-admin/create-team-authorization.test.ts
pnpm --filter @repo/api test -- tests/org-admin/delete-team-non-empty-rejected.test.ts
pnpm --filter @repo/api test -- tests/org-admin/list-teams-member-count-real.test.ts
```

必须覆盖的反证（不是可选）：
- 非授权角色调用 `createTeam`/`renameTeam`/`deleteTeam` → 必须拒绝，且**库内状态未变**；
- 删除一个仍有成员的团队 → 必须拒绝（`TEAM_NOT_EMPTY`），**不允许**级联清空；
- `listTeams` 的 `memberCount` 必须是真实 `COUNT(*)`，反证：往 `org_memberships` 插一行
  该团队的成员，`memberCount` 必须跟着变，不能是缓存/本地计数。

## e2e 门

```bash
pnpm --filter web exec playwright test e2e/team-crud.spec.ts
```

覆盖：创建团队 → 刷新后仍在列表 → 改名 → 刷新后新名字仍在 → 删除空团队成功 →
删除非空团队被拒绝且看到明确错误提示。
