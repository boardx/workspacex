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
} as const;
