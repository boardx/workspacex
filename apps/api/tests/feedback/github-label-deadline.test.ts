import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchGithubIssueCreator, githubIssueConfig } from "../../src/infrastructure/feedback/github-issue-creator";
import { GithubIssueCreationError } from "../../src/application/feedback/notification-ports";

const labels = ["user-feedback", "feedback-loop", ...Array.from({ length: 20 }, (_, i) => `tag-${i}`)];
const draft = { title: "feedback", body: "details", labels };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.useRealTimers());

describe("label provisioning deadlines", () => {
  it("provisions 22 mixed labels with bounded concurrency and independent issue deadline", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    const existing = new Set(labels.slice(0, 2));
    let issueCount = 0;
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      active--;
      const url = String(input);
      if (url.endsWith("/issues")) {
        issueCount++;
        expect(existing.size).toBe(22);
        expect(JSON.parse(String(init?.body)).labels).toEqual(labels);
        return response({ html_url: "https://github.com/boardx/workspacex/issues/1", number: 1 });
      }
      if (init?.method === "POST") {
        existing.add(JSON.parse(String(init.body)).name);
        return response({}, 422); // another creator won: confirmation must still run
      }
      const name = decodeURIComponent(url.split("/labels/")[1]!);
      return response({ name }, existing.has(name) ? 200 : 404);
    });
    const result = new FetchGithubIssueCreator({ ...githubIssueConfig(), token: "test" }, request).create(draft);
    const assertion = expect(result).resolves.toMatchObject({ number: 1 });
    await vi.runAllTimersAsync();
    await assertion;
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(issueCount).toBe(1);
    expect(request).toHaveBeenCalledTimes(63);
  });

  it.each(["lookup", "create", "confirm", "issue"])("aborts a stalled %s request without later issue creation", async (stage) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let lookups = 0;
    let issueCount = 0;
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const current = url.endsWith("/issues") ? "issue" : init?.method === "POST" ? "create" : ++lookups === 1 ? "lookup" : "confirm";
      if (current === "issue") issueCount++;
      if (current === stage) {
        signals.push(init!.signal!);
        // Deliberately ignores abort: late responses must not start the next request.
        await new Promise((resolve) => setTimeout(resolve, 11_000));
      }
      if (current === "lookup") return response({}, 404);
      if (current === "create") return response({}, 422);
      return response({ name: "x", html_url: "https://github.com/boardx/workspacex/issues/1", number: 1 });
    });
    const result = new FetchGithubIssueCreator({ ...githubIssueConfig(), token: "test" }, request)
      .create({ ...draft, labels: ["x"] });
    const assertion = expect(result).rejects.toBeInstanceOf(GithubIssueCreationError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(signals[0]?.aborted).toBe(true);
    expect(issueCount).toBe(stage === "issue" ? 1 : 0);
    expect(request).toHaveBeenCalledTimes(["lookup", "create", "confirm", "issue"].indexOf(stage) + 1);
  });

  it("caps the batch at 120 seconds and aborts slow requests before issuing more work", async () => {
    vi.useFakeTimers();
    let issueCount = 0;
    const signals: AbortSignal[] = [];
    // Each request fits its own deadline, but the full batch must still be bounded.
    const existing = new Set<string>();
    const existingRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      signals.push(init!.signal!);
      if (String(input).endsWith("/issues")) issueCount++;
      await new Promise((resolve) => setTimeout(resolve, 9_000));
      if (init?.method === "POST") {
        existing.add(JSON.parse(String(init.body)).name);
        return response({}, 422);
      }
      const name = decodeURIComponent(String(input).split("/labels/")[1]!);
      return response({ name }, existing.has(name) ? 200 : 404);
    });
    const result = new FetchGithubIssueCreator({ ...githubIssueConfig(), token: "test" }, existingRequest)
      .create(draft);
    const assertion = expect(result).rejects.toBeInstanceOf(GithubIssueCreationError);
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    const countAtDeadline = existingRequest.mock.calls.length;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await vi.runAllTimersAsync();
    expect(existingRequest).toHaveBeenCalledTimes(countAtDeadline);
    expect(issueCount).toBe(0);
  });

  it("cancels other workers and queued labels on HTTP failure", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      signals.push(init!.signal!);
      const first = signals.length === 1;
      await new Promise((resolve) => setTimeout(resolve, first ? 100 : 1_000));
      return response({}, first ? 403 : 404);
    });
    const result = new FetchGithubIssueCreator({ ...githubIssueConfig(), token: "test" }, request).create(draft);
    const assertion = expect(result).rejects.toBeInstanceOf(GithubIssueCreationError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
