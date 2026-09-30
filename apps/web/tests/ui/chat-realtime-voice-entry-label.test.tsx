/** @vitest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatRealtimeVoiceEntry } from "@/components/chat/chat-realtime-voice-entry";

describe("ChatRealtimeVoiceEntry button", () => {
  it("keeps a visible text label (never icon-only), a call tooltip, and no-wrap sizing", () => {
    render(
      <ChatRealtimeVoiceEntry disabled={false} agent={null} resolveThreadId={async () => "t"} onEnded={() => {}} />,
    );
    const btn = screen.getByTestId("chat-composer-realtime-voice");
    expect(btn.getAttribute("title")).toBe("和数字人语音通话（实时对话）");
    const label = screen.getByText("实时对话");
    expect(label.className).not.toMatch(/hidden/);
    expect(btn.className).toMatch(/shrink-0/);
    expect(btn.className).toMatch(/whitespace-nowrap/);
    // e2e TW-P0-5⑤ counts aria-label + text for 语音/麦克风: neither may match.
    expect(`${btn.getAttribute("aria-label")} ${btn.textContent}`).not.toMatch(/麦克风|语音/);
  });
});
