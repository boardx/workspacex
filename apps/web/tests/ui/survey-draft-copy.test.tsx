import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createSurveyQuestion } from "@repo/contracts/survey-question-types";
import { type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { SurveyDraftCopy } from "@/components/survey/live/survey-draft-copy";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
const original = {
  id: "original", title: "发布问卷", tags: ["体验"], anonymity: "anonymous",
  questions: [{ ...createSurveyQuestion("short", "newer", 1), title: "较新草稿题目" }],
  publication: { questions: [{ ...createSurveyQuestion("short", "frozen", 1), title: "已发布题目" }], token: "old-link" },
  template: { id: "template", title: "可选报告", sections: [] }, responses: [{ id: "old-answer" }],
} as unknown as SurveyRuntime;
beforeEach(() => request.mockReset());

it("copies frozen questions into a distinct draft without copying answers or mutating the original", async () => {
  const onCreated = vi.fn(); request.mockResolvedValueOnce({ id: "new-draft" });
  render(<SurveyDraftCopy runtime={original} onCreated={onCreated} />);
  fireEvent.click(screen.getByRole("button", { name: "复制为新草稿" }));
  fireEvent.click(screen.getByRole("button", { name: "确认创建新草稿" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-draft"));
  const body = request.mock.calls[0]![1].body;
  expect(body).toEqual({ anonymity: "anonymous", draft: { title: "发布问卷（新草稿）", tags: ["体验"], questions: original.publication!.questions, template: original.template } });
  expect(body.draft).not.toHaveProperty("responses");
  expect(body.draft).not.toHaveProperty("publication");
  expect(original.publication!.token).toBe("old-link");
  expect(original.questions[0]!.title).toBe("较新草稿题目");
});

it("retains the original and allows an explicit retry when creation fails", async () => {
  const onCreated = vi.fn(); request.mockRejectedValueOnce(new Error("暂时不可用"));
  render(<SurveyDraftCopy runtime={original} onCreated={onCreated} />);
  fireEvent.click(screen.getByRole("button", { name: "复制为新草稿" }));
  fireEvent.click(screen.getByRole("button", { name: "确认创建新草稿" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时不可用");
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "确认创建新草稿" })).toBeEnabled();
});
