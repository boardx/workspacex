/**
 * F04（#2712）—— 终态判断修复 + 前端订阅改造的回归门控。
 *
 * `requirements/02-streaming-transport.md` R6 后置条件 / R12，`contracts/
 * streaming-transport/domain.md` I-1（终态覆盖完整）、I-5（单一状态名）：
 *   ① `isTerminalRunStatus` 覆盖且仅覆盖 `{succeeded, failed, cancelled}` 三态，
 *      其余（含本 phase 引入的三个非终态 `awaiting_plan_confirmation`/
 *      `awaiting_tool_permission`/`paused`）均判非终态。
 *   ② 每个非终态都有专属渲染分支——不是"判断为非终态就继续 loading"。
 *   ③ 旧状态名 `awaiting_approval` 与"20 分钟轮询预算 + gave-up 兜底"不再存在于
 *      `copilotkit-v2-run-restore.ts`/`agent-run.ts`（本 phase 触发 bug 的直接病灶），
 *      替换为基于 WebSocket 订阅 + checkpoint 续接的真实恢复机制。
 *   ④ E1 回归：run 停在 `awaiting_tool_permission`，恢复路径必须在有限时间内确认
 *      终态或非终态并给出结果，不能安静地卡死。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { streamingTransport as ST } from "@repo/contracts";
import {
  AgentKernelNonTerminalView, agentKernelNonTerminalBranch,
} from "@/components/agent-kernel/agent-kernel-units";

/* ── ① isTerminalRunStatus 覆盖三非终态（+ queued/running），仅终态为真 ──── */

describe("isTerminalRunStatus（packages/contracts/src/streaming-transport.ts）：覆盖且仅覆盖三终态", () => {
  it("对枚举全体逐一调用，结果与 AGENT_KERNEL_TERMINAL_STATUSES 集合逐一比对相等（I-1）", () => {
    const terminal = new Set<string>(ST.AGENT_KERNEL_TERMINAL_STATUSES);
    for (const status of ST.AgentKernelRunStatus.options) {
      expect(ST.isTerminalRunStatus(status)).toBe(terminal.has(status));
    }
  });

  it.each(["awaiting_plan_confirmation", "awaiting_tool_permission", "paused"] as const)(
    "非终态 %s ⇒ isTerminalRunStatus 为 false（本 phase 触发 bug 的三个具名非终态）",
    (status) => {
      expect(ST.isTerminalRunStatus(status)).toBe(false);
    },
  );

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "终态 %s ⇒ isTerminalRunStatus 为 true",
    (status) => {
      expect(ST.isTerminalRunStatus(status)).toBe(true);
    },
  );

  it("CP 反证：若把 paused 错误地塞进终态集合判断，上一条『非终态为 false』的断言必红", () => {
    const wronglyTerminal = new Set([...ST.AGENT_KERNEL_TERMINAL_STATUSES, "paused"]);
    expect(() => expect(wronglyTerminal.has("paused") === false).toBe(true)).toThrow();
  });
});

/* ── ② 每个非终态都有专属渲染分支，不塌缩成 loading ─────────────────── */

describe("agentKernelNonTerminalBranch / AgentKernelNonTerminalView：三非终态各自独立分支", () => {
  it("三个非终态各自映射到互不相同的分支（不是共用一个『非终态』桶）", () => {
    const branches = [
      agentKernelNonTerminalBranch("awaiting_plan_confirmation"),
      agentKernelNonTerminalBranch("awaiting_tool_permission"),
      agentKernelNonTerminalBranch("paused", "user"),
    ];
    expect(new Set(branches).size).toBe(branches.length);
    expect(branches.every((b) => b !== null)).toBe(true);
  });

  it("awaiting_plan_confirmation ⇒ 渲染 plan-confirmation-card，不是 loading 占位", () => {
    render(<AgentKernelNonTerminalView status="awaiting_plan_confirmation" />);
    expect(screen.getByTestId("plan-confirmation-card")).toBeInTheDocument();
  });

  it("awaiting_tool_permission ⇒ 渲染 tool-permission-card（可交互的审批 UI）", () => {
    render(<AgentKernelNonTerminalView status="awaiting_tool_permission" />);
    expect(screen.getByTestId("tool-permission-card")).toBeInTheDocument();
  });

  it("paused + pausedBy=user ⇒ 渲染 paused-user（含可交互的恢复按钮）", () => {
    render(<AgentKernelNonTerminalView status="paused" pausedBy="user" />);
    expect(screen.getByTestId("paused-user")).toBeInTheDocument();
    expect(screen.getByTestId("paused-resume")).toBeEnabled();
  });

  it("paused + pausedBy=system ⇒ 渲染 paused-system（不含恢复按钮，R4 E4）", () => {
    render(<AgentKernelNonTerminalView status="paused" pausedBy="system" />);
    expect(screen.getByTestId("paused-system")).toBeInTheDocument();
    expect(screen.queryByTestId("paused-resume")).not.toBeInTheDocument();
  });

  it("running/queued ⇒ 渲染执行进度流，不是空白或纯 loading", () => {
    render(<AgentKernelNonTerminalView status="running" />);
    expect(screen.getByTestId("progress-stream")).toBeInTheDocument();
  });

  it("终态（succeeded/failed/cancelled）⇒ 不在本分支表里，返回 null（由调用方另行渲染结果）", () => {
    for (const status of ["succeeded", "failed", "cancelled"] as const) {
      expect(agentKernelNonTerminalBranch(status)).toBeNull();
    }
  });
});

/* ── ③ 静态扫描：旧状态名与旧轮询兜底不再存在于两个改造目标文件 ────────── */

