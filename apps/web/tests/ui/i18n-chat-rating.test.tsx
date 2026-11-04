import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { skills } from "@repo/contracts";
const calls = vi.hoisted(() => ({ rate: vi.fn() }));
vi.mock("@/lib/live-message-rating", () => ({ rateMessage: calls.rate }));
import { MessageRating } from "@/components/chat/message-rating";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
beforeEach(() => { calls.rate.mockReset(); });
it("preserves feedback draft and exact server-attributed payload while a rating is pending", async () => {
  let finish: () => void = () => { throw new Error("rating not started"); };
  calls.rate.mockImplementation(() => new Promise(resolve => { finish = () => resolve(skills.operations.rateMessage.out.parse({ ratingId: "raw-rating", attribution: { agentId: "raw-agent", skillId: null, skillVersionId: null } })); }));
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><MessageRating messageId="raw-message" revealOnHover={false} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Needs improvement" })); const reason = screen.getByRole("textbox", { name: "Reason for improvement" });
  const text = " 用户评价{status}🌍 "; fireEvent.change(reason, { target: { value: text } });
  const button = screen.getByRole("button", { name: "Submit" }); fireEvent.click(button); fireEvent.click(button);
  expect(calls.rate).toHaveBeenCalledTimes(1); expect(calls.rate).toHaveBeenCalledWith({ messageId: "raw-message", verdict: "down", reason: text.trim() });
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByRole("textbox", { name: "待改进的理由" })).toBe(reason); expect((reason as HTMLInputElement).value).toBe(text); expect(button).toBeDisabled(); expect(calls.rate).toHaveBeenCalledTimes(1);
  await act(async () => finish()); expect(screen.getByTestId("chat-message-rating-done").textContent).toContain("已记录：待改进"); expect(screen.getByTestId("chat-message-rating-unattributed")).toBeTruthy(); expect(calls.rate).toHaveBeenCalledTimes(1);
});
it("keeps failed rating text raw and translates its wrapper without retrying on a language change", async () => {
  calls.rate.mockRejectedValue(new Error("用户错误原文{count}🌍"));
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><MessageRating messageId="raw-message" revealOnHover={false} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Helpful" })); const error = await screen.findByTestId("chat-message-rating-error");
  expect(error.textContent).toContain("Rating could not be recorded"); expect(error.textContent).toContain("Error: 用户错误原文{count}🌍");
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("chat-message-rating-error")).toBe(error); expect(error.textContent).toContain("Error: 用户错误原文{count}🌍"); expect(calls.rate).toHaveBeenCalledTimes(1);
});
