import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";
const calls = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", () => ({ getAgentRun: calls.read }));
vi.mock("@/lib/api-client", () => ({ apiRequest: calls.request }));
beforeEach(() => { calls.read.mockReset(); calls.request.mockReset(); });
describe("durable approval", () => {
  it("restores four choices without AGUI tool messages and posts the authoritative request id", async () => {
    calls.read.mockResolvedValueOnce({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "request-id", toolName: "call_skill", argsSummary: "Safe summary" } }).mockResolvedValue({ status: "running", pendingApproval: null });
    calls.request.mockResolvedValue({ runId: "run", permissionRequestId: "request-id" });
    render(<RestoredRunApproval runId="run" bearer="token" />);
    fireEvent.click(await screen.findByRole("button", { name: "仅本次允许" }));
    await waitFor(() => expect(calls.request).toHaveBeenCalledWith("/agent-runs/run/permission-requests/request-id/decision", expect.objectContaining({ body: { decision: "once" } })));
    await waitFor(() => expect(screen.queryByTestId("restored-run-approval")).toBeNull());
  });
  it("does not request approval for an ordinary running skill", async () => {
    calls.read.mockResolvedValue({ status: "running", pendingApproval: null });
    const { container } = render(<RestoredRunApproval runId="run" />);
    await waitFor(() => expect(calls.read).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(calls.request).not.toHaveBeenCalled();
  });
  it("restores a zero-assumption intent form and resumes its exact pending request", async () => {
    calls.read.mockResolvedValueOnce({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "form-id", toolName: "confirm_task_intent", argsSummary: null, interrupt: { toolName: "confirm_task_intent", args: { requestId: "form", understanding: "Check the report", assumptions: [] } } } }).mockResolvedValue({ status: "running", pendingApproval: null });
    calls.request.mockResolvedValue({});
    render(<RestoredRunApproval runId="run" />);
    fireEvent.click(await screen.findByRole("button", { name: "继续" }));
    await waitFor(() => expect(calls.request).toHaveBeenCalledWith("/agent-runs/run/decision", expect.objectContaining({ body: { permissionRequestId: "form-id", decision: "approve" } })));
    expect(screen.queryByRole("button", { name: "以后都允许" })).toBeNull();
  });

  it("keeps observer approval controls disabled", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "request-id", toolName: "call_skill", argsSummary: "summary" } });
    render(<RestoredRunApproval runId="run" canWrite={false} />);
    const button = await screen.findByRole("button", { name: "仅本次允许" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(calls.request).not.toHaveBeenCalled();
  });

  it("submits only the selected option field and durable request identity", async () => {
    const options = ["a", "b"].map((optionId) => ({ optionId, title: optionId, effort: "低", timeToValue: "1天", expectedReturn: "报告" }));
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "choice-id", toolName: "choose_execution_option", interrupt: { toolName: "choose_execution_option", args: { requestId: "form", options } } } });
    calls.request.mockResolvedValue({});
    render(<RestoredRunApproval runId="run" />);
    fireEvent.click(await screen.findByTestId("agent-interrupt-choose-option-option-b"));
    await waitFor(() => expect(calls.request).toHaveBeenCalledWith("/agent-runs/run/decision", expect.objectContaining({ body: { permissionRequestId: "choice-id", decision: "edit", editedArgs: { selectedOptionId: "b" } } })));
    await waitFor(() => expect(screen.queryByTestId("restored-run-approval")).toBeNull());
  });

  it("synchronously locks duplicate decisions before React commits disabled state", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "request-id", toolName: "call_skill", argsSummary: "summary" } });
    let finish!: () => void;
    calls.request.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<RestoredRunApproval runId="run" />);
    const button = await screen.findByRole("button", { name: "仅本次允许" });
    act(() => { button.click(); button.click(); });
    expect(calls.request).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });

});
