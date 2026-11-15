import { expect, it } from "vitest";
import { aidtBoardReturnHref } from "@/features/aidt/lib/aidt-board-return";

const current = { projectId: "group", boardId: "actual-board/1" };
it("keeps the current project, a legal stage and the resolved thread while using the real Board route resource", () => {
  expect(aidtBoardReturnHref({ ...current, returnTo: "/aidt/group?step=4&tool=whiteboard&thread=real-thread" })).toBe("/aidt/group?step=4&tool=whiteboard&resource=actual-board%2F1&thread=real-thread");
  expect(aidtBoardReturnHref({ projectId: "group/1", boardId: "actual-board", returnTo: "/aidt/group%2F1?step=6&tool=whiteboard&thread=thread%2F6" })).toBe("/aidt/group%2F1?step=6&tool=whiteboard&resource=actual-board&thread=thread%2F6");
});
it("does not forward a spoofed resource, unrelated query parameters or a different tool", () => {
  expect(aidtBoardReturnHref({ ...current, returnTo: "/aidt/group?step=4&tool=design&resource=spoof&redirect=https%3A%2F%2Fevil.test&token=secret&thread=real" })).toBe("/aidt/group?step=4&tool=whiteboard&resource=actual-board%2F1&thread=real");
});
it.each([
  "https://evil.test/aidt/group?step=4", "//evil.test/aidt/group?step=4", "/\\evil.test/aidt/group?step=4",
  "/%2f%2fevil.test", "/%252f%252fevil.test", "%2F%2Fevil.test", "/%68ttps:%2f%2fevil.test",
  "/aidt/other?step=4", "/aidt/group/extra?step=4", "/aidt/group%2fextra?step=4", "/aidt/group?step=0",
  "/aidt/group?step=7", "/aidt/group?step=01", "/aidt/group", "/aidt/group?step=4&step=5",
  "/aidt/group?step=4&thread=a&thread=b", "/aidt/group?step=4#https://evil.test", "/aidt/group?step=4\n", "",
])("rejects invalid explicit return context without falling back to a legacy stage: %s", (returnTo) => {
  expect(aidtBoardReturnHref({ ...current, returnTo, aidtStep: "4", aidtThread: "legacy-thread" })).toBeNull();
});
it("rejects double encoding of the current project id", () => {
  expect(aidtBoardReturnHref({ projectId: "group/1", boardId: "board", returnTo: "/aidt/group%252F1?step=4" })).toBeNull();
});
it("retains the explicit legacy teaching context, while ordinary Board step state stays ordinary", () => {
  expect(aidtBoardReturnHref({ ...current, aidtStep: "3", aidtThread: "legacy-thread" })).toBe("/aidt/group?step=3&tool=whiteboard&resource=actual-board%2F1&thread=legacy-thread");
  expect(aidtBoardReturnHref(current)).toBeNull();
  expect(aidtBoardReturnHref({ ...current, aidtStep: "3.0" })).toBeNull();
});
it("requires the actual Board route resource and a project context", () => {
  expect(aidtBoardReturnHref({ projectId: "group", boardId: null, returnTo: "/aidt/group?step=4&resource=spoof" })).toBeNull();
  expect(aidtBoardReturnHref({ projectId: null, boardId: "board", returnTo: "/aidt/group?step=4" })).toBeNull();
});
