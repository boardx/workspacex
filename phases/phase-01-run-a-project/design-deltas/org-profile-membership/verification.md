# 组织资料编辑 + 成员/邀请列表读 可执行验收契约

这些命令就是实现的完成契约。部分文件尚不存在，**它们的缺席是预期的 RED**，
不是豁免、也不是"健康的空结果"。

## 实现门（签核后才会有对应文件）

```bash
pnpm --filter @repo/api test -- tests/org-admin/list-org-members-real.test.ts
pnpm --filter @repo/api test -- tests/org-admin/list-org-invites-real.test.ts
pnpm --filter @repo/api test -- tests/org-admin/update-organization-authorization.test.ts
pnpm --filter @repo/api test -- tests/org-admin/upload-org-avatar-server-validated.test.ts
```

必须覆盖的反证（不是可选）：
- `listOrgMembers`：造一个真实成员（真实 `org_memberships` 行）→ 断言能读到；把该成员移除
  （或换一条不存在的 orgId）→ 断言读不到/为空，证明不是硬编码。
- `listOrgInvites`：造一条真实邀请 → 能读到；已撤销的邀请状态字段必须如实反映 `revoked`。
- `updateOrganization`：非 admin 调用 → `FORBIDDEN`，库内 `name`/`description` 未变；admin
  调用 → 真的落库（独立 re-read 验证，不只看响应体）。
- `uploadOrgAvatar`：绕过前端直接发超限/错误 content-type 请求 → 服务端真的拒绝，不落对象存储。

## e2e 门（浏览器路径）

```bash
pnpm --filter web exec playwright test e2e/org-admin-profile.spec.ts
```

- 真实登录 admin 账号 → `/org-admin` 组织资料标签页改名/传头像 → 保存 → 独立读一次
  （reload 或另一个会话）验证新值真的可见，不是纯前端回显（迭代 1/2 的 displayName 教训）。
- 成员/邀请两个标签页从 `/admin/[module]` 迁移到 `/org-admin` 后，`/admin` 导航里对应入口
  已摘除（机械检查：`grep -L` 确认 `admin-nav.tsx` 不再声明这两个模块）。
