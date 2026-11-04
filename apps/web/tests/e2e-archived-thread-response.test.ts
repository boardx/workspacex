import type { Page, Route } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { installArchivedThreadResponse } from "../e2e/support/archived-thread-response";

async function fixture() {
  let matcher: string | RegExp | ((url: URL) => boolean) = "";
  let handler!: (route: Route) => Promise<void>;
  const page = {
    route: vi.fn(async (match: string | RegExp | ((url: URL) => boolean), callback: (route: Route) => Promise<void>) => { matcher = match; handler = callback; }),
    unroute: vi.fn(async () => {}),
    unrouteAll: vi.fn(async () => {}),
  };
  const stop = await installArchivedThreadResponse(page as unknown as Page, "/chat/current-thread");
  const matches = (url: string) => typeof matcher === "function" ? matcher(new URL(url))
    : matcher instanceof RegExp ? matcher.test(url)
      : new RegExp("^" + matcher.split("**").map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(url);
  const makeRoute = (url: string, method = "GET", status = 200) => {
    const body = { thread: { id: "current-thread", archived: false, title: "raw {title}" }, capabilities: ["artifact.land"], rightTabs: ["materials"] };
    const response = { status: () => status, json: vi.fn(async () => body) };
    return { body, response, route: {
      request: () => ({ method: () => method, url: () => url }),
      fallback: vi.fn(async () => {}),
      fetch: vi.fn(async () => response),
      fulfill: vi.fn(async () => {}),
    } };
  };
  return { page, stop, matches, makeRoute, handle: (route: ReturnType<typeof makeRoute>["route"]) => handler(route as unknown as Route) };
}

describe("CK-P8 current getThread fixture", () => {
  it("matches the current thread with query and excludes child endpoints and other threads", async () => {
    const f = await fixture();
    expect(f.matches("http://web/chat/threads/current-thread?fresh=1")).toBe(true);
    for (const path of ["current-thread/agents", "current-thread/attachments", "current-thread/queued-messages", "current-thread/messages", "other-thread"]) {
      expect(f.matches("http://web/chat/threads/" + path)).toBe(false);
    }
  });
  it("never fetches an unrelated agents response even if dispatched to the handler", async () => {
    const f = await fixture(); const r = f.makeRoute("http://web/chat/threads/current-thread/agents");
    await f.handle(r.route);
    expect(r.route.fetch).not.toHaveBeenCalled(); expect(r.route.fallback).toHaveBeenCalledOnce();
  });
  it("does not replay writes", async () => {
    const f = await fixture(); const r = f.makeRoute("http://web/chat/threads/current-thread", "POST");
    await f.handle(r.route); expect(r.route.fetch).not.toHaveBeenCalled();
  });
  it("fetches the real response and changes only thread.archived", async () => {
    const f = await fixture(); const r = f.makeRoute("http://web/chat/threads/current-thread?fresh=1");
    await f.handle(r.route);
    expect(r.route.fetch).toHaveBeenCalledOnce(); expect(r.response.json).toHaveBeenCalledOnce();
    expect(r.route.fulfill).toHaveBeenCalledWith({ response: r.response, json: { ...r.body, thread: { ...r.body.thread, archived: true } } });
    expect(r.body.thread.archived).toBe(false);
  });
  it("passes non-200 responses through without inventing archived data", async () => {
    const f = await fixture(); const r = f.makeRoute("http://web/chat/threads/current-thread", "GET", 403);
    await f.handle(r.route); expect(r.response.json).not.toHaveBeenCalled();
    expect(r.route.fulfill).toHaveBeenCalledWith({ response: r.response });
  });
  it("removes its own route and waits for an in-flight response before context disposal", async () => {
    const f = await fixture(); const r = f.makeRoute("http://web/chat/threads/current-thread");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    r.response.json.mockImplementation(async () => { await pending; return r.body; });
    const handling = f.handle(r.route);
    await Promise.resolve();
    let stopped = false;
    const stopping = f.stop().then(() => { stopped = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(stopped).toBe(false);
    release(); await handling; await stopping;
    expect(f.page.unroute).toHaveBeenCalledOnce();
    expect(f.page.unrouteAll).not.toHaveBeenCalled();
    expect(r.route.fulfill).toHaveBeenCalledOnce();
  });
  it("propagates response parse failures instead of swallowing them", async () => {
    const f = await fixture(); const r = f.makeRoute("http://web/chat/threads/current-thread");
    r.response.json.mockRejectedValue(new Error("invalid real body"));
    await expect(f.handle(r.route)).rejects.toThrow("invalid real body");
  });
});
