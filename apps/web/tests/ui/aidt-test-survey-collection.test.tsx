import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AidtTestSurveyCollection } from "@/features/aidt/components/aidt-test-survey-collection";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { sessionToken: "student-session" } }),
}));
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: read }));

it("links native publish and results and pins only an included answer from the linked Survey", async () => {
  read.mockResolvedValue({
    id: "native-survey",
    publication: { status: "collecting", token: "native-public" },
    responses: [
      { id: "authorized-answer", submittedAt: "2026-11-21T00:00:00.000Z", submitter: "not copied" },
      { id: "excluded-answer", submittedAt: "2026-11-21T00:00:00.000Z", analysis: "excluded" },
    ],
  });
  const onSelect = vi.fn();
  render(<AidtTestSurveyCollection projectId="p1" surveyId="native-survey" canEdit onSelect={onSelect} />);
  expect(await screen.findByText("收集中 · 1 份可用答卷")).toBeVisible();
  expect(screen.getByRole("link", { name: "打开问卷发布" })).toHaveAttribute("href", "/studio/survey/native-survey/publish?projectId=p1");
  expect(screen.getByRole("link", { name: "查看原生答卷" })).toHaveAttribute("href", "/studio/survey/native-survey/responses?projectId=p1");
  expect(screen.getByRole("link", { name: "打开填写链接" })).toHaveAttribute("href", "/surveys/native-public");
  fireEvent.change(screen.getByRole("combobox", { name: "选择本测试的答卷证据" }), { target: { value: "authorized-answer" } });
  expect(onSelect).toHaveBeenCalledWith("authorized-answer", "答卷 authorized-answer");
  expect(screen.queryByText("not copied")).toBeNull();
});

it("withholds prior publication and answers across resource changes and denied readback", async () => {
  read.mockResolvedValueOnce({ id: "survey-a", publication: { status: "collecting", token: "a-token" }, responses: [] })
    .mockRejectedValueOnce(new Error("forbidden"));
  const { rerender } = render(<AidtTestSurveyCollection projectId="p1" surveyId="survey-a" canEdit />);
  expect(await screen.findByRole("link", { name: "打开填写链接" })).toBeVisible();
  rerender(<AidtTestSurveyCollection projectId="p1" surveyId="survey-b" canEdit />);
  expect(screen.queryByRole("link", { name: "打开填写链接" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("无法读取关联问卷"));
  expect(screen.queryByRole("combobox")).toBeNull();
});
