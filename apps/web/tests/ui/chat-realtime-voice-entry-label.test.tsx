/** @vitest-environment jsdom */
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatRealtimeVoiceEntry, REALTIME_ENTRY_TOOLTIP } from "@/components/chat/chat-realtime-voice-entry";

describe("ChatRealtimeVoiceEntry button", () => {
  it("keeps a visible text label (never icon-only), a call tooltip, and no-wrap sizing", () => {
    render(
      <ChatRealtimeVoiceEntry disabled={false} agent={null} resolveThreadId={async () => "t"} onEnded={() => {}} />,
    );
    const btn = screen.getByTestId("chat-composer-realtime-voice");
    expect(btn.getAttribute("title")).toBeNull();
    const label = screen.getByText("实时对话");
    expect(label.className).not.toMatch(/hidden/);
    expect(btn.className).toMatch(/shrink-0/);
    expect(btn.className).toMatch(/whitespace-nowrap/);
    // e2e TW-P0-5⑤ counts aria-label + text for 语音/麦克风: neither may match.
    expect(`${btn.getAttribute("aria-label")} ${btn.textContent}`).not.toMatch(/麦克风|语音/);
  });

  it("shows the disambiguating tooltip as real DOM on keyboard focus", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    render(
      <ChatRealtimeVoiceEntry disabled={false} agent={null} resolveThreadId={async () => "t"} onEnded={() => {}} />,
    );
    fireEvent.focus(screen.getByTestId("chat-composer-realtime-voice"));
    const tips = await screen.findAllByText(REALTIME_ENTRY_TOOLTIP);
    expect(tips.length).toBeGreaterThan(0);
    expect(REALTIME_ENTRY_TOOLTIP).toMatch(/实时对话/);
    expect(REALTIME_ENTRY_TOOLTIP).toMatch(/语音输入/);
  });
});
