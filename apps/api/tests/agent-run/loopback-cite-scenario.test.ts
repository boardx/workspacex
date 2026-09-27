/**
 * issue #4260 —— deep-agent 替身「引用闭环」剧本的线格式取证。
 *
 * 真实上游 = `apps/deep-agent-service/src/deep_agent_service/standard_context_tools.py::_invoke`：
 *   - POST `<run_control_callback.base_url>/internal/agent-runs/<run_id>/standard-context/invoke`
 *   - header `x-deep-agent-internal-key: <key>`
 *   - body `{orgId, attemptId, leaseEpoch, toolCallId, toolName, toolArgs}`（契约 `StandardContextInvocation`）
 * 断言逐条对着它；另证两件事：`[n]` 只取 API 真实回的 `accepted[].index`，回调缺席时一个请求都不发。
 */
import { describe, expect, it } from "vitest";
import { StandardContextInvocation } from "@repo/contracts/standard-context-tools";
import { fixture } from "./loopback-deep-agent-fixture";

const TRIGGER = "cite-trigger";
const QUERY = "zephyrquill";
const ENV = { LOOPBACK_DEEP_AGENT_CITE_TRIGGER: TRIGGER, LOOPBACK_DEEP_AGENT_CITE_QUERY: QUERY };
const CALLBACK = {
  base_url: "http://127.0.0.1:4001/", key: "internal-key-not-a-secret",
  org_id: "org-4260", run_id: "run-4260", attempt_id: "attempt-1", lease_epoch: 1,
};

interface Seen { url: string; headers?: Record<string, string>; body: any }

function apiFetch(seen: Seen[], respond: (body: any) => { status: number; body: unknown }) {
  return (async (url: unknown, init: unknown) => {
    const options = (init ?? {}) as { headers?: Record<string, string>; body?: string };
    const body = JSON.parse(options.body ?? "null");
    seen.push({ url: String(url), headers: options.headers, body });
    const out = respond(body);
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

const SEARCH_HIT = {
  items: [{ sourceId: "segment:seg-1", versionId: "ver-1@sha256:abc", title: "own.md", excerpt: "zephyrquill", citationAnchor: {} }],
  scopeMode: "organization-index-fts", truncated: false,
};

async function runTurn(request: ReturnType<typeof fixture>, callback: unknown) {
  await request("POST", "/threads", { thread_id: "t" });
  await request("POST", "/threads/t/runs", {
    input: { messages: [{ role: "user", content: TRIGGER }] },
    ...(callback === undefined ? {} : { config: { configurable: { run_control_callback: callback } } }),
  });
  return request("GET", "/threads/t/state");
}
const finalText = (state: any): string => state.values.messages[state.values.messages.length - 1].content;

describe("loopback deep-agent 替身 · 引用闭环剧本（issue #4260）", () => {
  it("检索 → 引用都真的打到 standard-context 回调上，终稿的 [n] 取 API 回的 index", async () => {
    const seen: Seen[] = [];
    const request = fixture(ENV, apiFetch(seen, (body) => body.toolName === "wx_knowledge_search"
      ? { status: 200, body: SEARCH_HIT }
      : { status: 200, body: { accepted: [{ index: 1, sourceFullName: "own.md", sourceId: "segment:seg-1" }], rejected: [] } }));
    const state = await runTurn(request, CALLBACK);

    expect(seen.map((s) => s.body.toolName)).toEqual(["wx_knowledge_search", "wx_cite"]);
    for (const s of seen) {
      expect(s.url).toBe("http://127.0.0.1:4001/internal/agent-runs/run-4260/standard-context/invoke");
      expect(s.headers?.["x-deep-agent-internal-key"]).toBe(CALLBACK.key);
      // 请求体必须过产品契约本身——替身的方言不许宽于上游。
      expect(StandardContextInvocation.safeParse(s.body).success).toBe(true);
    }
    expect(seen[0]!.body.toolArgs).toEqual({ query: QUERY, scope: "organization-index", limit: 1 });
    expect(seen[1]!.body.toolArgs).toEqual({ citations: [{ sourceId: "segment:seg-1", versionId: "ver-1@sha256:abc" }] });

    const calls = state.values.messages.flatMap((m: any) => m.tool_calls ?? []).map((c: any) => c.name);
    expect(calls).toEqual(["wx_knowledge_search", "wx_cite"]);
    expect(finalText(state)).toContain("[1]");
    expect(finalText(state)).toContain("own.md");
  });

  it("引用被 API 拒绝时终稿不带任何 [n]，不编一个编号", async () => {
    const seen: Seen[] = [];
    const request = fixture(ENV, apiFetch(seen, (body) => body.toolName === "wx_knowledge_search"
      ? { status: 200, body: SEARCH_HIT }
      : { status: 200, body: { accepted: [], rejected: [{ sourceId: "segment:seg-1", reason: "source_not_visible" }] } }));
    const state = await runTurn(request, CALLBACK);
    expect(seen).toHaveLength(2);
    expect(finalText(state)).not.toMatch(/\[\d+\]/);
  });

  it("检索无命中时不发 wx_cite", async () => {
    const seen: Seen[] = [];
    const request = fixture(ENV, apiFetch(seen, () => ({ status: 200, body: { items: [], scopeMode: "organization-index-fts", truncated: false } })));
    const state = await runTurn(request, CALLBACK);
    expect(seen.map((s) => s.body.toolName)).toEqual(["wx_knowledge_search"]);
    expect(finalText(state)).not.toMatch(/\[\d+\]/);
  });

  it("回调缺席（或缺 attempt_id）时一个请求都不发", async () => {
    // 不注入 fetch —— 真发了请求会以 ReferenceError 露馅。
    const noCallback = await runTurn(fixture(ENV), undefined);
    expect(finalText(noCallback)).not.toMatch(/\[\d+\]/);
    const { attempt_id: _drop, ...partial } = CALLBACK;
    const noAttempt = await runTurn(fixture(ENV), partial);
    expect(finalText(noAttempt)).not.toMatch(/\[\d+\]/);
  });

  it("开关未设置时同一句话走默认剧本，不发请求", async () => {
    const state = await runTurn(fixture(), CALLBACK);
    const calls = state.values.messages.flatMap((m: any) => m.tool_calls ?? []).map((c: any) => c.name);
    expect(calls).not.toContain("wx_cite");
  });
});
