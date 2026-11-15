import * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";

type Identity = { currentOrgId: string; userId: string; sessionToken: string };
type Reader = { result: string | null; onload: (() => void) | null; readAsDataURL: () => void };
const mocks = vi.hoisted(() => ({ search: "tool=outcome", session: { currentOrgId: "org-a", userId: "student-a", sessionToken: "token-a" } as Identity | null, list: vi.fn(), readers: [] as Reader[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<unknown>) => {
  const source = loader.toString();
  return function DynamicStub() {
    const [mountedActor] = React.useState(() => mocks.session?.userId);
    return source.includes("detail-screen") ? <div data-testid="native-design">{mountedActor}</div> : source.includes("transcription-history") ? <div data-testid="native-rec" /> : <div data-testid="native-chat">{mountedActor}</div>;
  };
} }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/components/aidt-materials", () => ({ AidtMaterials: () => null }));
vi.mock("@/components/project/project-resource-section", () => ({ ProjectResourceSection: () => <div data-testid="native-resources" />, projectResourceHref: () => "/source", describeProjectResourceFailure: () => "资源读取失败" }));
vi.mock("@/components/project/project-evidence-section", () => ({ ProjectEvidenceSection: () => null }));
vi.mock("@/components/project/project-conversations", () => ({ ProjectConversations: () => <div data-testid="readonly-conversations" /> }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockReset(); mocks.search = "tool=outcome"; mocks.session = { currentOrgId: "org-a", userId: "student-a", sessionToken: "token-a" }; mocks.readers = [];
  mocks.list.mockResolvedValue({ items: [{ id: "design-a", kind: "design" }] });
  vi.stubGlobal("FileReader", class {
    result: string | null = null;
    onload: (() => void) | null = null;
    constructor() { mocks.readers.push(this); }
    readAsDataURL() { /* The test releases the pending local read explicitly. */ }
  });
});
afterEach(() => vi.unstubAllGlobals());

it("clears another actor's drafts and remounts native Chat even when the project ID is unchanged", () => {
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-1" canWrite />);
  fireEvent.change(screen.getByLabelText("初始问题"), { target: { value: "A组员自己的初稿" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 引导师" }));
  expect(screen.getByTestId("native-chat")).toHaveTextContent("student-a");
  mocks.session = { ...mocks.session!, userId: "student-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("");
  expect(screen.getByTestId("native-chat")).toHaveTextContent("student-b");
  expect(screen.getByTestId("aidt-assistant-panel")).not.toBeVisible();
});
it("does not carry local drafts across organizations but preserves them on same-actor token refresh", () => {
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-1" canWrite />);
  fireEvent.change(screen.getByLabelText("初始问题"), { target: { value: "同一学生的未发送草稿" } });
  mocks.session = { ...mocks.session!, sessionToken: "refreshed-token" };
  rerender(<ProjectAidt projectId="group" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("同一学生的未发送草稿");
  mocks.session = { ...mocks.session!, currentOrgId: "org-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("");
});
it("rechecks resource access for a new actor before mounting the native editor", async () => {
  mocks.search = "tool=design&resource=design-a";
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-6" canWrite />);
  await screen.findByTestId("native-design");
  let finish!: (value: { items: never[] }) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.session = { ...mocks.session!, userId: "student-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-6" canWrite />);
  expect(screen.queryByTestId("native-design")).toBeNull();
  await act(async () => finish({ items: [] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未关联当前项目");
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it("does not let an old actor's delayed successful association replace the current actor's denial", async () => {
  mocks.search = "tool=design&resource=design-a";
  let oldFinish!: (value: { items: { id: string; kind: string }[] }) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }));
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-6" canWrite />);
  mocks.list.mockResolvedValueOnce({ items: [] });
  mocks.session = { ...mocks.session!, currentOrgId: "org-b", sessionToken: "token-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-6" canWrite />);
  await screen.findByRole("alert");
  await act(async () => oldFinish({ items: [{ id: "design-a", kind: "design" }] }));
  expect(screen.queryByTestId("native-design")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("未关联当前项目");
});
it("invalidates an old association on token rotation and does not read resources when signed out", async () => {
  mocks.search = "tool=design&resource=design-a";
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-6" canWrite />);
  await screen.findByTestId("native-design");
  mocks.list.mockRejectedValueOnce(new Error("revoked"));
  mocks.session = { ...mocks.session!, sessionToken: "token-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-6" canWrite />);
  expect(screen.queryByTestId("native-design")).toBeNull();
  expect(await screen.findByRole("alert")).toHaveTextContent("资源读取失败");
  mocks.session = null;
  rerender(<ProjectAidt projectId="group" sub="aidt-6" canWrite={false} />);
  expect(screen.getByText("登录后可查看关联资源。")).toBeVisible();
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it.each(["actor", "permission"] as const)("ignores a local image read completed after %s scope changed", async (change) => {
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-4" canWrite />);
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [new File(["test"], "test.png", { type: "image/png" })] } });
  expect(mocks.readers).toHaveLength(1);
  if (change === "actor") mocks.session = { ...mocks.session!, userId: "student-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-4" canWrite={change !== "permission"} />);
  await act(async () => { const reader = mocks.readers[0]!; reader.result = "data:image/png;base64,dGVzdA=="; reader.onload?.(); });
  await waitFor(() => expect(screen.queryByAltText("候选1参考图（未上传）")).toBeNull());
});

it("rejects an old actor lifecycle's image callback after A to B to A", async () => {
  const actorA = { ...mocks.session! };
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-4" canWrite />);
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [new File(["old actor file"], "old-a.png", { type: "image/png" })] } });
  expect(mocks.readers).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "AI 引导师" }));
  mocks.session = { ...actorA, userId: "student-b" };
  rerender(<ProjectAidt projectId="group" sub="aidt-4" canWrite />);
  mocks.session = { ...actorA };
  rerender(<ProjectAidt projectId="group" sub="aidt-4" canWrite />);
  fireEvent.change(screen.getByLabelText("候选1名称"), { target: { value: "A回来后重新填写的候选" } });
  await act(async () => {
    const oldReader = mocks.readers[0]!;
    oldReader.result = "data:image/png;base64,b2xk";
    oldReader.onload?.();
  });
  expect(screen.getByLabelText("候选1名称")).toHaveValue("A回来后重新填写的候选");
  expect(screen.getByTestId("aidt-assistant-panel")).not.toBeVisible();
  expect(screen.queryByAltText("候选1参考图（未上传）")).toBeNull();
});

it("retains the same actor's pending local image read across token refresh", async () => {
  const { rerender } = render(<ProjectAidt projectId="group" sub="aidt-4" canWrite />);
  fireEvent.change(screen.getByLabelText("候选1名称"), { target: { value: "同一学生的候选" } });
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [new File(["same actor file"], "same-a.png", { type: "image/png" })] } });
  mocks.session = { ...mocks.session!, sessionToken: "refreshed-token" };
  rerender(<ProjectAidt projectId="group" sub="aidt-4" canWrite />);
  await act(async () => { const reader = mocks.readers[0]!; reader.result = "data:image/png;base64,c2FtZQ=="; reader.onload?.(); });
  expect(screen.getByLabelText("候选1名称")).toHaveValue("同一学生的候选");
  expect(screen.getByAltText("候选1参考图（未上传）")).toHaveAttribute("src", "data:image/png;base64,c2FtZQ==");
});
