/**
 * F12（#2721）—— 前端中途插话交互（`InterjectionComposer`,
 * `components/agent-kernel/agent-kernel-units.tsx` + `lib/agent-kernel-interject.ts`）。
 *
 * `requirements/04-artifacts-steering.md` R3' 步骤 1-2、5 / R8 / R9 / R12，
 * `contracts/artifacts-steering/usecases.md` UC-4：run 处于 `running` 时插话输入框保持
 * 可交互（非 disabled），发送后 1 秒内显示「已收到」，不打断当前展示的执行进度流，
 * 支持 Cmd/Ctrl+Enter 发送。后端是 F11 的 `POST /agent-runs/:runId/interject`。
 *
 * 断言面（feature_list.json 本条 notes 逐字）：data-testid=interjection-composer；
 * interjection-input 非 disabled；interjection-send 发送后出现 interjection-ack。
 * 在此之上补的是"真实路径"：请求真的按契约 `operations.interject` 的路径/方法/请求体
 * 发出，「已收到」以服务端 `receivedAt` 为数据来源，契约两种失败码各有对应呈现。
 *
 * 反空转：
 * ① 「1 秒内」不是靶心画在箭上——`findByTestId` 的等待上限显式写成 1000ms（R9），
 *    替身 `interject` 延迟 0；替身若永不 resolve，这条断言会红。
 * ② 对照组：非 `running` 状态下输入框 disabled——证明"非 disabled"是 `running` 的
 *    专属结论，不是"输入框从来不会 disabled"。
 * ③ 契约比对：`interjectPath` 用的是 `artifactsSteering.operations.interject.path`
 *    替换 `:runId` 的结果，方法字面量与契约 `method` 逐字相等——不是各写一份。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactsSteering as AS } from "@repo/contracts";
import { AgentKernelNonTerminalView, InterjectionComposer } from "@/components/agent-kernel/agent-kernel-units";
import {
  classifyInterjectFailure, interjectAgentRun, interjectPath, INTERJECT_FAILURE_COPY,
  type InterjectFn, type InterjectOutput,
} from "@/lib/agent-kernel-interject";
import { ApiError } from "@/lib/api-client";

const RUN_ID = "run-f12-001";
const RECEIVED_AT = "2026-09-05T08:00:00.000Z";

function okInterject(): { fn: InterjectFn; calls: Array<{ runId: string; text: string }> } {
  const calls: Array<{ runId: string; text: string }> = [];
  const fn: InterjectFn = async (input) => {
    calls.push({ runId: input.runId, text: input.text });
    return { runId: input.runId, interjectionId: `ij-${calls.length}`, receivedAt: RECEIVED_AT };
  };
  return { fn, calls };
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByTestId("interjection-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("interjection-send"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ── ① running 态：输入框可交互 ─────────────────────────────────────── */

describe("InterjectionComposer · running 态输入框保持可交互（R8 / R12）", () => {
  it("渲染 interjection-composer，interjection-input 非 disabled，且是可输入的 textarea", () => {
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={okInterject().fn} />);
    expect(screen.getByTestId("interjection-composer")).toBeInTheDocument();
    const input = screen.getByTestId("interjection-input");
    expect(input.tagName).toBe("TEXTAREA");
    expect(input).not.toBeDisabled();
    expect(input).toBeEnabled();
  });

  it("status 缺省时按 running 处理（预览页/宿主未传状态不应把入口锁死）", () => {
    render(<InterjectionComposer runId={RUN_ID} interject={okInterject().fn} />);
    expect(screen.getByTestId("interjection-input")).toBeEnabled();
  });

  it.each(["awaiting_tool_permission", "awaiting_plan_confirmation", "paused", "queued"] as const)(
    "对照组：%s 态输入框与发送键 disabled（契约只对 running 开放 interject）",
    (status) => {
      render(<InterjectionComposer runId={RUN_ID} status={status} interject={okInterject().fn} />);
      expect(screen.getByTestId("interjection-input")).toBeDisabled();
      expect(screen.getByTestId("interjection-send")).toBeDisabled();
      expect(screen.getByTestId("interjection-composer")).toHaveAttribute("data-run-status", status);
    },
  );

  it("空白文本发送键 disabled；输入非空白后启用", () => {
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={okInterject().fn} />);
    expect(screen.getByTestId("interjection-send")).toBeDisabled();
    fireEvent.change(screen.getByTestId("interjection-input"), { target: { value: "   " } });
    expect(screen.getByTestId("interjection-send")).toBeDisabled();
    fireEvent.change(screen.getByTestId("interjection-input"), { target: { value: "第二页标题改一下" } });
    expect(screen.getByTestId("interjection-send")).toBeEnabled();
  });
});

