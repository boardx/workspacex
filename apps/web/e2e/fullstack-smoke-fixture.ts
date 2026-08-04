const scope = (process.env.WORKSPACEX_ISOLATION_ID ?? "fullstack-e2e")
  .replace(/[^a-zA-Z0-9-]/g, "-")
  .slice(-24);

export const FULLSTACK_E2E = {
  email: `fullstack-${scope}@example.test`,
  password: "Fullstack-E2E-only-387!",
  orgId: `org-fullstack-${scope}`,
  userId: `user-fullstack-${scope}`,
  projectId: `project-fullstack-${scope}`,
  artifactId: `artifact-fullstack-${scope}`,
  projectName: `Fullstack sentinel project ${scope}`,
  sentinelFile: `FULLSTACK_SENTINEL_${scope}.md`,

  /**
   * #458：Agent 目录的写路径需要一个**组织管理员**。
   *
   * ⚠ 刻意是第二个账号，而不是把上面那个改成 admin。上面那位是 `consultant`，
   *   #387 的整条 projects / Files 断言都建立在他那份权限上；为了 #458 顺手升权，
   *   等于让另一个门控在一个它没测过的角色上跑——而它会**照样全绿**，
   *   直到某天有人发现「非管理员能看见什么」这条根本没人再验过了。
   */
  adminEmail: `fullstack-admin-${scope}@example.test`,
  adminPassword: "Fullstack-E2E-admin-458!",
  adminUserId: `user-fullstack-admin-${scope}`,

  /**
   * #458 自己的非管理员，**不复用上面那位 consultant**。
   *
   * Playwright 按文件并行（两个 worker），两个 spec 同时用同一个账号登录会撞上设备会话——
   * 本仓已经有 `kick-device-invalidates-session` 那条行为，同一账号的并发登录**可能**互相踢掉。
   * 那种失败是间歇性的，最后会被归因成「e2e 不稳」然后被人加重试掩盖过去。
   * 一个多出来的种子账号比一条会偶发的门控便宜得多。
   */
  memberEmail: `fullstack-member-${scope}@example.test`,
  memberPassword: "Fullstack-E2E-member-458!",
  memberUserId: `user-fullstack-member-${scope}`,
  /** 新建出来的 Agent 名字。带 scope，避免与并发隔离出来的其它库互相看见。 */
  agentName: `FULLSTACK_AGENT_${scope}`,
} as const;
