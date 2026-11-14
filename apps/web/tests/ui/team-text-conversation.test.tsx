import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Keep the actual V2UserMessage and Button; only the incompatible vendor CSS is
// omitted, as in the existing canonical message component tests.
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

import { PreviewSessionProvider } from "@/components/session/session-provider";
import { TeamTextConversation, type TeamTextPreviewMessage } from "@/components/project/team-text-conversation";
import { onRememberStatement } from "@/lib/knowledge-graph-events";

const channel = { key: "project:g1", title: "第1组研究", scope: "项目频道" };
type Props = React.ComponentProps<typeof TeamTextConversation>;
function props(overrides: Partial<Props> = {}): Props {
  return {
    channel, channels: [channel], messages: [], draft: "学生自己的讨论", compact: true, readOnly: false,
    onDraftChange: vi.fn(), onSend: vi.fn(), onRetry: vi.fn(), onHistoryRetry: vi.fn(),
    onChooseChannel: vi.fn(), onClose: vi.fn(), ...overrides,
  };
}
function view(value: Props): JSX.Element {
  return <PreviewSessionProvider><TeamTextConversation {...value} /></PreviewSessionProvider>;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("TeamTextConversation actual component", () => {
  it("delegates plain Enter once, preserves Shift+Enter and IME confirmation, and never sends an empty draft", () => {
    const value = props();
    const { rerender } = render(view(value));
    const input = screen.getByRole("textbox", { name: "发给频道成员" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(value.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value.onSend).toHaveBeenCalledTimes(1);
    // Delivery and draft clearing belong to the owner, not a hidden second store.
    expect(input).toHaveValue("学生自己的讨论");
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    expect(value.onDraftChange).toHaveBeenLastCalledWith("第一行\n第二行");
    rerender(view({ ...value, draft: " \n " }));
    expect(screen.getByRole("button", { name: "预览发送给频道成员" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value.onSend).toHaveBeenCalledTimes(1);
  });

  it("blocks sending and retries in read-only states, and keeps history errors distinct from empty history", () => {
    const value = props({ readOnly: true, messages: [{ id: "failed-1", text: "失败原文", state: "failed" }] });
    const { rerender } = render(view(value));
    expect(screen.getByRole("textbox", { name: "发给频道成员" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "预览发送给频道成员" })).toBeDisabled();
    const retry = screen.getByRole("button", { name: "重试预览" });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    fireEvent.submit(screen.getByTestId("team-text-form"));
    fireEvent.keyDown(screen.getByTestId("team-text-input"), { key: "Enter" });
    expect(value.onSend).not.toHaveBeenCalled();
    expect(value.onRetry).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-user-message-text")).toHaveTextContent("失败原文");

    rerender(view({ ...value, historyState: "error" }));
    expect(screen.getByTestId("team-text-history-error")).toBeVisible();
    expect(screen.queryByTestId("team-text-empty")).toBeNull();
    expect(screen.getByRole("button", { name: "重试读取预览" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试读取预览" }));
    expect(value.onHistoryRetry).not.toHaveBeenCalled();

    rerender(view({ ...value, readOnly: false, historyState: "error" }));
    expect(screen.getByTestId("team-text-input")).toBeDisabled();
    fireEvent.submit(screen.getByTestId("team-text-form"));
    expect(value.onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试读取预览" }));
    expect(value.onHistoryRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("team-text-input")).toHaveValue(value.draft);
    rerender(view({ ...value, readOnly: false, historyState: "loading" }));
    expect(screen.getByTestId("team-text-loading")).toBeVisible();
    expect(screen.queryByTestId("team-text-empty")).toBeNull();
    expect(screen.getByTestId("team-text-send")).toBeDisabled();
  });

  it("pages long local history without mutating messages or drafts, then returns to the latest page for a new send", () => {
    const messages: TeamTextPreviewMessage[] = Array.from({ length: 12 }, (_, index) => ({ id: "m" + (index + 1), text: "讨论" + (index + 1), state: "preview" }));
    const original = structuredClone(messages);
    const value = props({ messages, draft: "翻历史时不要丢掉这段草稿" });
    render(view(value));
    const history = screen.getByRole("log", { name: "本频道的本页消息" });
    expect(within(history).getAllByTestId("team-text-message")).toHaveLength(5);
    expect(within(history).getAllByTestId("chat-user-message-text").map(node => node.textContent)).toEqual(["讨论8", "讨论9", "讨论10", "讨论11", "讨论12"]);
    fireEvent.click(screen.getByRole("button", { name: "更早5条" }));
    expect(within(history).getAllByTestId("chat-user-message-text").map(node => node.textContent)).toEqual(["讨论3", "讨论4", "讨论5", "讨论6", "讨论7"]);
    fireEvent.click(screen.getByRole("button", { name: "更早5条" }));
    expect(screen.getByRole("button", { name: "更早5条" })).toBeDisabled();
    expect(within(history).getAllByTestId("chat-user-message-text")[0]).toHaveTextContent("讨论1");
    fireEvent.click(screen.getByRole("button", { name: "较新5条" }));
    expect(within(history).getAllByTestId("chat-user-message-text")[0]).toHaveTextContent("讨论6");
    expect(screen.getByTestId("team-text-input")).toHaveValue(value.draft);
    expect(value.onDraftChange).not.toHaveBeenCalled();
    expect(value.onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "预览发送给频道成员" }));
    expect(value.onSend).toHaveBeenCalledTimes(1);
    expect(within(history).getAllByTestId("chat-user-message-text")[0]).toHaveTextContent("讨论8");
    expect(screen.getByRole("button", { name: "最近5条" })).toBeDisabled();
    expect(messages).toEqual(original);
  });

  it("states the local-only boundary, hides AI actions with the actual component CSS, and only copies locally", async () => {
    // Compile the production component's utility classes instead of treating a
    // class-name string assertion as proof that the AI toolbar is hidden.
    const componentFile = resolve(process.cwd(), "components/project/team-text-conversation.tsx");
    const css = await postcss([tailwindcss({ content: [{ raw: readFileSync(componentFile, "utf8"), extension: "tsx" }], corePlugins: { preflight: false } })]).process("@tailwind utilities;", { from: undefined });
    const style = document.createElement("style");
    style.textContent = css.css;
    document.head.append(style);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const remember = vi.fn();
    const unsubscribe = onRememberStatement(remember);
    try {
      const text = "<script>window.teamTextInjected=true</script>" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(40);
      render(view(props({ messages: [{ id: "local-1", text, state: "preview" }] })));
      const body = screen.getByTestId("chat-user-message-text");
      expect(body.textContent).toBe(text);
      expect(screen.getByTestId("team-text-history").querySelector("script")).toBeNull();
      const wrapping: string[] = [];
      for (let node: HTMLElement | null = body; node && node !== screen.getByTestId("team-text-history"); node = node.parentElement) {
        wrapping.push(getComputedStyle(node).overflowWrap);
      }
      // jsdom cannot measure a phone layout. This checks the compiled production
      // rule; the actual 320/375px overflow claim still needs the browser lane.
      expect(wrapping).toContain("anywhere");
      expect(screen.getByTestId("team-text-boundary")).toHaveTextContent("未发送给其他成员、未写入项目");
      expect(screen.getByTestId("team-text-boundary")).toHaveTextContent("AI不会自动加入频道或将讨论认作成果");
      expect(screen.getByTestId("chat-message-remember")).not.toBeVisible();
      expect(screen.getByRole("button", { name: "复制本条消息" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "复制本条消息" }));
      await waitFor(() => expect(screen.getByTestId("team-text-copy-status")).toHaveTextContent("已复制本条消息"));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(text);
      expect(remember).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      style.remove();
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});