/* ── ② 发送 → 1 秒内「已收到」，数据来源是服务端 receivedAt ─────────── */

describe("InterjectionComposer · 发送后 1 秒内出现 interjection-ack（R3' 步骤 5 / R9）", () => {
  it("点击 interjection-send：以契约 {runId, text} 调用 interject，1000ms 内出现 interjection-ack 且带 receivedAt", async () => {
    const { fn, calls } = okInterject();
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={fn} />);

    typeAndSend("第二页标题改成「华北下滑归因分析」");

    const ack = await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });
    expect(ack).toHaveTextContent("已收到");
    expect(ack).toHaveTextContent("第二页标题改成「华北下滑归因分析」");
    expect(ack).toHaveAttribute("data-received-at", RECEIVED_AT);
    expect(calls).toEqual([{ runId: RUN_ID, text: "第二页标题改成「华北下滑归因分析」" }]);
  });

  it("发送成功后输入框清空、仍非 disabled（可以继续插下一句）", async () => {
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={okInterject().fn} />);
    typeAndSend("先别上传，改完再说");
    await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });
    const input = screen.getByTestId("interjection-input") as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(input).toBeEnabled();
  });

  it("文本首尾空白被裁掉再发送；纯空白不会调用 interject", () => {
    const { fn, calls } = okInterject();
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={fn} />);
    fireEvent.change(screen.getByTestId("interjection-input"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByTestId("interjection-input"), { key: "Enter", ctrlKey: true });
    expect(calls).toEqual([]);
    typeAndSend("  多加一张图  ");
    expect(calls).toEqual([{ runId: RUN_ID, text: "多加一张图" }]);
  });

  it("等待服务端响应期间显示 interjection-pending、发送键锁住防重复提交，但输入框仍可交互", async () => {
    let resolve!: (out: InterjectOutput) => void;
    const fn: InterjectFn = (input) => new Promise((r) => {
      resolve = (out) => r(out);
      void input;
    });
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={fn} />);
    typeAndSend("改成季度对比");

    expect(await screen.findByTestId("interjection-pending")).toBeInTheDocument();
    expect(screen.getByTestId("interjection-send")).toBeDisabled();
    expect(screen.getByTestId("interjection-input")).toBeEnabled();
    expect(screen.queryByTestId("interjection-ack")).not.toBeInTheDocument();

    resolve({ runId: RUN_ID, interjectionId: "ij-late", receivedAt: RECEIVED_AT });
    await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });
    expect(screen.queryByTestId("interjection-pending")).not.toBeInTheDocument();
  });

  it("「已收到」展示一段时间后自动消失，不需要用户操作", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={okInterject().fn} />);
    typeAndSend("换成折线图");
    await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });
    await vi.advanceTimersByTimeAsync(4_500);
    expect(screen.queryByTestId("interjection-ack")).not.toBeInTheDocument();
  });
});

/* ── ③ Cmd/Ctrl+Enter 发送 ─────────────────────────────────────────── */

