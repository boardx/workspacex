import { expect, it } from "vitest";
import { memberChatProjectFromLocation } from "@/lib/project-member-chat-navigation";

it("uses the actual project route or explicit Studio context without treating a resource ID as a project", () => {
  expect(memberChatProjectFromLocation("/aidt/group-a", new URLSearchParams("step=3"))).toBe("group-a");
  expect(memberChatProjectFromLocation("/projects/group-a", new URLSearchParams("projectId=group-b"))).toBe("group-a");
  expect(memberChatProjectFromLocation("/studio/board/board-a", new URLSearchParams("projectId=group-a"))).toBe("group-a");
  expect(memberChatProjectFromLocation("/studio/board/board-a", new URLSearchParams())).toBeNull();
  expect(memberChatProjectFromLocation("/chat", new URLSearchParams("projectId=group-a"))).toBe("group-a");
});
it.each(["/projects/new", "/projects/live", "/aidt/%2Fgroup", "/aidt/%zz", "/aidt/%20group", "/aidt/%5Cgroup"])("rejects non-project or malformed location %s", (path) => {
  expect(memberChatProjectFromLocation(path, new URLSearchParams())).toBeNull();
});
it("rejects ambiguous project query parameters and untrusted values", () => {
  for (const query of ["projectId=one&projectId=two", "projectId=", "projectId=%2Fone", "projectId=%20one"]) {
    expect(memberChatProjectFromLocation("/rec", new URLSearchParams(query))).toBeNull();
  }
});
