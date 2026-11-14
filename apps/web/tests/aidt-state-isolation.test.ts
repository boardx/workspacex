import { afterEach, expect, it, vi } from "vitest";
import { aidtDraftScope, aidtResourceScope } from "@/features/aidt/lib/aidt-state-scope";
import { AIDT_PROJECT_TAG, isAidtProject, projectWorkspaceHref } from "@/lib/project-aidt";

const identity = { currentOrgId: "org", userId: "student", sessionToken: "token-a" };
afterEach(() => vi.unstubAllEnvs());
it("separates organization, actor and group drafts while retaining the same actor's token-refresh draft", () => {
  const base = aidtDraftScope(identity, "group");
  expect(aidtDraftScope({ ...identity, currentOrgId: "other" }, "group")).not.toBe(base);
  expect(aidtDraftScope({ ...identity, userId: "other" }, "group")).not.toBe(base);
  expect(aidtDraftScope(identity, "other")).not.toBe(base);
  expect(aidtDraftScope({ ...identity, sessionToken: "token-b" }, "group")).toBe(base);
});
it("revalidates resource associations on token rotation and permission transitions", () => {
  const base = aidtResourceScope(identity, "group", "design", "resource", true);
  expect(aidtResourceScope({ ...identity, sessionToken: "token-b" }, "group", "design", "resource", true)).not.toBe(base);
  expect(aidtResourceScope(identity, "group", "design", "resource", false)).not.toBe(base);
  expect(aidtResourceScope({ ...identity, userId: "other" }, "group", "design", "resource", true)).not.toBe(base);
});
it("keeps AIDT classification independent of its opt-in routing and leaves ordinary projects unchanged", () => {
  const aidt = { id: "group/1", kind: "general", tags: [AIDT_PROJECT_TAG] };
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "false");
  expect(isAidtProject(aidt)).toBe(true);
  expect(projectWorkspaceHref(aidt)).toBe("/projects/group%2F1");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true");
  expect(projectWorkspaceHref(aidt)).toBe("/aidt/group%2F1");
  expect(projectWorkspaceHref({ ...aidt, tags: [] })).toBe("/projects/group%2F1");
  expect(projectWorkspaceHref({ ...aidt, kind: "workshop" })).toBe("/projects/group%2F1");
});