describe("InterjectionComposer · Cmd/Ctrl+Enter 发送", () => {
  it.each([
    ["Ctrl+Enter", { ctrlKey: true }],
    ["Cmd+Enter", { metaKey: true }],
  ] as const)("%s 发送并出现 interjection-ack", async (_label, mods) => {
    const { fn, calls } = okInterject();
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={fn} />);
    const input = screen.getByTestId("interjection-input");
    fireEvent.change(input, { target: { value: "标题改成中文" } });
    fireEvent.keyDown(input, { key: "Enter", ...mods });
    await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });
    expect(calls).toHaveLength(1);
  });

  it("对照组：裸 Enter 不发送（多行输入保留换行能力）", () => {
    const { fn, calls } = okInterject();
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={fn} />);
    const input = screen.getByTestId("interjection-input");
    fireEvent.change(input, { target: { value: "第一行" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([]);
    expect(screen.queryByTestId("interjection-ack")).not.toBeInTheDocument();
  });
});

/* ── ④ 不打断进度流 ───────────────────────────────────────────────── */

describe("AgentKernelNonTerminalView · running 分支：插话入口与进度流并存，发送不打断进度流", () => {
  it("running ⇒ 同时渲染 progress-stream 与 interjection-composer；发送后进度流仍在", async () => {
    render(<AgentKernelNonTerminalView status="running" runId={RUN_ID} interject={okInterject().fn} />);
    expect(screen.getByTestId("progress-stream")).toBeInTheDocument();
    expect(screen.getByTestId("interjection-input")).toBeEnabled();

    const stepsBefore = within(screen.getByTestId("progress-stream")).getAllByTestId(/^progress-step-/).length;
    typeAndSend("把第三步跳过");
    await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });

    const stream = screen.getByTestId("progress-stream");
    expect(stream).toBeInTheDocument();
    expect(within(stream).getAllByTestId(/^progress-step-/).length).toBe(stepsBefore);
  });

  it("对照组：queued 仍是 progress 分支但不渲染插话入口（契约只对 running 开放）", () => {
    render(<AgentKernelNonTerminalView status="queued" runId={RUN_ID} />);
    expect(screen.getByTestId("progress-stream")).toBeInTheDocument();
    expect(screen.queryByTestId("interjection-composer")).not.toBeInTheDocument();
  });
});

/* ── ⑤ 失败模式：契约两种 err 各有呈现，输入保留供重发 ──────────────── */

