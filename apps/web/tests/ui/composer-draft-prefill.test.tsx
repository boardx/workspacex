/** `/chat?prefill=`（数字人详情「在对话中发起」）的一次性预填：只写空草稿，不覆盖用户已输入的内容。 */
import { afterEach, describe, expect, it } from "vitest";
import { seedComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import { agentChatHref } from "@/lib/agent-directory";

afterEach(() => sessionStorage.clear());

describe("seedComposerDraft", () => {
  const scope = { orgId: "o1", userId: "u1", projectId: null, threadId: null };
  it("空草稿 → 写入；已有草稿 → 不覆盖；没登录（无 org/user）→ 不写", () => {
    expect(seedComposerDraft(scope, "请帮我发起「A」工作流。")).toBe(true);
    expect(seedComposerDraft(scope, "别的")).toBe(false);
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe("请帮我发起「A」工作流。");
    expect(seedComposerDraft({ ...scope, orgId: null }, "x")).toBe(false);
  });
  it("深链带 agent 与 prefill", () => {
    const href = agentChatHref("a 1", "发起「X」");
    const q = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/chat?")).toBe(true);
    expect(q.get("agent")).toBe("a 1");
    expect(q.get("prefill")).toBe("发起「X」");
  });
});
