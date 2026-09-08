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
    const card = await screen.findByTestId("chat-task-workbench-approval-card");
    expect(card).toHaveAttribute("data-risk", "L2");
    expect(screen.getByTestId("perm-intent")).toHaveTextContent("需要授权的技能");
    expect(screen.getByTestId("perm-rationale")).toHaveTextContent("高风险");
    expect(screen.getByTestId("perm-command")).toHaveTextContent("Safe summary");
    expect(screen.getByTestId("perm-affects")).toHaveTextContent("尚未提供更具体的影响对象");
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

  it("keeps a dismissed durable permission request available without making a decision", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "request-id", toolName: "call_skill", argsSummary: "summary" } });
    render(<RestoredRunApproval runId="run" />);
    const dialog = await screen.findByTestId("chat-tool-permission-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("chat-tool-permission-dialog")).toBeNull());
    expect(calls.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开工具审批" }));
    expect(await screen.findByTestId("chat-tool-permission-dialog")).toBeVisible();
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

  it("opens a modal intent dialog and permits closing and reopening without a decision", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "dialog-id", toolName: "confirm_task_intent", interrupt: { toolName: "confirm_task_intent", args: { requestId: "r", understanding: "Dialog goal", assumptions: [] } } } });
    render(<RestoredRunApproval runId="run" />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-testid", "chat-tool-permission-dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开待确认请求" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
  it("restores missing task parameters as a visible clarification dialog", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "params-id", toolName: "fill_run_params", interrupt: { toolName: "fill_run_params", args: { requestId: "params", fields: [{ name: "topic", label: "主题", aiGuess: null, rationale: null, required: true, currentValue: null }] } } } });
    render(<RestoredRunApproval runId="run" />);
    expect(await screen.findByRole("heading", { name: "等待你补充信息" })).toBeVisible();
    expect(screen.getByText("任务已暂停。补充这些信息后，Agent 会从当前步骤继续。")).toBeVisible();
    expect(screen.getByTestId("agent-interrupt-fill-params-input-topic")).toBeVisible();
  });
  it("terminal authority removes a stale streaming fallback", async () => {
    calls.read.mockResolvedValue({ status: "cancelled", pendingApproval: null });
    render(<RestoredRunApproval runId="run" fallbackInterrupt={{ toolName: "confirm_task_intent", args: { requestId: "old", understanding: "Old goal", assumptions: [] } }} />);
    await waitFor(() => expect(screen.queryByTestId("interrupt-awaiting-persistence")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("an old tool cannot act on a later request in the same run", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "new-permission", toolName: "confirm_task_intent", interrupt: { toolName: "confirm_task_intent", args: { requestId: "new", understanding: "New goal", assumptions: [] } } } });
    render(<RestoredRunApproval runId="run" fallbackInterrupt={{ toolName: "confirm_task_intent", args: { requestId: "old", understanding: "Old goal", assumptions: [] } }} />);
    await screen.findByRole("group", { name: "已结束的确认记录" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("agent-interrupt-confirm-intent-continue")).toBeDisabled();
    expect(calls.request).not.toHaveBeenCalled();
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
  it("renders the permission card for any non-form L2 tool, not only call_skill", async () => {
    calls.read.mockResolvedValue({ status: "awaiting_tool_permission", pendingApproval: { permissionRequestId: "canvas-id", toolName: "wx_canvas_update", argsSummary: "canvas args" } });
    calls.request.mockResolvedValue({ runId: "run", permissionRequestId: "canvas-id" });
    render(<RestoredRunApproval runId="run" />);
    await screen.findByTestId("chat-task-workbench-approval-card");
    expect(screen.queryByText("确认请求暂时无法恢复，请重新加载任务后重试。")).toBeNull();
    expect(screen.getByTestId("perm-intent")).toHaveTextContent("调用工具 wx_canvas_update");
    fireEvent.click(await screen.findByRole("button", { name: "仅本次允许" }));
    await waitFor(() => expect(calls.request).toHaveBeenCalledWith("/agent-runs/run/permission-requests/canvas-id/decision", expect.objectContaining({ body: { decision: "once" } })));
  });

});
