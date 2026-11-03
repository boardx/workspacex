import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntityLocalizationAdminView } from "@repo/contracts/entity-localization";
import { EntityLocalizationEditor } from "@/components/localization/entity-localization-editor";
import { I18nProvider } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { getEntityLocalization, putEntityLocalization, clearEntityLocalization } from "@/lib/entity-localization";
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => null }));
vi.mock("@/lib/entity-localization", () => ({
  getEntityLocalization: vi.fn(), putEntityLocalization: vi.fn(), clearEntityLocalization: vi.fn(), setEntitySourceLocale: vi.fn(),
}));
const initial = EntityLocalizationAdminView.parse({
  source: { orgId: "org", entityId: "skill-a", kind: "skill", revision: "v1", locale: "zh-CN", fields: { name: "原文名称", summary: "原文简介" } },
  translation: null,
});
function readyTranslation(name: string) {
  return EntityLocalizationAdminView.parse({ ...initial, translation: {
    orgId: "org", entityId: "skill-a", kind: "skill", sourceRevision: "v1", locale: "en", revision: 1, status: "reviewed", fields: { name },
  } });
}
function view(entityId = "skill-a", locale: "zh-CN" | "en" = "en") {
  return <I18nProvider initialLocale={locale}><EntityLocalizationEditor kind="skill" entityId={entityId} /></I18nProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEntityLocalization).mockResolvedValue(initial);
  vi.mocked(putEntityLocalization).mockResolvedValue(readyTranslation("English name"));
});
describe("display translation editor", () => {
  it("shows source text read-only, saves only explicit translations, and has English labels", async () => {
    render(view());
    const input = await screen.findByLabelText("Name translation");
    expect(screen.getByLabelText("Name original")).toHaveValue("原文名称");
    expect(screen.getByLabelText("Name original")).toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "English name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save translation" }));
    await waitFor(() => expect(putEntityLocalization).toHaveBeenCalledWith("skill", "skill-a", "en", expect.objectContaining({ sourceRevision: "v1", expectedTranslationRevision: null, fields: expect.objectContaining({ name: "English name" }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Translation saved");
    expect(screen.getByLabelText("Name original")).toHaveValue("原文名称");
  });
  it("keeps entered text when a concurrent source/translation update returns 409", async () => {
    vi.mocked(putEntityLocalization).mockRejectedValue(new ApiError(409, "SOURCE_CHANGED", {}));
    render(view());
    fireEvent.change(await screen.findByLabelText("Name translation"), { target: { value: "Keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save translation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed");
    expect(screen.getByLabelText("Name translation")).toHaveValue("Keep my draft");
  });
  it("clears a translation without changing original fields", async () => {
    vi.mocked(getEntityLocalization).mockResolvedValue(readyTranslation("English name"));
    vi.mocked(clearEntityLocalization).mockResolvedValue(EntityLocalizationAdminView.parse({ ...initial, translation: { ...readyTranslation("English name").translation!, revision: 2, status: "draft", fields: {} } }));
    render(view());
    await screen.findByDisplayValue("English name");
    fireEvent.click(screen.getByRole("button", { name: "Remove translation" }));
    await waitFor(() => expect(clearEntityLocalization).toHaveBeenCalledWith("skill", "skill-a", "en", { sourceRevision: "v1", expectedTranslationRevision: 1 }));
    expect(screen.getByLabelText("Name original")).toHaveValue("原文名称");
    await waitFor(() => expect(screen.getByLabelText("Name translation")).toHaveValue(""));
  });
  it("displays a localized permission refusal without an editable form", async () => {
    vi.mocked(getEntityLocalization).mockRejectedValue(new ApiError(403, "ROLE_INSUFFICIENT", {}));
    render(view("skill-a", "zh-CN"));
    expect(await screen.findByRole("alert")).toHaveTextContent("无权");
    expect(screen.queryByTestId("entity-localization-name")).not.toBeInTheDocument();
  });
  it("does not paint an old response after switching entity", async () => {
    let complete!: (value: EntityLocalizationAdminView) => void;
    vi.mocked(getEntityLocalization).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const rendered = render(view());
    await waitFor(() => expect(getEntityLocalization).toHaveBeenCalledTimes(1));
    const other = EntityLocalizationAdminView.parse({ ...initial, source: { ...initial.source, entityId: "skill-b", fields: { ...initial.source.fields, name: "另一原文" } } });
    vi.mocked(getEntityLocalization).mockResolvedValue(other);
    rendered.rerender(view("skill-b"));
    expect(await screen.findByDisplayValue("另一原文")).toBeVisible();
    complete(initial);
    await waitFor(() => expect(screen.queryByDisplayValue("原文名称")).not.toBeInTheDocument());
  });
});
