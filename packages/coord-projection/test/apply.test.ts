// 投影应用层幂等反证（#376）。
//
// 被测场景严格照 issue 的 Verification 写：**在一条评论成功之后**注入 GitHub API 失败，
// 重放同一批次，断言那条成功的评论恰好存在一次、而其余动作补齐。
//
// 每个用例都是成对的反证：先跑"修复前"的形态（不注入发件箱 = 旧行为），证明它**确实**
// 产生重复副作用；再跑"修复后"的形态（注入发件箱），证明重复消失。只断言修复后为真
// 的测试是立不住的——它在缺陷仍然存在时也会通过。
import { describe, expect, it } from "vitest";
import { applyCalls, type ProjectionOutbox } from "../src/apply";
import { issueCommentKey, type GithubCall } from "../src/engine";

const OWNER = "boardx";
const REPO = "workspacex";
const API = "https://api.github.com";

/** 记录所有实际打到 GitHub 的请求；failOn 命中时返回 500（注入"部分失败"）。 */
function fakeGitHub(failOn: (url: string, body: Record<string, unknown>) => boolean) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const u = String(url);
    posts.push({ url: u, body });
    if (failOn(u, body)) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ id: posts.length }), { status: 201 });
  }) as unknown as typeof fetch;
  /** 某条评论正文在 issue 上实际出现了几次（GitHub 侧的可见副作用）。 */
  const commentsWith = (marker: string) =>
    posts.filter((p) => p.url.endsWith("/comments") && String(p.body["body"] ?? "").includes(marker)).length;
  return { posts, fetchImpl, commentsWith };
}

/** 内存发件箱：语义等价 RepoHub DO 的 projection_outbox 表（持久性由那边的用例覆盖）。 */
function memoryOutbox(): ProjectionOutbox & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    delivered: async (ks) => ks.filter((k) => keys.has(k)),
    record: async (k) => {
      keys.add(k);
    },
  };
}

const commentA: GithubCall = {
  kind: "issue_comment",
  issue_number: 371,
  body: "🔄 **intent.progress** · `coord-main` · 2026-08-03T07:00:00Z\n<sub>event_id=evt_A</sub>",
  idempotency_key: issueCommentKey(371, "evt_A"),
};
const commentB: GithubCall = {
  kind: "issue_comment",
  issue_number: 371,
  body: "🚧 **intent.blocker** · `wrk-1` · 2026-08-03T07:01:00Z\n<sub>event_id=evt_B</sub>",
  idempotency_key: issueCommentKey(371, "evt_B"),
};
const andonStatus: GithubCall = {
  kind: "commit_status",
  sha: "aaa1111",
  state: "failure",
  context: "coord/andon",
  description: "停线（repo）：main 挂了",
};

// 批次顺序即"先成功一条评论，再失败"：A 成功 → B 失败 → status 仍被尝试
const BATCH: GithubCall[] = [commentA, commentB, andonStatus];
/** 第一次 tick：只让 evt_B 那条评论失败，模拟 issue 描述的"部分成功"。 */
const failOnlyB = (_u: string, b: Record<string, unknown>) => String(b["body"] ?? "").includes("evt_B");

