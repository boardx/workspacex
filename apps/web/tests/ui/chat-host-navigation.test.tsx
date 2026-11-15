import * as React from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatHostNavigationProvider, chatBoardHandoffHref, safeChatHostReturnHref, useChatHostReturnHref } from "@/lib/chat/chat-host-navigation";
function Consumer({ projectId }: { projectId?: string }) { const href = useChatHostReturnHref(projectId); return <a data-testid="link" href={chatBoardHandoffHref({ boardId: "b/1", projectId, artifactId: "a/1", layoutHash: "hash +", returnHref: href })}>Board</a>; }
it("keeps the native project's previous Board link byte-for-byte when no host return context exists", () => {
  render(<Consumer projectId="p" />);
  expect(screen.getByTestId("link")).toHaveAttribute("href", "/studio/board/b%2F1?projectId=p&focusArtifact=a%2F1&focusLayout=hash+%2B");
});
it("keeps personal Board handoff links unchanged too", () => {
  expect(chatBoardHandoffHref({ boardId: "b", artifactId: "a", layoutHash: "h" })).toBe("/studio/board/b?focusArtifact=a&focusLayout=h");
});
it("appends a same-project optional return path while preserving diagram provenance and the actual conversation", () => {
  const returnHref = "/aidt/p?step=3&tool=whiteboard&thread=resolved-thread";
  render(<ChatHostNavigationProvider value={{ projectId: "p", returnHref }}><Consumer projectId="p" /></ChatHostNavigationProvider>);
  const href = screen.getByTestId("link").getAttribute("href")!; const parsed = new URL(href, "https://workspace.invalid");
  expect(parsed.searchParams.get("projectId")).toBe("p"); expect(parsed.searchParams.get("focusArtifact")).toBe("a/1"); expect(parsed.searchParams.get("focusLayout")).toBe("hash +"); expect(parsed.searchParams.get("returnTo")).toBe(returnHref);
});
it("ignores a host context from a different project without changing Board access or insertion semantics", () => {
  render(<ChatHostNavigationProvider value={{ projectId: "foreign", returnHref: "/aidt/foreign?step=3" }}><Consumer projectId="p" /></ChatHostNavigationProvider>);
  expect(screen.getByTestId("link").getAttribute("href")).not.toContain("returnTo");
});
it.each(["https://evil.test/", "//evil.test/", "/\\evil.test/", "/%2f%2fevil.test/", "/%252f%252fevil.test/", "/%5cevil.test/", "/%255cevil.test/", "/%0a/evil.test", "/https%3a%2f%2fevil.test/", "javascript:alert(1)", " /aidt/p?step=1", "/aidt/p\n", "/%zz"])("rejects an external, control or encoding-based return target %s", (target) => { expect(safeChatHostReturnHref(target)).toBeUndefined(); });
it("preserves ordinary encoded project IDs and query strings instead of decoding/reconstructing the return route", () => {
  expect(safeChatHostReturnHref("/aidt/p%2Fone?step=2&thread=t%2Fone")).toBe("/aidt/p%2Fone?step=2&thread=t%2Fone");
});
