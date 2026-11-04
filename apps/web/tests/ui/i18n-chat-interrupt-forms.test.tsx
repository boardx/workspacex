import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ConfirmIntentCard } from "@/components/agent-interrupts/confirm-intent-card";
import { FillParamsCard } from "@/components/agent-interrupts/fill-params-card";
import { ChooseOptionCard } from "@/components/agent-interrupts/choose-option-card";
import type { ConfirmIntentArgs, ParamField, OptionCard } from "@/lib/agent-interrupts-types";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const intent: ConfirmIntentArgs = { requestId: "request-raw", understanding: "原始任务 {count}", assumptions: ["原始假设 🌍"] };
it("keeps an edited intent and its assumptions through locale changes without submitting a decision", () => {
  const submit = vi.fn(); const approve = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ConfirmIntentCard args={intent} state="default" canWrite initialEditing onContinue={approve} onEditSubmit={submit} /></I18nProvider>);
  const field = screen.getByRole("textbox", { name: "My understanding" });
  const edited = " 用户修改后的任务 {status} 🌍 "; fireEvent.change(field, { target: { value: edited } });
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("textbox", { name: "我的理解" })).toBe(field); expect((field as HTMLTextAreaElement).value).toBe(edited);
  expect(submit).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("agent-interrupt-confirm-intent-edit-submit"));
  expect(submit).toHaveBeenCalledWith({ understanding: edited, assumptions: intent.assumptions }); expect(submit).toHaveBeenCalledTimes(1);
});
it("keeps canonical parameter names and edited values without introducing unsupported ledger-only decisions", () => {
  const field: ParamField = { name: "raw_parameter_key", label: "用户字段 {count}", kind: "text", currentValue: "原始参数值", aiGuess: null, rationale: null, required: true };
  const submit = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><FillParamsCard fields={[field]} state="default" canWrite supportsLedgerOnly={false} onSubmit={submit} /></I18nProvider>);
  expect(screen.getByText("Add task details")).toBeTruthy();
  const input = screen.getByLabelText(field.label); const value = "用户新值 {name} 🌍"; fireEvent.change(input, { target: { value } });
  expect(screen.queryByTestId("agent-interrupt-fill-params-applied-ledger-only")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByLabelText(field.label)).toBe(input); expect((input as HTMLInputElement).value).toBe(value); expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("agent-interrupt-fill-params-submit"));
  expect(submit).toHaveBeenCalledWith({ decision: "edit", fields: [{ name: field.name, value }], appliedTo: "full-rerun" }); expect(submit).toHaveBeenCalledTimes(1);
});
it("localizes option chrome and effort labels while selecting the canonical option ID", () => {
  const options: OptionCard[] = [
    { optionId: "raw-option-A", title: "用户路线A {count}", effort: "低", timeToValue: "用户时间原文", expectedReturn: "用户收益原文" },
    { optionId: "raw-option-B", title: "用户路线B 🌍", effort: "高", timeToValue: "另一时间", expectedReturn: "另一收益" },
  ];
  const select = vi.fn(); const decline = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ChooseOptionCard options={options} state="default" canWrite onSelectConfirm={select} onDecline={decline} /></I18nProvider>);
  expect(screen.getByText("Choose a route and I will continue")).toBeTruthy(); expect(screen.getByText("Low")).toBeTruthy(); expect(options[0]?.effort).toBe("低");
  const option = screen.getByTestId("agent-interrupt-choose-option-option-raw-option-B");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("agent-interrupt-choose-option-option-raw-option-B")).toBe(option); expect(select).not.toHaveBeenCalled(); expect(decline).not.toHaveBeenCalled();
  expect(screen.getByText(options[0]!.title)).toBeTruthy(); fireEvent.click(option);
  expect(select).toHaveBeenCalledWith("raw-option-B"); expect(select).toHaveBeenCalledTimes(1);
});
it("localizes an observer denial while keeping decision actions unavailable", () => {
  const select = vi.fn();
  render(<I18nProvider initialLocale="en"><ChooseOptionCard options={[]} state="default" canWrite={false} onSelectConfirm={select} /></I18nProvider>);
  expect(screen.getByTestId("denied-layer").textContent).toBe("Project restriction: Observers can view these options but cannot choose for the team."); expect(select).not.toHaveBeenCalled();
});
