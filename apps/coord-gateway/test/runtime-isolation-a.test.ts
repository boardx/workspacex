import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// 与 runtime-isolation-b 互为反证：singleWorker 共享 runtime 时，第二个文件
// 会撞到 src/index.ts hot-transform DO invalidation，或读到第一个文件的事件。
const REPO_URL = "https://gw.test/api/coord/repos/boardx/workspacex";
const OWN_ISSUE = 940_301;
const PEER_ISSUE = 940_302;

describe("workerd test-file runtime isolation A", () => {
  it("cannot observe events written by the peer test file", async () => {
    const written = await SELF.fetch(`${REPO_URL}/mirror/upsert`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "issue",
        data: {
          number: OWN_ISSUE,
          state: "open",
          title: "runtime-isolation-a",
          labels: [],
          assignees: [],
        },
      }),
    });
    expect(written.status).toBe(200);

    const events = await (
      await SELF.fetch(`${REPO_URL}/events?limit=500`, {
        headers: { authorization: "Bearer test-api-token" },
      })
    ).json<{ events: Array<{ resource_id: string }> }>();

    expect(events.events.some((event) => event.resource_id === `issue:${OWN_ISSUE}`)).toBe(true);
    expect(events.events.some((event) => event.resource_id === `issue:${PEER_ISSUE}`)).toBe(false);
  });
});
