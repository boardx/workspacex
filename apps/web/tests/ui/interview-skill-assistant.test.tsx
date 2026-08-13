import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import { createMockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";

describe("F04 访谈 Skill 助手", () => {
  beforeEach(() => localStorage.clear());

  it("建议不会自动改主题，应用后生效并可撤销", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "采购访谈", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);

    const topic = await screen.findByTestId("itv-topic-input");
    fireEvent.change(topic, { target: { value: "原始主题" } });
    fireEvent.change(screen.getByTestId("itv-skill-input"), {
      target: { value: "帮我把主题改得更可验证" },
    });
    fireEvent.click(screen.getByTestId("itv-skill-send"));

    expect(screen.getByTestId("itv-topic-input")).toHaveValue("原始主题");
    expect(await screen.findByTestId("itv-skill-suggestion")).toHaveTextContent("建议主题");
    fireEvent.click(screen.getByTestId("itv-skill-apply"));
    await waitFor(() => expect(screen.getByTestId("itv-topic-input")).not.toHaveValue("原始主题"));

    fireEvent.click(screen.getByTestId("itv-skill-undo"));
    expect(screen.getByTestId("itv-topic-input")).toHaveValue("原始主题");
  });
});
