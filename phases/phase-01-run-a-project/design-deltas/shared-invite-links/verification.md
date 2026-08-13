# 组织共享邀请链接 可执行验收契约

全部命令在仓库根、隔离外壳下执行（共享库会互相踩踏）。

## 单测门（现在就能跑）

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec vitest run tests/auth/shared-invite-links.test.ts
```

覆盖的反证（缺一不可，逐条对应派工单）：
- **多次语义**：同一链接两个不同的人先后加入都成功；`max_uses = 2` 时第三人被拒
  （统一 `INVITE_NOT_FOUND`），且 `used_count` 恒等于真实加入数（原子递增，不超上限）。
- **失效面统一**：过期链接 / 已作废链接 / 复核未通过（pending-review）的 admin 链接 →
  激活一律 `INVITE_NOT_FOUND`（防枚举：三种失效响应同码同形）。
- **admin 级复核**：建链后立即用 → 拒（令牌根本不存在，DB 断言 `org_invite_link_tokens`
  零行）；发起人自批 → `INVITE_SELF_REVIEW_FORBIDDEN`；第二 admin 批准 → 响应带明文
  linkToken 且可真实激活建号。
- **配额硬闸**：席位配额耗尽时链接加入被拒（`QUOTA_EXHAUSTED`）且成员数、`used_count`
  都未变（事务回滚）。
- **邮箱查重**：已是成员的邮箱走链接 → `INVITE_ALREADY_MEMBER`，`credentials` 行数不变
  （不重复建号）。
- **落库无明文**：签发响应里的明文令牌在 `org_invite_links` / `org_invite_link_tokens`
  两张表的任何列里都搜不到（搜值不搜字段名）；列表接口输出里也搜不到。

## 契约门

```bash
pnpm --filter @repo/contracts run typecheck && pnpm --filter @repo/contracts exec vitest run
```

## UI 门（起真实栈后）

- 邀请标签页「共享邀请链接」区块：建链（角色/有效期/上限）→ 一次性链接块出现
  （`org-admin-shared-link-block`），复制可用；列表出现新行、徽标 active。
- admin 级建链 → 徽标 pending-review、无链接块（明说「批准后签发」）；发起人视角无
  批准按钮、有 `-waiting-peer-review` 说明；第二 admin 视角批准 → 链接块出现（一次）。
- 作废按钮二次确认后 → 徽标 revoked，链接立即不可激活。
- `/auth/activate?lt=<token>`：自填邮箱+姓名+密码建号成功；换一个人再走同一链接同样
  成功（多次语义活体复现）；作废后再打开 → 统一失效文案。

## 基线门

```bash
./init.sh
```