describe("#376 投影重放幂等：issue 评论（追加式动作）", () => {
  it("反证（修复前的形态）：不接发件箱时，部分失败后重放会把已成功的评论再发一次", async () => {
    const gh = fakeGitHub(failOnlyB);
    const opts = { owner: OWNER, repo: REPO, token: "t", calls: BATCH, apiBase: API, fetchImpl: gh.fetchImpl };

    const first = await applyCalls(opts); // tick 1：A 成功、B 失败 → 上层不推进游标
    expect(first).toEqual({ applied: 2, failed: 1, skipped: 0 });
    expect(gh.commentsWith("evt_A")).toBe(1);

    await applyCalls(opts); // tick 2：重放同一批

    // 缺陷本体：已经成功的 A 在 issue 上变成了两条评论。
    expect(gh.commentsWith("evt_A")).toBe(2);
  });

  it("修复后：接上发件箱，重放时已成功的评论恰好一次，其余动作补齐", async () => {
    const gh = fakeGitHub(failOnlyB);
    const outbox = memoryOutbox();
    const opts = { owner: OWNER, repo: REPO, token: "t", calls: BATCH, apiBase: API, fetchImpl: gh.fetchImpl, outbox };

    const first = await applyCalls(opts); // tick 1：A 成功并登记、B 失败（未登记）
    expect(first).toEqual({ applied: 2, failed: 1, skipped: 0 });
    expect(outbox.keys).toEqual(new Set([issueCommentKey(371, "evt_A")]));

    // tick 2：GitHub 侧已恢复，重放同一批
    const healthy = fakeGitHub(() => false);
    const second = await applyCalls({ ...opts, fetchImpl: healthy.fetchImpl });

    // A 被发件箱挡掉（不是失败，是已投递）；B 与 status 补齐
    expect(second).toEqual({ applied: 2, failed: 0, skipped: 1 });
    expect(healthy.commentsWith("evt_A")).toBe(0);
    expect(gh.commentsWith("evt_A") + healthy.commentsWith("evt_A")).toBe(1); // 全程恰好一次
    expect(healthy.commentsWith("evt_B")).toBe(1); // 剩余动作完成
    expect(healthy.posts.filter((p) => p.url.includes("/statuses/"))).toHaveLength(1);
    expect(second.failed).toBe(0); // 游标可以推进了
  });

  it("失败的动作不进发件箱：否则一次 5xx 就会让该评论被永久吞掉（漏投）", async () => {
    const gh = fakeGitHub(failOnlyB);
    const outbox = memoryOutbox();
    await applyCalls({ owner: OWNER, repo: REPO, token: "t", calls: BATCH, apiBase: API, fetchImpl: gh.fetchImpl, outbox });
    expect(outbox.keys.has(issueCommentKey(371, "evt_B"))).toBe(false);
  });

  it("整批都已投递时 applied=0/failed=0：上层据此推进游标，不会卡死", async () => {
    const outbox = memoryOutbox();
    const first = fakeGitHub(() => false);
    const base = { owner: OWNER, repo: REPO, token: "t", calls: [commentA, commentB], apiBase: API, outbox };
    await applyCalls({ ...base, fetchImpl: first.fetchImpl });

    const replay = fakeGitHub(() => false);
    expect(await applyCalls({ ...base, fetchImpl: replay.fetchImpl })).toEqual({
      applied: 0, failed: 0, skipped: 2,
    });
    expect(replay.posts).toHaveLength(0);
  });
});

describe("#376 覆盖式动作不受影响", () => {
  it("commit_status / check_run 没有幂等键，每 tick 照常重发（andon/lease 对账依赖它）", async () => {
    const outbox = memoryOutbox();
    const calls: GithubCall[] = [
      andonStatus,
      { kind: "check_run", head_sha: "aaa1111", name: "coord/lease", conclusion: "success", title: "持有者 wrk-1", summary: "s" },
    ];
    const base = { owner: OWNER, repo: REPO, token: "t", calls, apiBase: API, outbox };

    const t1 = fakeGitHub(() => false);
    expect(await applyCalls({ ...base, fetchImpl: t1.fetchImpl })).toEqual({ applied: 2, failed: 0, skipped: 0 });
    const t2 = fakeGitHub(() => false);
    expect(await applyCalls({ ...base, fetchImpl: t2.fetchImpl })).toEqual({ applied: 2, failed: 0, skipped: 0 });
    expect(t2.posts).toHaveLength(2); // 没有被当成"已投递"跳过
    expect(outbox.keys.size).toBe(0);
  });
});

describe("#376 发件箱故障降级", () => {
  it("delivered() 抛错时退化为不去重（可能重复），绝不把动作丢掉", async () => {
    const gh = fakeGitHub(() => false);
    const broken: ProjectionOutbox = {
      delivered: async () => {
        throw new Error("do_unreachable");
      },
      record: async () => {},
    };
    const r = await applyCalls({
      owner: OWNER, repo: REPO, token: "t", calls: [commentA], apiBase: API, fetchImpl: gh.fetchImpl, outbox: broken,
    });
    expect(r).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(gh.commentsWith("evt_A")).toBe(1);
  });

  it("record() 抛错不把已发出的评论算作失败（否则卡住游标反而招致更多重复）", async () => {
    const gh = fakeGitHub(() => false);
    const broken: ProjectionOutbox = { delivered: async () => [], record: async () => { throw new Error("do_write_failed"); } };
    const r = await applyCalls({
      owner: OWNER, repo: REPO, token: "t", calls: [commentA], apiBase: API, fetchImpl: gh.fetchImpl, outbox: broken,
    });
    expect(r).toEqual({ applied: 1, failed: 0, skipped: 0 });
  });
});
