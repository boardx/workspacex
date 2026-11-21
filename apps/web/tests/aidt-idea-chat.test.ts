import { describe, expect, it } from "vitest";
import {
  allAidtIdeasConfirmed, confirmAidtIdeaFromChat, getAidtIdeaChatProposal, isAidtIdeaChatConfirmed,
  readAidtIdeaChatProposal, saveAidtIdeaChatProposal,
} from "@/features/aidt/lib/aidt-idea-chat";
import { archiveAidtIdea, createAidtIdea, renameAidtIdea } from "@/features/aidt/lib/aidt-idea-handoff";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

const empty: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };
const first = "纸卡展示两种菜品。学生可以快速比较口味。";
const second = "菜单标明甜度。学生可以按喜好筛选。";

describe("AIDT idea Chat output", () => {
  it("only projects an explicit Skill draft after a substantive student turn", () => {
    const greeting = { id: "greet", role: "user", content: "你好！" };
    const idea = { id: "idea", role: "user", content: "我想用纸卡标明口味差异" };
    const proposal = { id: "reply", role: "assistant", content: `### 核心描述\n${first}\n\n### 待学生确认\n你希望保留哪个方向？` };
    expect(readAidtIdeaChatProposal([greeting, proposal])).toBeNull();
    expect(readAidtIdeaChatProposal([idea, { ...proposal, content: "你先说说想法？" }])).toBeNull();
    expect(readAidtIdeaChatProposal([idea, proposal])).toEqual({ messageId: "reply", description: first });
  });

  it("keeps proposals scoped and waits for each active idea's explicit current confirmation", () => {
    const firstCard = createAidtIdea(empty, "a", "纸卡");
    const cards = createAidtIdea(firstCard, "b", "菜单");
    const suggested = saveAidtIdeaChatProposal(cards, "a", { messageId: "reply", description: first });
    expect(getAidtIdeaChatProposal(suggested, "b")).toBeNull();
    expect(allAidtIdeasConfirmed(suggested)).toBe(false);
    expect(suggested.ideas[0]?.description).toBe("");

    const accepted = confirmAidtIdeaFromChat(suggested, "a", first);
    expect(isAidtIdeaChatConfirmed(accepted, "a")).toBe(true);
    expect(allAidtIdeasConfirmed(accepted)).toBe(false);
    const ready = confirmAidtIdeaFromChat(accepted, "b", second);
    expect(allAidtIdeasConfirmed(ready)).toBe(true);
    expect(allAidtIdeasConfirmed(createAidtIdea(ready, "c", "标牌"))).toBe(false);
    expect(allAidtIdeasConfirmed(renameAidtIdea(ready, "a", "新版纸卡"))).toBe(false);
    expect(allAidtIdeasConfirmed(archiveAidtIdea(accepted, "b"))).toBe(true);
    expect(allAidtIdeasConfirmed(archiveAidtIdea(archiveAidtIdea(accepted, "b"), "a"))).toBe(false);
  });
});
