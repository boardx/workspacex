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

覆盖：改姓名刷新后仍在 → 改密码后用新密码能登录、旧密码不能。

## 已知缺口，切到下一个 delta（2026-08-09，人类裁决，见 PR #797 独立复核）

`listOwnActivity` 本身（读路径 + 授权 + 反证）在本轮范围内、必须实现且必须通过上面「实现门」
的三条测试。**但**"活动记录列表非空"这条 e2e 断言被撤回——独立复核实测发现
`updateOwnProfile`/`changeOwnPassword`/`uploadOwnAvatar`/`createTeam`/`renameTeam`/`deleteTeam`
六条写路径都没有调用 `provenance.append`，活动记录面板因此永远为空，不是"读路径没做"，是
"没有任何写路径产生它要读的数据"。

⇒ 本轮验收**不要求**活动记录非空；六条写路径补 provenance 落库、并把这条 e2e 断言加回来，
是**下一个 delta** 的范围，不在这份 verification.md 里预先声明具体形状（避免"规范写了没人排期"
的重演——AGENTS.md 那条「没有脚本的规范条目视为未落地」）。
