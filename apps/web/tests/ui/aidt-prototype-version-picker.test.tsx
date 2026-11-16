import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtPrototypeVersionPicker } from "@/features/aidt/components/aidt-prototype-version-picker";
const mocks = vi.hoisted(() => ({ enabled: true, hasSession: true, session: { currentOrgId: "org", userId: "student", sessionToken: "token" }, designs: vi.fn(), versions: vi.fn(), resolve: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => mocks.hasSession ? { session: mocks.session } : null }));
vi.mock("@/features/aidt/lib/aidt-prototype-versions", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-prototype-versions")>(), loadAidtPrototypeDesigns: mocks.designs, loadAidtPrototypeVersions: mocks.versions, resolveAidtPrototypeVersion: mocks.resolve }));
const reference = { designId: "d", versionId: "v", designName: "订座原型", seq: 2, summary: "增加座位选择", createdAt: "2026-11-16", source: "model" as const, frameCount: 2, generatedFrameCount: 1 };
const designList = () => ({ items: [{ id: "d", name: "订座原型", ownerId: "student" }], unavailableCount: 0 });
const versionList = () => [{ id: "v", seq: 2, source: "model", summary: "增加座位选择", frames: ["首页", "座位"], notes: [], createdAt: "2026-11-16" }];
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true; mocks.hasSession = true;
  mocks.session = { currentOrgId: "org", userId: "student", sessionToken: "token" };
  mocks.designs.mockResolvedValue(designList()); mocks.versions.mockResolvedValue(versionList()); mocks.resolve.mockResolvedValue(reference);
});
async function openVersions() {
  fireEvent.click(screen.getByRole("button", { name: "选择真实原型版本" }));
  fireEvent.click(await screen.findByRole("button", { name: "订座原型" }));
  return screen.findByRole("button", { name: /选择 v2/ });
}

