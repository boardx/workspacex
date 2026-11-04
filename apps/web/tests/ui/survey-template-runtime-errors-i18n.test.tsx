import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { httpFailureText } from "@/lib/http-failure-text";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { SurveyConflictError, SurveySystemError } from "@/lib/survey/runtime-client";
import { SurveyTemplateLibrary } from "@/components/survey/library/template-library";
import { SurveyTemplateWorkspace } from "@/components/survey/library/template-workspace";
import { SurveyTemplateActions } from "@/components/survey/library/template-actions";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/survey/runtime-client")>(), surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
beforeEach(() => request.mockReset());
afterEach(cleanup);
const cases = (["library", "workspace", "reuse"] as const).flatMap(surface => (["conflict", "forbidden"] as const).map(kind => ({ surface, kind })));
it.each(cases)("keeps the real $kind Error through the $surface boundary and changes only its displayed language", async ({ surface, kind }) => {
  const error = kind === "conflict" ? new SurveyConflictError(null) : new SurveySystemError(surveyRuntimeMessages.network, { cause: new ApiError(403, "RAW_PERMISSION_CODE", {}) }); request.mockRejectedValueOnce(error);
  const component = surface === "library" ? <SurveyTemplateLibrary kind="question" /> : surface === "workspace" ? <SurveyTemplateWorkspace templateId="saved" kind="question" /> : <SurveyTemplateActions kind="question" draft={{ title: "原问卷 {count}", questions: [], template: { id: "raw-report", title: "原报告 {count}", sections: [] } }} onApply={vi.fn()} />;
  render(<I18nProvider initialLocale="zh-CN"><Driver />{component}</I18nProvider>); if (surface === "reuse") fireEvent.click(screen.getByRole("button", { name: "使用问卷模板" })); await screen.findByRole("alert"); act(() => setLocale("en"));
  expect(screen.getByRole("alert")).toHaveTextContent(kind === "conflict" ? "The data has changed. Refresh and try again. Your unsaved changes are retained." : httpFailureText(403, "en")); expect(screen.getByRole("alert")).not.toHaveTextContent("RAW_PERMISSION_CODE"); expect(request).toHaveBeenCalledTimes(1);
  act(() => setLocale("zh-CN")); expect(screen.getByRole("alert")).toHaveTextContent(kind === "conflict" ? surveyRuntimeMessages.conflict : httpFailureText(403, "zh-CN")); expect(request).toHaveBeenCalledTimes(1); expect(error.message).toBe(kind === "conflict" ? surveyRuntimeMessages.conflict : surveyRuntimeMessages.network); if (kind === "forbidden") expect(error.cause).toBeInstanceOf(ApiError);
});
