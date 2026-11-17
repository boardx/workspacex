import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtDesignWorkspace } from "@/features/aidt/components/aidt-design-workspace";
const mock = vi.hoisted(() => ({ enabled: true, load: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mock.enabled }));
vi.mock("@/features/aidt/lib/aidt-design-handoff", () => ({ loadAidtDesignHandoff: mock.load }));
vi.mock("@/components/design-loop/detail-screen", () => ({ DesignDetailScreen: ({ composerContextOffer, sendBlockedReason, autoStart }: { composerContextOffer?: { text: string }; sendBlockedReason?: string; autoStart?: boolean }) => <div data-testid="native-props" data-autostart={String(autoStart)}><span>{composerContextOffer?.text}</span>{sendBlockedReason && <span data-testid="native-blocked">{sendBlockedReason}</span>}</div> }));
const result = (text = "已保存旧轮问题") => ({ offer: { id: text, label: "来源", text }, sources: [{ stageId: 5, revision: 3 }], warnings: [] });
const props = { projectId: "design", teachingProjectId: "class", stageId: 6, lifecycleKey: "org/student", sessionToken: "token" };
beforeEach(() => { vi.clearAllMocks(); mock.enabled = true; mock.load.mockResolvedValue(result()); });
it("hands the offer to the real native host prop after a saved-context read, explicitly disabling autostart", async () => {
  render(<AidtDesignWorkspace {...props} returnRevision="7" />);
  expect(await screen.findByText("已保存旧轮问题")).toBeVisible();
  expect(screen.getByTestId("native-props")).toHaveAttribute("data-autostart", "false");
  expect(screen.queryByTestId("native-blocked")).not.toBeInTheDocument();
  expect(mock.load).toHaveBeenCalledWith(expect.objectContaining({ projectId: "class", stageId: 6, roundRevision: 7, sessionToken: "token" }));
});
it("keeps failed reads distinct from empty context and offers an explicit retry", async () => {
  mock.load.mockRejectedValueOnce(new Error("503")); render(<AidtDesignWorkspace {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("未使用当前草稿或其他版本替代");
  expect(screen.getByTestId("native-blocked")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新读取已保存制作说明" }));
  expect(await screen.findByText("已保存旧轮问题")).toBeVisible();
});
it("aborts a previous actor's delayed read and does not leak their offer into a new identity", async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(result("新身份保存问题"));
  const { rerender } = render(<AidtDesignWorkspace {...props} />);
  const signal = mock.load.mock.calls[0]![0].signal as AbortSignal;
  rerender(<AidtDesignWorkspace {...props} lifecycleKey="org/another" sessionToken="new-token" />);
  expect(signal.aborted).toBe(true); expect(await screen.findByText("新身份保存问题")).toBeVisible();
  await act(async () => { finish(result("前身份私有说明")); });
  expect(screen.queryByText("前身份私有说明")).not.toBeInTheDocument();
});
it("performs no context read while the optional module is disabled", () => {
  mock.enabled = false; render(<AidtDesignWorkspace {...props} />);
  expect(screen.queryByTestId("native-props")).not.toBeInTheDocument(); expect(mock.load).not.toHaveBeenCalled();
});