describe("InterjectionComposer · 失败呈现（UC-4 err: NOT_VISIBLE | RUN_NOT_RUNNING）", () => {
  it("RUN_NOT_RUNNING（409 + AGENT_RUN_NOT_RUNNING）⇒ interjection-error 显示对应文案，无 ack，文本保留", async () => {
    const fn: InterjectFn = async () => {
      throw new ApiError(409, "AGENT_RUN_NOT_RUNNING", { reasonCode: "AGENT_RUN_NOT_RUNNING", status: "paused" });
    };
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={fn} />);
    typeAndSend("改一下颜色");
    const err = await screen.findByTestId("interjection-error");
    expect(err).toHaveTextContent(INTERJECT_FAILURE_COPY.RUN_NOT_RUNNING);
    expect(screen.queryByTestId("interjection-ack")).not.toBeInTheDocument();
    expect((screen.getByTestId("interjection-input") as HTMLTextAreaElement).value).toBe("改一下颜色");
    expect(screen.getByTestId("interjection-send")).toBeEnabled();
  });

  it("NOT_VISIBLE（404）⇒ 显示对应文案；未知失败 ⇒ 通用文案", async () => {
    const notVisible: InterjectFn = async () => { throw new ApiError(404, null, undefined); };
    const { unmount } = render(<InterjectionComposer runId={RUN_ID} status="running" interject={notVisible} />);
    typeAndSend("x");
    expect(await screen.findByTestId("interjection-error")).toHaveTextContent(INTERJECT_FAILURE_COPY.NOT_VISIBLE);
    unmount();

    const unknown: InterjectFn = async () => { throw new TypeError("network down"); };
    render(<InterjectionComposer runId={RUN_ID} status="running" interject={unknown} />);
    typeAndSend("y");
    const err = await screen.findByTestId("interjection-error");
    expect(err).not.toHaveTextContent(INTERJECT_FAILURE_COPY.NOT_VISIBLE);
    expect(err).not.toHaveTextContent(INTERJECT_FAILURE_COPY.RUN_NOT_RUNNING);
    expect(err.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("classifyInterjectFailure 只认契约两种码：409 但 reasonCode 不同 / 5xx / 非 ApiError ⇒ null", () => {
    expect(classifyInterjectFailure(new ApiError(404, null, undefined))).toBe("NOT_VISIBLE");
    expect(classifyInterjectFailure(new ApiError(409, "AGENT_RUN_NOT_RUNNING", {}))).toBe("RUN_NOT_RUNNING");
    expect(classifyInterjectFailure(new ApiError(409, "SOMETHING_ELSE", {}))).toBeNull();
    expect(classifyInterjectFailure(new ApiError(503, "authz_unavailable", {}))).toBeNull();
    expect(classifyInterjectFailure(new Error("boom"))).toBeNull();
    // 枚举每个值都有文案（缺一条 TS 先红，这里再机械确认一次运行期形状）。
    for (const code of AS.InterjectError.options) expect(INTERJECT_FAILURE_COPY[code]).toBeTruthy();
  });
});

/* ── ⑥ 真实请求形状：路径/方法/请求体逐字对齐契约 operations.interject ─── */

describe("interjectAgentRun · 请求按契约 operations.interject 发出", () => {
  it("interjectPath 等于契约 path 替换 :runId（含 URL 编码）", () => {
    expect(interjectPath("run 1/a")).toBe(AS.operations.interject.path.replace(":runId", encodeURIComponent("run 1/a")));
    expect(interjectPath(RUN_ID)).toBe(`/agent-runs/${RUN_ID}/interject`);
  });

  it("POST 到契约路径，body 只有 text（runId 走路径参数，不重复进 body），带 Bearer；响应按 InterjectOutput 返回", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ runId: RUN_ID, interjectionId: "ij-9", receivedAt: RECEIVED_AT }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const out = await interjectAgentRun({ runId: RUN_ID, text: "改成季度对比" }, { sessionToken: "tok-1" });

    expect(out).toEqual({ runId: RUN_ID, interjectionId: "ij-9", receivedAt: RECEIVED_AT });
    expect(AS.InterjectOutput.safeParse(out).success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(new URL(url).pathname.endsWith(`/agent-runs/${RUN_ID}/interject`)).toBe(true);
    expect(init.method).toBe(AS.operations.interject.method);
    expect(JSON.parse(String(init.body))).toEqual({ text: "改成季度对比" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("409 + AGENT_RUN_NOT_RUNNING 信封 ⇒ 抛 ApiError 且 classify 为 RUN_NOT_RUNNING", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "conflict", reasonCode: "AGENT_RUN_NOT_RUNNING", status: "paused", traceId: "t" }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));
    const err = await interjectAgentRun({ runId: RUN_ID, text: "x" }, { sessionToken: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(classifyInterjectFailure(err)).toBe("RUN_NOT_RUNNING");
  });

  it("端到端（组件 → 真实 interjectAgentRun → fetch 替身）：1 秒内 ack，receivedAt 来自响应", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ runId: RUN_ID, interjectionId: "ij-e2e", receivedAt: RECEIVED_AT }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    render(<InterjectionComposer runId={RUN_ID} status="running" />);
    typeAndSend("端到端插一句");
    const ack = await screen.findByTestId("interjection-ack", {}, { timeout: 1_000 });
    expect(ack).toHaveAttribute("data-received-at", RECEIVED_AT);
    await waitFor(() => expect(screen.queryByTestId("interjection-pending")).not.toBeInTheDocument());
  });
});
