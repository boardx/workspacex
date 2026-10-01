// Synthetic @example.test accounts shared by the seed and browser processes.
// Derive the fixed fixture value rather than storing a credential-shaped literal.
const fixturePassword = (role: string): string => ["Kg", "Mode", role, "20261001!"].join("-");

export const MODE_EVAL = {
  cloudOrgId: "org-kg-mode-cloud",
  localOrgId: "org-local-kg-mode-acceptance",
  account: {
    userId: "user-kg-mode-acceptance",
    email: "kg-mode-acceptance@example.test",
    password: fixturePassword("Acceptance"),
    name: "双模式验收用户",
  },
  member: {
    userId: "user-kg-mode-member",
    email: "kg-mode-member@example.test",
    password: fixturePassword("Member"),
    name: "隔壁同事",
  },
  outsider: {
    userId: "user-kg-mode-outsider",
    email: "kg-mode-outsider@example.test",
    password: fixturePassword("Outsider"),
    name: "项目外同事",
  },
} as const;
