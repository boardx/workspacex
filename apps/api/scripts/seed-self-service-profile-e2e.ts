/**
 * Controlled PG fixture for #638/#639's real-browser gate (`self-service-profile.spec.ts`).
 *
 * Dedicated org + dedicated admin account -- see `self-service-profile-fixture.ts` for why
 * this cannot share an account with any other spec (password change mutates shared state).
 */
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../tests/support/db";

if (process.env.SSP_E2E_FIXTURE !== "1") throw new Error("SSP_E2E_FIXTURE=1 is required");
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const orgId = required("SSP_E2E_ORG_ID");
const orgName = required("SSP_E2E_ORG_NAME");
const projectId = required("SSP_E2E_PROJECT_ID");

const adminEmail = required("SSP_E2E_ADMIN_EMAIL");
const adminPassword = required("SSP_E2E_ADMIN_PASSWORD");
const adminUserId = required("SSP_E2E_ADMIN_USER_ID");
const adminDisplayName = required("SSP_E2E_ADMIN_DISPLAY_NAME");

const memberUserId = required("SSP_E2E_MEMBER_USER_ID");
const memberEmail = required("SSP_E2E_MEMBER_EMAIL");

/** F05 —— 键盘可达性专属账号（见 `self-service-profile-fixture.ts` 同名字段头注）。 */
const keyboardUserId = required("SSP_E2E_KEYBOARD_USER_ID");
const keyboardEmail = required("SSP_E2E_KEYBOARD_EMAIL");
const keyboardPassword = required("SSP_E2E_KEYBOARD_PASSWORD");
const keyboardDisplayName = required("SSP_E2E_KEYBOARD_DISPLAY_NAME");

/** F06 —— org-admin 键盘可达性专属账号对（见 `self-service-profile-fixture.ts` 同名字段头注）。 */
const orgAdminKeyboardAdminUserId = required("SSP_E2E_ORG_ADMIN_KEYBOARD_ADMIN_USER_ID");
const orgAdminKeyboardAdminEmail = required("SSP_E2E_ORG_ADMIN_KEYBOARD_ADMIN_EMAIL");
const orgAdminKeyboardAdminPassword = required("SSP_E2E_ORG_ADMIN_KEYBOARD_ADMIN_PASSWORD");
const orgAdminKeyboardAdminDisplayName = required("SSP_E2E_ORG_ADMIN_KEYBOARD_ADMIN_DISPLAY_NAME");
const orgAdminKeyboardMemberUserId = required("SSP_E2E_ORG_ADMIN_KEYBOARD_MEMBER_USER_ID");
const orgAdminKeyboardMemberEmail = required("SSP_E2E_ORG_ADMIN_KEYBOARD_MEMBER_EMAIL");
const orgAdminKeyboardMemberDisplayName = required("SSP_E2E_ORG_ADMIN_KEYBOARD_MEMBER_DISPLAY_NAME");

/** F15 —— 截图保真度专属账号（见 `self-service-profile-fixture.ts` 同名字段头注；红因 #2086）。 */
const fidelityUserId = required("SSP_E2E_FIDELITY_USER_ID");
const fidelityEmail = required("SSP_E2E_FIDELITY_EMAIL");
const fidelityPassword = required("SSP_E2E_FIDELITY_PASSWORD");
const fidelityDisplayName = required("SSP_E2E_FIDELITY_DISPLAY_NAME");

const seedTeamName = required("SSP_E2E_SEED_TEAM_NAME");

ensureDatabase();
await migrateOnce();
await resetOrgs(orgId);
await asOwner(async (client) => {
  await client.query(
    "DELETE FROM credentials WHERE user_id = ANY($1::text[]) OR email = ANY($2::text[])",
    [
      [adminUserId, memberUserId, keyboardUserId, orgAdminKeyboardAdminUserId, orgAdminKeyboardMemberUserId, fidelityUserId],
      [adminEmail, memberEmail, keyboardEmail, orgAdminKeyboardAdminEmail, orgAdminKeyboardMemberEmail, fidelityEmail],
    ],
  );
});

