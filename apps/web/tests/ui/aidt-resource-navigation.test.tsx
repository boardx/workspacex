import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtMaterials } from "@/features/aidt/components/aidt-materials";
import { AidtBoardReturn } from "@/features/aidt/components/aidt-board-return";
import { ApiError } from "@/lib/api-client";

const mocks = vi.hoisted(() => ({ list: vi.fn(), search: "", boardId: "board/1" as string | string[] | undefined }));
const aidtConfig = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({
  isAidtModuleEnabled: () => aidtConfig.enabled,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useParams: () => ({ boardId: mocks.boardId }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org", userId: "student", sessionToken: "token" } }) }));
vi.mock("@/lib/live-project-resources", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/live-project-resources")>(), listProjectResources: mocks.list }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }) }));

const resource = (kind: string, id: string, title: string) => ({ kind, id, title, status: "draft", updatedAt: "2026-11-15T00:00:00Z" });
beforeEach(() => { vi.clearAllMocks(); aidtConfig.enabled = true; mocks.search = ""; mocks.boardId = "board/1"; mocks.list.mockResolvedValue({ items: [] }); });


it("opens existing Design and personal transcription in the originating stage and chat", async () => {
  mocks.list.mockResolvedValue({ items: [resource("design", "design/1", "被测原型"), resource("personal_transcription", "session/1", "个人笔记")] });
  render(<AidtMaterials projectId="group/1" stageNumber={6} thread="thread/6" />);
  expect(await screen.findByRole("link", { name: "被测原型" })).toHaveAttribute("href", "/aidt/group%2F1?step=6&tool=design&resource=design%2F1&thread=thread%2F6");
  expect(screen.getByRole("link", { name: "个人笔记" })).toHaveAttribute("href", "/aidt/group%2F1?step=6&tool=transcript&resource=session%2F1&thread=thread%2F6");
  expect(screen.getByRole("link", { name: /查看原始证据与出处/ })).toHaveAttribute("href", "/aidt/group%2F1?step=6&tool=sources&thread=thread%2F6");
  expect(screen.getByTestId("aidt-personal-transcript-boundary")).toHaveTextContent("不能替代项目访谈的参与者同意");
});

it("adds explicit teaching return context to the actual native Board and survey routes", async () => {
  mocks.list.mockResolvedValue({ items: [resource("whiteboard", "board/1", "研究白板"), resource("survey", "survey/1", "真实问卷材料")] });
  render(<AidtMaterials projectId="group/1" stageNumber={4} thread="thread/4" />);
  expect(await screen.findByRole("link", { name: "研究白板" })).toHaveAttribute("href", "/studio/board/board%2F1?projectId=group%2F1&aidtStep=4&aidtThread=thread%2F4");
  expect(screen.getByRole("link", { name: "真实问卷材料" })).toHaveAttribute("href", "/studio/survey/survey%2F1?projectId=group%2F1&aidtStep=4&aidtThread=thread%2F4");
});

it.each([undefined, 0, 7, 1.5])("keeps the dashboard defaults without binding a thread to guessed stage %s", async (stageNumber) => {
  mocks.list.mockResolvedValue({ items: [resource("design", "design/1", "静态方案"), resource("personal_transcription", "session/1", "个人转录")] });
  render(<AidtMaterials projectId="group" stageNumber={stageNumber} thread="not-a-stage-binding" returnRevision="3" />);
  expect(await screen.findByRole("link", { name: "静态方案" })).toHaveAttribute("href", "/aidt/group?step=5&tool=design&resource=design%2F1");
  expect(screen.getByRole("link", { name: "个人转录" })).toHaveAttribute("href", "/aidt/group?step=2&tool=transcript&resource=session%2F1");
});

it("uses the native breadcrumb to return from Board to the same project, stage and thread", () => {
  mocks.search = "projectId=group%2F1&aidtStep=4&aidtThread=thread%2F4&focusArtifact=artifact-1";
  const { rerender } = render(<AidtBoardReturn />);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/aidt/group%2F1?step=4&tool=whiteboard&resource=board%2F1&thread=thread%2F4");
  aidtConfig.enabled = false; rerender(<AidtBoardReturn />);
  expect(screen.queryByTestId("project-breadcrumb-back")).toBeNull();
});

it("keeps authorization failure distinct from empty and preserves native links on retry", async () => {
  mocks.list.mockRejectedValueOnce(new ApiError(403, "PROJECT_ROLE_REQUIRED", "PROJECT_ROLE_REQUIRED"));
  mocks.list.mockResolvedValueOnce({ items: [resource("whiteboard", "board/1", "有权读取后返回的白板")] });
  render(<AidtMaterials projectId="group" stageNumber={3} thread="thread-3" />);
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText(/当前没有已关联资料/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新读取资料" }));
  expect(await screen.findByRole("link", { name: "有权读取后返回的白板" })).toHaveAttribute("href", "/studio/board/board%2F1?projectId=group&aidtStep=3&aidtThread=thread-3");
});

it("accepts the Chat host's validated returnTo and retains the actual Board id", () => {
  const returnTo = "/aidt/group?step=6&tool=whiteboard&thread=thread-6&resource=untrusted-resource";
  mocks.search = new URLSearchParams({ projectId: "group", returnTo }).toString();
  render(<AidtBoardReturn />);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/aidt/group?step=6&tool=whiteboard&resource=board%2F1&thread=thread-6");
});

it.each([
  "https://evil.test/aidt/group?step=4", "//evil.test/aidt/group?step=4", "/%252f%252fevil.test",
  "/aidt/another-project?step=4", "/aidt/group?step=7", "/aidt/group?step=4&step=5",
])("leaves Board itself untouched for an unsafe or mismatched returnTo: %s", (returnTo) => {
  mocks.search = new URLSearchParams({ projectId: "group", returnTo, aidtStep: "4" }).toString();
  render(<AidtBoardReturn />); expect(screen.queryByTestId("project-breadcrumb-back")).toBeNull();
});

it("does not trust a query resource in place of the real Board route parameter", () => {
  mocks.search = new URLSearchParams({ projectId: "group", returnTo: "/aidt/group?step=4&resource=spoof", resource: "spoof" }).toString();
  mocks.boardId = undefined; const { rerender } = render(<AidtBoardReturn />); expect(screen.queryByTestId("project-breadcrumb-back")).toBeNull();
  mocks.boardId = ["ambiguous", "board"]; rerender(<AidtBoardReturn />); expect(screen.queryByTestId("project-breadcrumb-back")).toBeNull();
});

it("retains the saved learning round across materials, native Board return and evidence tools", async () => {
  mocks.list.mockResolvedValue({ items: [resource("design", "d", "静态方案"), resource("personal_transcription", "s", "笔记"), resource("whiteboard", "b", "白板")] });
  render(<AidtMaterials projectId="group" stageNumber={2} thread="t" returnRevision="3" />);
  for (const title of ["静态方案", "笔记", /查看原始证据与出处/]) {
    const href = (await screen.findByRole("link", { name: title })).getAttribute("href")!;
    expect(new URL(href, "https://workspace.invalid").searchParams.get("returnRevision")).toBe("3");
  }
  const board = new URL(screen.getByRole("link", { name: "白板" }).getAttribute("href")!, "https://workspace.invalid");
  expect(board.searchParams.get("aidtReturnRevision")).toBe("3");
  mocks.search = board.search;
  render(<AidtBoardReturn />);
  expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/aidt/group?step=2&tool=whiteboard&resource=board%2F1&thread=t&returnRevision=3");
});
it("hides the breadcrumb for duplicate native-resource learning-round hints", () => {
  mocks.search = "projectId=group&aidtStep=2&aidtReturnRevision=3&aidtReturnRevision=4";
  render(<AidtBoardReturn />);
  expect(screen.queryByTestId("project-breadcrumb-back")).toBeNull();
});
