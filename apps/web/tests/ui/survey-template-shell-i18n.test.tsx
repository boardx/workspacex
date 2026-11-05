import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { SurveyTemplateEditorShell } from "@/components/survey/templates/survey-template-editor-shell";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
afterEach(() => { cleanup(); router.push.mockReset(); });
it("translates only the legacy component chrome and retains its existing local preview state; this is not persisted saving", () => {
  render(<I18nProvider initialLocale="zh-CN"><Driver /><SurveyTemplateEditorShell templateId="tpl-team-health" /></I18nProvider>); const first = screen.getAllByTestId(/^survey-template-section-(?!list$)/)[0]; fireEvent.click(screen.getByTestId("survey-template-save")); act(() => setLocale("en"));
  expect(screen.getByRole("button", { name: "Preview template" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Save template" })).toBeInTheDocument(); expect(screen.getByTestId("survey-template-saved")).toHaveTextContent("Template saved"); expect(screen.getByRole("heading", { name: "团队协作健康度报告模块" })).toBeInTheDocument(); expect(screen.getAllByTestId(/^survey-template-section-(?!list$)/)[0]).toBe(first); expect(screen.getAllByTestId(/^survey-template-section-(?!list$)/)).toHaveLength(6); fireEvent.click(screen.getByRole("button", { name: "Back to list" })); expect(router.push).toHaveBeenCalledWith("/studio/survey?tab=reports");
});
