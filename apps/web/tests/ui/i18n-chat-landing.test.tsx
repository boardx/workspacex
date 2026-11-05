import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ land: vi.fn() }));
vi.mock("@/lib/live-chat", async original => ({ ...(await original<typeof import("@/lib/live-chat")>()), landAsArtifact: calls.land }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { useMessageLanding, MessageLandingPanel } from "@/components/chat/message-landing";
import { CopilotKitV2MessageActionsProvider, CopilotKitV2MessageLandingTrigger, CopilotKitV2MessageLandingPanel } from "@/components/chat/copilotkit-v2-message-actions";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
function CanonicalLanding({ body }: { body: string }) {
  const landing = useMessageLanding({ threadId: "raw-thread", bearer: "unit-fixture" });
  return <CopilotKitV2MessageActionsProvider value={{ identity: { resolve: () => null, resolvePersisted: id => id === "wire-message" ? "stored-message" : null }, agentId: null, agentLabel: null, landing }}>
    <CopilotKitV2MessageLandingTrigger messageId="wire-message" text={body} /><CopilotKitV2MessageLandingPanel messageId="wire-message" text={body} />
  </CopilotKitV2MessageActionsProvider>;
}
beforeEach(() => { calls.land.mockReset(); });
it("initializes only the authored empty-first-line title at explicit open and preserves edits, persisted ID and raw body", async () => {
  let finish: () => void = () => { throw new Error("request not started"); };
  calls.land.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ artifactId: "raw-artifact" }); }));
  const body = "\n模型原文{count}🌍\n```json\n{\"status\":\"pending\"}\n```";
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CanonicalLanding body={body} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save as artifact (draft)" }));
  const input = screen.getByRole("textbox"); expect((input as HTMLInputElement).value).toBe("Untitled artifact");
  const title = " 用户标题{count}🌍 "; fireEvent.change(input, { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByRole("textbox")).toBe(input); expect((input as HTMLInputElement).value).toBe(title); expect(calls.land).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("chat-land-artifact-submit-stored-message"));
  expect(calls.land).toHaveBeenCalledTimes(1); expect(calls.land).toHaveBeenCalledWith("raw-thread", { messageId: "stored-message", mode: "draft", title: title.trim(), payloadRef: body }, "unit-fixture"); expect(input).toBeDisabled();
  await act(async () => finish()); expect(screen.getByTestId("chat-land-artifact-done-stored-message")).toBeTruthy(); expect(calls.land).toHaveBeenCalledTimes(1);
});
it("localizes a persisted known landing failure at render without changing the title or resubmitting", async () => {
  calls.land.mockRejectedValue(new ApiError(403, "FORBIDDEN", {}));
  const body = "模型原始标题{count}\n用户正文🌍";
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CanonicalLanding body={body} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save as artifact (draft)" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm save" }));
  const error = await screen.findByTestId("chat-land-artifact-error-stored-message"); expect(error.textContent).toContain("permission");
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("chat-land-artifact-error-stored-message")).toBe(error); expect(error.textContent).toContain("权限"); expect(screen.getByRole("textbox")).toHaveValue("模型原始标题{count}"); expect(calls.land).toHaveBeenCalledTimes(1);
});
it("keeps expanded saved source text and original title through locale changes", () => {
  const source = "模型原文{status}🌍\n```ts\nconst x = { value: 1 };\n```";
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><MessageLandingPanel message={{ id: "stored-message", text: source }} state={{ status: "done", title: "用户产物名{count}", artifactId: "raw-artifact" }} onTitleChange={vi.fn()} onCancel={vi.fn()} onSubmit={vi.fn()} /></I18nProvider>);
  expect(screen.getByText("Saved as artifact (draft)")).toBeTruthy(); const toggle = screen.getByRole("button", { name: "Expand" }); fireEvent.click(toggle);
  const raw = screen.getByTestId("chat-land-artifact-content-stored-message"); expect(raw.textContent).toBe(source);
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("chat-land-artifact-content-stored-message")).toBe(raw); expect(raw.textContent).toBe(source); expect(screen.getByRole("button", { name: "收起" })).toBe(toggle); expect(screen.getByText("用户产物名{count}")).toBeTruthy();
});
