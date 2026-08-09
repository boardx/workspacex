# 用户个人资料自助服务 可执行验收契约

这些命令就是实现的完成契约。部分文件尚不存在，**它们的缺席是预期的 RED**，
不是豁免、也不是"健康的空结果"。

## 包结构门（现在就能跑）

```bash
pnpm exec vitest run .harness/scripts/self-service-profile-design.test.ts
```

通过 = 这份待审包结构完整且硬边界没被磨掉。**不等于**人类批准了，
也**不等于**产品行为存在。

## 实现门（签核后才会有对应文件）

```bash
pnpm --filter @repo/api test -- tests/identity/update-own-profile.test.ts
pnpm --filter @repo/api test -- tests/identity/change-own-password-requires-current.test.ts
pnpm --filter @repo/api test -- tests/identity/list-own-activity-scoped-to-self.test.ts
```

必须覆盖的反证（不是可选）：
- `changeOwnPassword` 缺 `currentPassword` 或给错 → 必须拒绝，且**不改库**；
- `listOwnActivity` 必须证明**看不到别人的事件**（不是只测自己的能看见——两条都要）；
- `updateOwnProfile` 不接受修改邮箱字段（`.strict()` 应天然拒绝多余字段，但要有断言钉住这一点）。

## e2e 门

```bash
pnpm --filter web exec playwright test e2e/self-service-profile.spec.ts
```

覆盖：改姓名刷新后仍在 → 改密码后用新密码能登录、旧密码不能 → **改名后活动记录面板
（`profile-activity-list`）真的出现至少一条记录**，不是硬编码/mock（迭代 4 补齐，见下）。

## 六条写路径的 provenance 补齐（迭代 4，#638，见 PR #797 独立复核）

独立复核实测发现 `updateOwnProfile`/`changeOwnPassword`/`uploadOwnAvatar`/`createTeam`/
`renameTeam`/`deleteTeam` 六条写路径都没有调用 `provenance.append`，`listOwnActivity`
因此永远读到空列表——"没有任何写路径产生它要读的数据"，不是读路径的问题。**本轮（迭代 4）
已补齐**：六条写路径成功后各自写入 `provenance_events`（事件类型见
`packages/contracts/src/provenance.ts` 的 `profile-renamed`/`avatar-changed`/
`password-changed`/`team-created`/`team-renamed`/`team-deleted`，ADR-101 追加记录）。
上一版这里记的"已知缺口，切到下一个 delta"已回填——本轮就是那个下一个 delta，
**"活动记录列表非空"这条 e2e 断言已恢复**，见 `apps/web/e2e/self-service-profile.spec.ts`。

反证覆盖（`apps/api/tests/identity/update-own-profile.test.ts` /
`apps/api/tests/identity/self-service-iter2.test.ts` /
`apps/api/tests/auth/team-crud-iter2.test.ts`）：每条写路径成功后独立查
`provenance_events`，断言 actor/kind/target 字段对得上；被拒绝的写尝试（越权/校验失败/
撞冲突）不写一行——审计只记真实发生过的事。