const fixture = await seedOrg({ orgId, projectId, teamNames: [seedTeamName], groupNames: ["gate"] });
await asApp(orgId, (client) => client.query(
  "UPDATE organizations SET name = $1 WHERE id = $2",
  [orgName, orgId],
));

await addOrgMember(orgId, adminUserId, "admin", null);
// #639：让种子团队天生非空——"删除非空团队被拒绝"这条反证要的是真实状态，
// 不是从 UI 里现拼一个成员（org-admin 这一轮没有"加成员"入口）。
await addOrgMember(orgId, memberUserId, "consultant", fixture.teams[seedTeamName] ?? null);
// F05 —— 键盘可达性专属账号，独立于 admin/member，避免与改密码用例的执行顺序耦合。
await addOrgMember(orgId, keyboardUserId, "consultant", null);
// F06 —— org-admin 键盘可达性专属账号对：admin 角色是 `ReviewerFunctionPicker` 渲染
// 的前提条件（`org-admin-screen.tsx` 的 `isAdmin` 判断），target 是它要调整权限的成员。
await addOrgMember(orgId, orgAdminKeyboardAdminUserId, "admin", null);
await addOrgMember(orgId, orgAdminKeyboardMemberUserId, "consultant", null);
// F15 —— 截图保真度专属账号：admin 角色是 `/org-admin` 两块内容渲染的前提（`isAdmin`）。
await addOrgMember(orgId, fidelityUserId, "admin", null);

const hasher = new BcryptPasswordHasher();
const adminPasswordHash = await hasher.hash(adminPassword);
// 成员账号不通过浏览器登录，密码随便给一个满足策略的占位值即可。
const memberPasswordHash = await hasher.hash("Ssp-e2e-member-not-logged-in-639!");
const keyboardPasswordHash = await hasher.hash(keyboardPassword);
const orgAdminKeyboardAdminPasswordHash = await hasher.hash(orgAdminKeyboardAdminPassword);
// 目标成员不通过浏览器登录，密码随便给一个满足策略的占位值即可（同上面 memberPasswordHash 的理由）。
const orgAdminKeyboardMemberPasswordHash = await hasher.hash("Ssp-e2e-org-admin-keyboard-target-not-logged-in-1930!");
const fidelityPasswordHash = await hasher.hash(fidelityPassword);
await asOwner(async (client) => {
  await client.query(
    `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
     VALUES ($1,$2,$3,$4,now()), ($5,$6,$7,$8,now()), ($9,$10,$11,$12,now()),
            ($13,$14,$15,$16,now()), ($17,$18,$19,$20,now()), ($21,$22,$23,$24,now())`,
    [
      adminUserId, adminEmail, adminDisplayName, adminPasswordHash,
      memberUserId, memberEmail, "SSP E2E member", memberPasswordHash,
      keyboardUserId, keyboardEmail, keyboardDisplayName, keyboardPasswordHash,
      orgAdminKeyboardAdminUserId, orgAdminKeyboardAdminEmail, orgAdminKeyboardAdminDisplayName, orgAdminKeyboardAdminPasswordHash,
      orgAdminKeyboardMemberUserId, orgAdminKeyboardMemberEmail, orgAdminKeyboardMemberDisplayName, orgAdminKeyboardMemberPasswordHash,
      fidelityUserId, fidelityEmail, fidelityDisplayName, fidelityPasswordHash,
    ],
  );
});

process.stdout.write(
  `[self-service-profile-e2e-fixture] seeded org=${orgId} admin=${adminEmail} seedTeam=${seedTeamName} `
  + `keyboardUser=${keyboardEmail} orgAdminKeyboardAdmin=${orgAdminKeyboardAdminEmail} `
  + `fidelity=${fidelityEmail}\n`,
);
