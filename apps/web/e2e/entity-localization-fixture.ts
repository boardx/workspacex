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
