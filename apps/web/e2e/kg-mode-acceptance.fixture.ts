export const MODE_EVAL = {
  cloudOrgId: "org-kg-mode-cloud",
  localOrgId: "org-local-kg-mode-acceptance",
  account: {
    userId: "user-kg-mode-acceptance",
    email: "kg-mode-acceptance@example.test",
    password: "test-kg-mode-account-only",
    name: "双模式验收用户",
  },
  member: {
    userId: "user-kg-mode-member",
    email: "kg-mode-member@example.test",
    password: "test-kg-mode-member-only",
    name: "隔壁同事",
  },
  outsider: {
    userId: "user-kg-mode-outsider",
    email: "kg-mode-outsider@example.test",
    password: "test-kg-mode-outsider-only",
    name: "项目外同事",
  },
} as const;
