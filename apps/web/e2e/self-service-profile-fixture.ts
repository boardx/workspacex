/**
 * #638/#639 —— 用户个人资料自助服务 + 组织团队管理，真实浏览器验收的固定数据。
 *
 * 单独一个 org + 单独一套 webServer/DB（同 `chat-read-fixture.ts` 的做法，不是
 * `fullstack-smoke-fixture.ts` 那种"多 spec 共用一套种子"）：本文件覆盖的三条写路径
 * ——改姓名、改密码、团队增删改——**互相之间也会改变共享状态**（改密码会让这个账号
 * 之后登不进去），一旦跟别的 spec 共用账号，别的 spec 会因为密码被换掉而集体失败。
 * 专门开一个 org、一个管理员账号，只有这一个 spec 文件碰它，没有这层风险。
 *
 * 团队这边种一个**非空**团队（`seedTeamId`，带一个既有成员）——用来验证
 * "非空团队不能删"这条反证：这是种子里天然存在的状态，不是从 UI 拼出来的假成员
 * （org-admin 这一轮的产品范围里没有"加成员"入口，见 `org-admin-screen.tsx` 文件头）。
 * 另建一个空团队专门给"新建 → 改名 → 删除"这条正例用，两条路径不共用同一个团队。
 */
export const SELF_SERVICE_PROFILE_E2E = {
  orgId: "org-self-service-profile-e2e",
  orgName: "Self-service profile E2E org",

  adminEmail: "ssp-e2e-admin@example.test",
  adminPassword: "SspE2eAdmin-only-638!",
  adminUserId: "user-ssp-e2e-admin",
  adminDisplayName: "SSP E2E Admin",

  /** 改密码专用的新密码——与初始密码字面量不同，且同样满足"至少 12 位"策略。 */
  newPassword: "SspE2eAdmin-changed-639!",

  /** 团队成员用户——只用来让 `seedTeamId` 非空，不通过它登录。 */
  memberUserId: "user-ssp-e2e-member",
  memberEmail: "ssp-e2e-member@example.test",

  projectId: "project-ssp-e2e",

  /** 种子里已存在、带一名成员的团队——"删除非空团队被拒绝"这条反证的对象。 */
  seedTeamName: "非空团队",
} as const;
