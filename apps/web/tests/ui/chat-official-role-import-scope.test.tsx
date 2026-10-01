import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatPopoverCoordinatorProvider } from "@/components/chat/chat-popover-coordinator";
import { CapabilityPicker, useOfficialRoleOffer } from "@/components/chat/chat-task-workbench-capability-picker";
const mocks = vi.hoisted(() => ({ request: vi.fn(), offer: vi.fn(), directory: vi.fn(), org: "org-a", token: "token-a", refresh: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ status: "authenticated", session: { userId: "admin", currentOrgId: mocks.org, sessionToken: mocks.token } }) }));
vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.request }));
vi.mock("@/lib/agent-directory", async (original) => ({ ...await original<typeof import("@/lib/agent-directory")>(), getOfficialRolePackOffer: mocks.offer, listAgentDirectory: mocks.directory }));
const offer = { packId: "official-role-pack", packVersion: "1.0.0", canEnable: true, pending: [{ roleRef: "D003", name: "Product Manager", roleLabel: "Product Manager", roleCategory: "product", tags: ["产品"], avatar: null, workflowAllowlist: ["W029"] }], requiredSkillPacks: [{ packId: "work-product", packVersion: "1.0.0" }, { packId: "work-design", packVersion: "1.0.0" }] };
function Harness({ enabled = true }: { enabled?: boolean }) {
  const state = useOfficialRoleOffer(enabled, mocks.refresh);
  return <><button disabled={!state.offer || state.enabling} onClick={state.enable}>启用</button><p>{state.offer?.pending[0]?.name}</p><p data-testid="result">{state.result}</p><p data-testid="error">{state.error}</p></>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.org = "org-a"; mocks.token = "token-a"; mocks.offer.mockResolvedValue(offer); mocks.request.mockResolvedValue({}); mocks.directory.mockResolvedValue([]); });

it("chat hook sends frozen organization/token on the actual helper sequence and refreshes after verified completion", async () => {
  render(<Harness />);
  await screen.findByText("Product Manager");
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  expect(mocks.request).toHaveBeenCalledTimes(3);
  for (const [, opts] of mocks.request.mock.calls) expect(opts).toMatchObject({ sessionToken: "token-a", signal: expect.any(AbortSignal), body: { expectedOrgId: "org-a" } });
});

it.each(["org", "token", "close", "unmount"])("stops actual helper after the first POST on %s change; stale completion cannot refresh or show success", async (change) => {
  let finish!: (value: object) => void;
  mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<Harness />);
  await screen.findByText("Product Manager");
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  expect(mocks.request).toHaveBeenCalledTimes(1);
  const signal = mocks.request.mock.calls[0]![1].signal as AbortSignal | undefined;
  if (change === "org") mocks.org = "org-b";
  if (change === "token") mocks.token = "token-b";
  if (change === "unmount") view.unmount();
  else view.rerender(<Harness enabled={change !== "close"} />);
  await act(async () => { finish({}); });
  expect(signal?.aborted).toBe(true);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.directory).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  if (change !== "unmount") { expect(screen.getByTestId("result")).toBeEmptyDOMElement(); expect(screen.getByTestId("error")).toBeEmptyDOMElement(); }
});

it("discards the previous organization's delayed offer instead of making it importable", async () => {
  let oldOffer!: (value: typeof offer) => void;
  mocks.offer.mockImplementationOnce(() => new Promise((resolve) => { oldOffer = resolve; })).mockResolvedValueOnce({ ...offer, pending: [{ roleRef: "D004", name: "New Org Role" }] });
  const view = render(<Harness />);
  mocks.org = "org-b";
  view.rerender(<Harness />);
  await screen.findByText("New Org Role");
  await act(async () => { oldOffer(offer); });
  expect(screen.queryByText("Product Manager")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  expect(mocks.request.mock.calls[0]![1].body.expectedOrgId).toBe("org-b");
});


it("production picker/portal enable action uses the same guarded helper and cancels on organization switch", async () => {
  let finish!: (value: object) => void;
  mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const picker = () => <ChatPopoverCoordinatorProvider><CapabilityPicker listings={[]} status="ready" selectedAgentId={null} onSelect={vi.fn()} disabled={false} onListingsChanged={mocks.refresh} /></ChatPopoverCoordinatorProvider>;
  const view = render(picker());
  fireEvent.click(screen.getByTestId("chat-task-workbench-capability-picker"));
  fireEvent.click(await screen.findByTestId("chat-task-workbench-capability-enable-official"));
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0]![1].body.expectedOrgId).toBe("org-a");
  mocks.org = "org-b";
  view.rerender(picker());
  await act(async () => { finish({}); });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("ignores a directory refresh finishing after the organization changed", async () => {
  let finish!: (value: never[]) => void;
  mocks.directory.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<Harness />);
  await screen.findByText("Product Manager");
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  await waitFor(() => expect(mocks.directory).toHaveBeenCalledTimes(1));
  mocks.org = "org-b";
  view.rerender(<Harness />);
  await act(async () => { finish([]); });
  expect(screen.getByTestId("result")).toBeEmptyDOMElement();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
