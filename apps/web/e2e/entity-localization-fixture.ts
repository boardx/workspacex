const scope = (process.env.WORKSPACEX_ISOLATION_ID ?? "entity-localization-e2e").replace(/[^a-zA-Z0-9-]/g,"-").slice(-24);
/** Private tenant/accounts: other stateful smoke cases cannot rename, disable or
 * publish the source entity while this case verifies CAS and original bytes. */
export const ENTITY_LOCALIZATION_E2E = {
  orgId: `org-entity-locale-${scope}`,
  projectId: `project-entity-locale-${scope}`,
  adminUserId: `user-entity-locale-admin-${scope}`,
  adminEmail: `entity-locale-admin-${scope}@example.test`,
  adminPassword: "Entity-locale-admin-e2e-6149!",
  memberUserId: `user-entity-locale-member-${scope}`,
  memberEmail: `entity-locale-member-${scope}@example.test`,
  memberPassword: "Entity-locale-member-e2e-6149!",
} as const;

/** Separate actors/tenants keep the original two-member quota roster unchanged. */
export const PLATFORM_MEMBERS_E2E = {
  superuserId: `user-platform-locale-super-${scope}`,
  superuserEmail: `platform-locale-super-${scope}@example.test`,
  superuserName: "平台超管原文 {superuser}",
  targetId: `user-platform-locale-target-${scope}`,
  targetEmail: `platform-locale-target-${scope}@example.test`,
  targetName: "跨组织成员原文 {target}",
  orgAId: `org-platform-locale-a-${scope}`,
  orgAName: "成员管理验收组织甲原文 {organizationA}",
  projectAId: `project-platform-locale-a-${scope}`,
  orgBId: `org-platform-locale-b-${scope}`,
  orgBName: "成员管理验收组织乙原文 {organizationB}",
  projectBId: `project-platform-locale-b-${scope}`,
} as const;