it("loads native owner-linked designs lazily, confirms a real snapshot and returns only reference metadata", async () => {
  const changed = vi.fn(); render(<AidtPrototypeVersionPicker projectId="p" onChange={changed} />);
  expect(mocks.designs).not.toHaveBeenCalled(); fireEvent.click(await openVersions());
  await waitFor(() => expect(changed).toHaveBeenCalledWith(reference));
  expect(mocks.designs).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", userId: "student", sessionToken: "token", signal: expect.any(AbortSignal) }));
  expect(mocks.versions).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p" }), "d");
  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", sessionToken: "token" }), "d", "v");
  expect(screen.queryByRole("button", { name: /选择 v2/ })).not.toBeInTheDocument();
  expect(screen.getByText(/保存与带入第6步问题卡需分别确认/)).toBeVisible();
});
it("keeps a historical reference visible in readonly mode without issuing reads or changes", () => {
  const changed = vi.fn(); render(<AidtPrototypeVersionPicker projectId="p" value={reference} readOnly onChange={changed} />);
  expect(screen.getByRole("button", { name: "选择真实原型版本" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "移除版本引用" })).toBeDisabled();
  expect(screen.getByTestId("aidt-prototype-recorded-reference")).toHaveTextContent("已生成 1/2 页");
  expect(screen.getByTestId("aidt-prototype-recorded-reference")).toHaveTextContent("历史记录不代表当前仍有访问权限");
  expect(mocks.designs).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
it("distinguishes failed design reads from actual empty/owner-inaccessible lists and offers retry", async () => {
  mocks.designs.mockRejectedValueOnce(new Error("503")); render(<AidtPrototypeVersionPicker projectId="p" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择真实原型版本" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("不能据此判断没有关联设计");
  expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
  mocks.designs.mockResolvedValueOnce({ items: [], unavailableCount: 1 });
  fireEvent.click(screen.getByRole("button", { name: "重试设计列表" }));
  expect(await screen.findByTestId("empty")).toHaveTextContent("当前没有可选择的已关联 owner 设计");
  expect(screen.getByText(/另有 1 个关联设计不在当前 owner 列表中/)).toBeVisible();
});
it("distinguishes version failures from a saved design with no version history", async () => {
  mocks.versions.mockRejectedValueOnce(new Error("503")); render(<AidtPrototypeVersionPicker projectId="p" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择真实原型版本" })); fireEvent.click(await screen.findByRole("button", { name: "订座原型" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未把失败当成没有版本");
  mocks.versions.mockResolvedValueOnce([]); fireEvent.click(screen.getByRole("button", { name: "重试版本历史" }));
  fireEvent.click(await screen.findByRole("button", { name: "订座原型" }));
  expect(await screen.findByTestId("empty")).toHaveTextContent("还没有已保存的原型版本");
});
it("does not replace an existing reference when actual snapshot confirmation fails", async () => {
  mocks.resolve.mockRejectedValueOnce(new Error("invalid snapshot")); const changed = vi.fn();
  render(<AidtPrototypeVersionPicker projectId="p" value={reference} onChange={changed} />); fireEvent.click(await openVersions());
  expect(await screen.findByRole("alert")).toHaveTextContent("原引用仍保留"); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /选择 v2/ })); await waitFor(() => expect(changed).toHaveBeenCalledWith(reference));
});
it("cancels old project responses and never exposes their designs on a new project", async () => {
  let finish!: (result: ReturnType<typeof designList>) => void;
  mocks.designs.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<AidtPrototypeVersionPicker projectId="p1" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择真实原型版本" }));
  const oldSignal = mocks.designs.mock.calls[0]![0].signal as AbortSignal;
  rerender(<AidtPrototypeVersionPicker projectId="p2" onChange={vi.fn()} />);
  expect(oldSignal.aborted).toBe(true); await act(async () => { finish(designList()); });
  expect(screen.queryByRole("button", { name: "订座原型" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择真实原型版本" })).toHaveAttribute("aria-expanded", "false");
});
it.each(["user", "org", "token", "readOnly"])("cancels pending version selection when %s changes", async (change) => {
  let finish!: (result: typeof reference) => void; mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const changed = vi.fn(); const { rerender } = render(<AidtPrototypeVersionPicker projectId="p" onChange={changed} />);
  fireEvent.click(await openVersions()); const oldSignal = mocks.resolve.mock.calls[0]![0].signal as AbortSignal;
  if (change === "user") mocks.session.userId = "another";
  if (change === "org") mocks.session.currentOrgId = "another-org";
  if (change === "token") mocks.session.sessionToken = "refreshed-token";
  rerender(<AidtPrototypeVersionPicker projectId="p" onChange={changed} readOnly={change === "readOnly"} />);
  expect(oldSignal.aborted).toBe(true); await act(async () => { finish(reference); }); expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /选择 v2/ })).not.toBeInTheDocument();
});
it("cancels selection on collapse and permits a fresh selection after reopening", async () => {
  let finish!: (result: typeof reference) => void; mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const changed = vi.fn(); render(<AidtPrototypeVersionPicker projectId="p" onChange={changed} />);
  fireEvent.click(await openVersions()); fireEvent.click(screen.getByRole("button", { name: "收起原型版本" }));
  expect(mocks.resolve.mock.calls[0]![0].signal.aborted).toBe(true);
  await act(async () => { finish(reference); }); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(await openVersions()); await waitFor(() => expect(changed).toHaveBeenCalledWith(reference));
});
it("performs no reads when the module or identity is unavailable, and removes only the local reference", () => {
  const changed = vi.fn(); mocks.enabled = false;
  const { rerender } = render(<AidtPrototypeVersionPicker projectId="p" onChange={changed} />);
  expect(screen.queryByTestId("aidt-prototype-version-picker")).not.toBeInTheDocument();
  mocks.enabled = true; mocks.hasSession = false; rerender(<AidtPrototypeVersionPicker projectId="p" onChange={changed} />);
  expect(screen.getByRole("status")).toHaveTextContent("登录并选择组织");
  mocks.hasSession = true; rerender(<AidtPrototypeVersionPicker projectId="p" value={reference} onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "移除版本引用" }));
  expect(changed).toHaveBeenCalledWith(null); expect(mocks.designs).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
});