// `process.cwd()`, not `import.meta.url`——本文件在 jsdom 下跑（vitest 的
// `environmentMatchGlobs` 把所有 `.tsx` 送去那里），jsdom 里 `import.meta.url` 是一个
// `http://localhost/` URL，`readFileSync(new URL(...))` 会报 "must be of scheme file"
// （与 `tests/ui/files-browser.test.tsx` 同一条既有纪律）。vitest 以包根为 cwd 跑，
// 这是这里稳定可用的写法。
const WEB = process.cwd();
function readLibSource(relPath: string): string {
  return readFileSync(join(WEB, "lib", relPath), "utf8");
}

describe("静态扫描：copilotkit-v2-run-restore.ts / agent-run.ts 不再含旧状态名与旧轮询兜底", () => {
  const runRestoreSrc = readLibSource("copilotkit-v2-run-restore.ts");
  const agentRunSrc = readLibSource("agent-run.ts");

  it("两个文件都不出现字面量 awaiting_approval（I-5，旧状态名已被 awaiting_tool_permission 取代）", () => {
    expect(runRestoreSrc).not.toContain("awaiting_approval");
    expect(agentRunSrc).not.toContain("awaiting_approval");
  });

  it("copilotkit-v2-run-restore.ts 不再含『20 分钟轮询预算』相关标识符（R6 后置条件）", () => {
    expect(runRestoreSrc).not.toMatch(/RESTORE_POLL_BUDGET_MS|budget-exhausted|20 \* 60_000/);
  });

  it("copilotkit-v2-run-restore.ts 不再含旧固定退避轮询循环的标识符（RESTORE_POLL_BACKOFF/FIRST_DELAY）", () => {
    expect(runRestoreSrc).not.toMatch(/RESTORE_POLL_BACKOFF|RESTORE_POLL_FIRST_DELAY_MS|RESTORE_POLL_MAX_DELAY_MS/);
  });

  it("CP 反证：上面两条『不含』断言不是恒真——对着一段真的包含这些标识符的文本，断言必须失败", () => {
    const stale = `${runRestoreSrc}\nconst RESTORE_POLL_BUDGET_MS = 20 * 60_000;`;
    expect(() => expect(stale).not.toMatch(/RESTORE_POLL_BUDGET_MS/)).toThrow();
  });

  it("copilotkit-v2-run-restore.ts 确实换成了真实 WebSocket 订阅机制，不是被整段删空（反证：真的有替代实现）", () => {
    expect(runRestoreSrc).toMatch(/useAgentKernelRunStream/);
    expect(runRestoreSrc).toContain("agent-kernel-stream");
  });
});

/* ── ④ E1 回归：恢复路径基于真实 WS 订阅，终态到达后能确认结果，不安静卡死 ── */

const { getAgentRun } = vi.hoisted(() => ({ getAgentRun: vi.fn() }));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  constructor(readonly url: string, readonly protocols: string[]) { super(); }
  send(): void {}
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  emit(payload: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

describe("useCopilotKitV2RunRestore：真实 WS 事件驱动，终态到达后确认并回调 settled（E1/R12）", () => {
  let sockets: FakeWebSocket[];

  beforeEach(() => {
    getAgentRun.mockReset();
    sockets = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string, protocols: string[]) {
        super(url, protocols);
        sockets.push(this);
        queueMicrotask(() => this.open());
      }
    });
  });

  it("本 phase 触发 bug 的回归用例：run 停在 awaiting_tool_permission，收到该状态事件后立即确认（非终态，仍在恢复中，不安静卡死也不误判成功）", async () => {
    const { useCopilotKitV2RunRestore } = await import("@/lib/copilotkit-v2-run-restore");
    const onSettled = vi.fn();
    const { result } = renderHook(() => useCopilotKitV2RunRestore("run-1", "tok", onSettled));

    expect(result.current.isRestoring).toBe(true);
    await waitFor(() => expect(sockets.length).toBe(1));

    act(() => {
      sockets[0]!.emit({
        type: "status_change", runId: "run-1", seq: 1,
        status: "awaiting_tool_permission", pausedBy: null, emittedAt: "2026-09-05T00:00:00.000Z",
      });
    });

    // 非终态事件不触发确认读、不误判完成——仍在如实展示"恢复中"。
    expect(getAgentRun).not.toHaveBeenCalled();
    expect(result.current.isRestoring).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("收到终态 status_change 事件 ⇒ 做一次确认性 REST 读，读到终态后回调 settled（不是继续轮询）", async () => {
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: "thr-1", status: "succeeded", error: null, resultMessageId: "cm-2",
    });
    const { useCopilotKitV2RunRestore } = await import("@/lib/copilotkit-v2-run-restore");
    const onSettled = vi.fn();
    const { result } = renderHook(() => useCopilotKitV2RunRestore("run-1", "tok", onSettled));
    await waitFor(() => expect(sockets.length).toBe(1));

    act(() => {
      sockets[0]!.emit({
        type: "status_change", runId: "run-1", seq: 2,
        status: "succeeded", pausedBy: null, emittedAt: "2026-09-05T00:00:00.000Z",
      });
    });

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({
      kind: "settled",
      view: { runId: "run-1", threadId: "thr-1", status: "succeeded", error: null, resultMessageId: "cm-2" },
    }));
    expect(getAgentRun).toHaveBeenCalledWith("run-1", "tok");
    await waitFor(() => expect(result.current.isRestoring).toBe(false));
  });

  it("pendingRunId=null ⇒ 不建立任何连接，不显示恢复中", () => {
    return import("@/lib/copilotkit-v2-run-restore").then(({ useCopilotKitV2RunRestore }) => {
      const { result } = renderHook(() => useCopilotKitV2RunRestore(null, "tok", vi.fn()));
      expect(result.current.isRestoring).toBe(false);
      expect(sockets.length).toBe(0);
    });
  });
});
