# 邀请链接送达 + 三条读路径收口 可执行验收契约

全部命令在仓库根、隔离外壳下执行（共享库会互相踩踏，见 test-isolation 脚本头注）。

## 单测门（现在就能跑）

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run \
    tests/auth/orphan-invite-resend-revoke.test.ts \
    tests/auth/member-invite-activation.test.ts \
    tests/auth/admin-invite-dual-review.test.ts
```

覆盖的反证（不是可选）：
- ①「只此一次」两半：resend 响应里的 `activationToken` 与库里在案活令牌**同一枚**
  （正例）；第二个管理员**再查列表搜不到该值**（搜值不搜字段名，
  `TOKEN ONLY ONCE 反证 C`）。
- ① 用响应里的 token 真实走激活建号（`member-invite-activation.test.ts` 既有链路）；
  同一 token 重放 → `INVITE_NOT_FOUND`。
- ③ 契约层拒 `a@`：见下方 API 反证（zod 单测由契约 `.email()` 承担，端到端在 curl 层）。

## 契约门

```bash
pnpm --filter @repo/contracts run typecheck && pnpm --filter @repo/contracts exec vitest run
```

## e2e / API 层反证（起真实栈后）

```bash
# ③ 垃圾邮箱绕过前端直接打 API → 400 validation_failed(email)，不落库
curl -s -X POST $API/organizations/$ORG/invites -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"orgId":"'$ORG'","email":"a@","orgRole":"consultant","teamId":""}' | jq .
# ① 邀请成功响应带 activationToken；再查列表无该值
# ④ 非 admin 成员 GET /identity/me → org.avatarUrl 为真实 URL，且全程零 403
```

## UI 门

- 邀请成功 → 链接块出现（`org-admin-invite-link-block`），复制可用
  （`org-admin-invite-link-copy` → `org-admin-invite-link-copied`），关闭后消失；
- 发起人视角 `awaiting-review` 行：无 `-approve`/`-reject` 按钮，有
  `-waiting-peer-review` 说明；第二 admin 视角有批准按钮且可批；
- `/auth/activate?t=<响应里的 token>` 新用户分支建号成功后能用新密码登录；
- 非 admin 登录后组织菜单头像（#920 合并后）/ `identity.org.avatarUrl` 非空、零 403。

## 基线门

```bash
./init.sh
```
