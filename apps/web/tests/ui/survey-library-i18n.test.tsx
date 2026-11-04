import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { SurveyLibraryTemplateSchema } from "@repo/contracts/survey-template-library";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { LiveSurveyLibrary } from "@/components/survey/live/survey-library";
import { CreateSurveyDialog } from "@/components/survey/live/create-survey-dialog";

const request = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const link = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("@/lib/live-project-resources", () => ({ linkProjectResource: link }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const rawName = "原始 survey {count}";
const rawTag = "原标签 {name}";
const rawQuestion = "原始问题 {count}?";
const question = { id: "q1", title: rawQuestion, type: "open", chapterId: "general", order: 1, required: true, options: [] };
function survey(status = "draft") {
  return SurveyRuntimeSchema.parse({
    id: "survey-raw", title: rawName, tags: [rawTag], version: 3, status,
    anonymity: "anonymous", answerRevision: 0, updatedAt: "2026-11-04T00:00:00.000Z",
    questions: [question], template: { id: "report-raw", title: "原报告 {count}", sections: [] },
    responses: [], publication: status === "collecting" || status === "closed" ? {
      token: "raw-public-token", status: status === "closed" ? "closed" : "collecting", questions: [question], version: 3, expiresAt: "2026-12-01T00:00:00.000Z",
    } : null,
    report: null, reportBasisVersion: null, reportBasisAnswerRevision: null, reportGeneratedAt: null,
  });
}
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function show(children: React.ReactNode, locale: Locale = "zh-CN") {
  return render(<I18nProvider initialLocale={locale}><Driver />{children}</I18nProvider>);
}
function language(locale: Locale) { act(() => setLocale(locale)); }
beforeEach(() => { request.mockReset(); push.mockReset(); link.mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([["draft", "Draft"], ["ready", "Ready to publish"], ["collecting", "Published"], ["closed", "Stopped"]])(
  "renders the actual %s card status in English without changing raw content or fetching again", async (status, label) => {
    request.mockResolvedValue([survey(status)]);
    show(<LiveSurveyLibrary projectId="raw/project" />);
    const row = await screen.findByTestId("survey-card-survey-raw");
    language("en");
    expect(screen.getByRole("heading", { name: "Surveys" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Survey navigation" })).toBeVisible();
    expect(screen.getByTestId("survey-status-survey-raw")).toHaveTextContent(label);
    expect(row).toHaveTextContent(rawName);
    expect(row).toHaveTextContent(rawQuestion);
    expect(row).toHaveTextContent(rawTag);
    expect(row).toHaveTextContent("Questions: 1 · Responses: 0 (valid: 0)");
    expect(request).toHaveBeenCalledTimes(1);
    expect(link).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Question templates" })).toHaveAttribute("href", "/studio/survey?tab=modules");
    expect(screen.getByRole("link", { name: "Report templates" })).toHaveAttribute("href", "/studio/survey?tab=reports");
  },
);

it("retains the search input, matching card and literal route across a locale change", async () => {
  request.mockResolvedValue([survey()]); show(<LiveSurveyLibrary projectId="raw/project" />);
  const row = await screen.findByTestId("survey-card-survey-raw");
  const input = screen.getByRole("textbox", { name: "搜索问卷" });
  fireEvent.change(input, { target: { value: "原始" } });
  language("en");
  expect(screen.getByRole("textbox", { name: "Search surveys" })).toBe(input);
  expect(input).toHaveValue("原始");
  expect(screen.getByTestId("survey-card-survey-raw")).toBe(row);
  fireEvent.click(within(row).getByRole("button", { name: "Continue designing" }));
  expect(push).toHaveBeenCalledWith("/studio/survey/survey-raw/design?projectId=raw%2Fproject");
  expect(request).toHaveBeenCalledTimes(1);
});

it("retranslates load recovery while retaining an unknown diagnostic and requiring explicit reload", async () => {
  request.mockRejectedValueOnce(new Error("constructor {count} 原诊断")).mockResolvedValueOnce([]);
  show(<LiveSurveyLibrary />);
  const alert = await screen.findByRole("alert"); language("en");
  expect(alert).toHaveTextContent("Surveys could not be loaded");
  expect(alert).toHaveTextContent("constructor {count} 原诊断");
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(within(alert).getByRole("button", { name: "Reload" }));
  await screen.findByRole("heading", { name: "No surveys yet" });
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("textbox", { name: "Search surveys" })).toHaveFocus();
});

it("retains AI creation fields and mode, then navigates with raw metadata without creating early", async () => {
  request.mockResolvedValue([]); show(<LiveSurveyLibrary projectId="raw/project" />);
  await screen.findByRole("heading", { name: "还没有问卷" });
  fireEvent.click(screen.getByTestId("survey-create-primary"));
  const name = screen.getByRole("textbox", { name: "问卷名称" });
  fireEvent.change(name, { target: { value: rawName } });
  fireEvent.change(screen.getByTestId("survey-create-tag-input"), { target: { value: rawTag } });
  fireEvent.click(screen.getByRole("radio", { name: /AI 导入创建/ }));
  language("en");
  expect(screen.getByRole("heading", { name: "New survey" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Survey name" })).toBe(name);
  expect(name).toHaveValue(rawName);
  expect(screen.getByTestId("survey-create-tag-input")).toHaveValue(rawTag);
  expect(screen.getByRole("radio", { name: /Create with AI/ })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  const url = new URL(push.mock.calls[0]![0], "http://localhost");
  expect(url.pathname).toBe("/studio/survey/new/import");
  expect(url.searchParams.get("projectId")).toBe("raw/project");
  expect(JSON.parse(url.searchParams.get("draft")!)).toEqual({ name: rawName, tags: [rawTag] });
  expect(request).toHaveBeenCalledTimes(1);
  expect(link).not.toHaveBeenCalled();
});

it("creates once with a current-language report default while preserving a pending raw draft", async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const created = vi.fn();
  show(<CreateSurveyDialog open onOpenChange={vi.fn()} onCreated={created} />);
  const input = screen.getByRole("textbox", { name: "问卷名称" });
  fireEvent.change(input, { target: { value: rawName } });
  fireEvent.change(screen.getByTestId("survey-create-tag-input"), { target: { value: rawTag } });
  language("en");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![1].body).toMatchObject({ title: rawName, tags: [rawTag], questions: [], template: { title: "原始 survey {count} analysis report", sections: [] } });
  language("zh-CN"); language("en");
  expect(input).toHaveValue(rawName);
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  expect(created).not.toHaveBeenCalled();
  await act(async () => finish(survey()));
  expect(created).toHaveBeenCalledWith("survey-raw", "blank");
  expect(request).toHaveBeenCalledTimes(1);
});

it("retranslates an existing local template validation error without clearing input or refetching", async () => {
  request.mockResolvedValue([]);
  show(<CreateSurveyDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "问卷名称" }), { target: { value: rawName } });
  fireEvent.click(screen.getByRole("radio", { name: /从模板创建/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请选择包含题目的问卷模板。");
  language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Select a survey template that contains questions.");
  expect(screen.getByRole("textbox", { name: "Survey name" })).toHaveValue(rawName);
  expect(screen.getByRole("combobox", { name: "Select survey template" })).toHaveValue("");
  expect(request).toHaveBeenCalledTimes(1);
});

it("retains a selected authored template and copies its report instead of applying a new default", async () => {
  const template = SurveyLibraryTemplateSchema.parse({
    id: "template-raw", kind: "question", title: "原模板 {count}", description: "原说明", version: 2,
    updatedAt: "2026-11-04T00:00:00.000Z", questions: [question],
    template: { id: "template-report", title: "原报告 {count}", sections: [] },
  });
  request.mockResolvedValueOnce([template]).mockResolvedValueOnce(survey());
  const created = vi.fn(); show(<CreateSurveyDialog open onOpenChange={vi.fn()} onCreated={created} />);
  fireEvent.change(screen.getByRole("textbox", { name: "问卷名称" }), { target: { value: rawName } });
  fireEvent.click(screen.getByRole("radio", { name: /从模板创建/ }));
  await screen.findByRole("option", { name: "原模板 {count}" });
  const select = screen.getByRole("combobox", { name: "选择问卷模板" });
  fireEvent.change(select, { target: { value: "template-raw" } }); language("en");
  expect(screen.getByRole("combobox", { name: "Select survey template" })).toBe(select);
  expect(select).toHaveValue("template-raw");
  expect(screen.getByRole("option", { name: "原模板 {count}" })).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith("survey-raw", "template"));
  expect(request.mock.calls[1]![1].body).toMatchObject({
    title: rawName,
    questions: [{ id: "q1", title: rawQuestion, provenance: { source: "template", sourceId: "template-raw" } }],
    template: { id: "template-report", title: "原报告 {count}", sections: [] },
  });
  expect(request).toHaveBeenCalledTimes(2);
});

it("translates the explicit delete confirmation without adding an implicit delete", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  request.mockResolvedValue([survey()]); show(<LiveSurveyLibrary />, "en");
  const row = await screen.findByTestId("survey-card-survey-raw");
  fireEvent.pointerDown(within(row).getByRole("button", { name: "More actions: 原始 survey {count}" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete survey" }));
  expect(confirm).toHaveBeenCalledWith("Delete this survey, its responses and report? This cannot be undone.");
  expect(request).toHaveBeenCalledTimes(1);
});
