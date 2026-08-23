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

  /**
   * F05 —— chat/profile 键盘可达性专属账号。**不**复用 `adminEmail`：admin 那条用例会
   * 真的改掉密码（`test.describe.serial` 里"改密码后旧密码不可登录"这条反证），跟它
   * 共用账号，账号密码被换掉之后本文件会集体登录失败——同 fixture 头注说明的道理。
   * 键盘走查这条用例只改显示名、不碰密码，专属账号避免与 admin 用例的执行顺序耦合。
   */
  keyboardUserId: "user-ssp-e2e-keyboard",
  keyboardEmail: "ssp-e2e-keyboard@example.test",
  keyboardPassword: "Ssp-e2e-keyboard-only-1869!",
  keyboardDisplayName: "SSP E2E Keyboard",

  /**
   * F06 —— org-admin 键盘可达性专属账号（issue #1930）。**不**复用 `adminEmail`：
   * 那个账号的用例会真的改密码（`test.describe.serial` 里"改密码后旧密码不可登录"
   * 这条反证），共用账号会让本文件的执行结果依赖那条用例的执行顺序——同上面
   * `keyboardEmail` 头注同一个理由。本账号带**组织 admin 角色**（`MembersTab` 的
   * `ReviewerFunctionPicker` 仅 admin 渲染，见 `org-admin-screen.tsx`），是
   * "打开一个成员的权限设置弹层并调整"这条核心任务必须的身份条件——不能像
   * `keyboardEmail`（consultant）那样验证，那个身份下这条控件根本不渲染。
   */
  orgAdminKeyboardAdminUserId: "user-ssp-e2e-org-admin-keyboard",
  orgAdminKeyboardAdminEmail: "ssp-e2e-org-admin-keyboard@example.test",
  orgAdminKeyboardAdminPassword: "Ssp-e2e-org-admin-keyboard-1930!",
  orgAdminKeyboardAdminDisplayName: "SSP E2E Org Admin Keyboard",

  /**
   * F06 —— 上面那个 admin 要调整权限的**目标成员**。不复用既有的 `memberUserId`
   * （那个人挂在 `seedTeamName` 上，专门给"非空团队不能删"这条反证用，混进来会让
   * 两条用例意外耦合团队成员计数）。这个成员不入任何团队，专属本条用例。
   */
  orgAdminKeyboardMemberUserId: "user-ssp-e2e-org-admin-keyboard-target",
  orgAdminKeyboardMemberEmail: "ssp-e2e-org-admin-keyboard-target@example.test",
  orgAdminKeyboardMemberDisplayName: "SSP E2E Org Admin Keyboard Target",

  projectId: "project-ssp-e2e",

  /** 种子里已存在、带一名成员的团队——"删除非空团队被拒绝"这条反证的对象。 */
  seedTeamName: "非空团队",
} as const;
