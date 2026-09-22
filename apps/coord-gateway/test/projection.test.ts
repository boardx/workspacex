// 反向投影冷启动回归（#814 review 要求）：/events 的默认语义从 #814 起改为
// "最近 N 条"（修 #813 的冻结缺陷），projectRepo 因此必须在 cursor 为 null（首次
// 投影/新仓冷启动）时显式传 since=MIN_EVENT_ID 走"从头分页"分支，而不是省略 since
// 依赖默认行为——否则冷启动会跳过 EVENTS_BATCH 条之前的所有历史事件（漏投）。
// 用真实 env.REPOHUB（cloudflare:test 活体 DO 绑定）包一层拦截层记录每次 stub.fetch
// 的 URL，断言 cursor 为 null 时请求的是 since=MIN_EVENT_ID，而非无 since。
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyCalls } from "@repo/coord-projection";
import { runProjectionTick } from "../src/projection";
import type { Env } from "../src/index";

let privatePem = "";

function pemFromPkcs8(der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  )) as CryptoKeyPair;
  privatePem = pemFromPkcs8((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
});

/** 包一层拦截 env.REPOHUB.get(id).fetch，记录每次请求的 URL，转发给真实 stub。 */
function interceptRepoHub(
  real: DurableObjectNamespace,
  onFetch: (url: string) => void,
): DurableObjectNamespace {
  return {
    ...real,
    idFromName: (name: string) => real.idFromName(name),
    get: (id: DurableObjectId) => {
      const realStub = real.get(id);
      return {
        ...realStub,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          onFetch(String(input));
          return realStub.fetch(input as never, init);
        }) as typeof fetch,
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

describe("projection 冷启动 since 哨兵", () => {
  it("cursor 为 null（新仓/首次投影）时，请求 /events 显式带 since=MIN_EVENT_ID，不省略 since", async () => {
    const repo = "test/projection-bootstrap-1";
    // 冷启动前先有一条历史事件（模拟"事件早于第一次 cron tick 就已存在"）。
    await env.REPOHUB.get(env.REPOHUB.idFromName(repo)).fetch("https://repohub/relay/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "directory.agent.heartbeat",
        resource_id: "agent:agt_bootstrap",
        agent_id: "agt_bootstrap",
        payload: { agent_id: "agt_bootstrap", at: "2026-07-18T00:00:00Z" },
      }),
    });

    const urls: string[] = [];
    const testEnv: Env = {
      ...(env as unknown as Env),
      REPOHUB: interceptRepoHub(env.REPOHUB, (url) => urls.push(url)),
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privatePem,
      PROJECTION_REPOS: repo,
    };

    await runProjectionTick(testEnv);

    const eventsCall = urls.find((u) => u.includes("/events?"));
    expect(eventsCall).toBeTruthy();
    expect(eventsCall).toContain("since=evt_00000000000000000000000000");

    // 冷启动确实处理了那条历史事件：游标从 null 推进到它的 event_id（没有被跳过）。
    const cursorRes = await env.REPOHUB.get(env.REPOHUB.idFromName(repo)).fetch("https://repohub/projector/cursor");
    const { cursor } = await cursorRes.json<{ cursor: string | null }>();
    expect(cursor).toMatch(/^evt_/);
  });

  it("cursor 非 null（已投影过）时，请求 /events 带该真实 cursor 作为 since", async () => {
    const repo = "test/projection-bootstrap-2";
    const stub = env.REPOHUB.get(env.REPOHUB.idFromName(repo));
    await stub.fetch("https://repohub/relay/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "directory.agent.heartbeat",
        resource_id: "agent:agt_seed",
        agent_id: "agt_seed",
        payload: { agent_id: "agt_seed", at: "2026-07-18T00:00:00Z" },
      }),
    });
    // 先跑一次把游标推进，制造"已投影过"的状态。
    await runProjectionTick({ ...(env as unknown as Env), GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privatePem, PROJECTION_REPOS: repo });
    const { cursor: establishedCursor } = await (await stub.fetch("https://repohub/projector/cursor")).json<{ cursor: string | null }>();
    expect(establishedCursor).toMatch(/^evt_/);

    const urls: string[] = [];
    const testEnv: Env = {
      ...(env as unknown as Env),
      REPOHUB: interceptRepoHub(env.REPOHUB, (url) => urls.push(url)),
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privatePem,
      PROJECTION_REPOS: repo,
    };
    await runProjectionTick(testEnv);

    const eventsCall = urls.find((u) => u.includes("/events?"));
    expect(eventsCall).toBeTruthy();
    expect(eventsCall).toContain(`since=${establishedCursor}`);
  });

  // ---- #376 端到端反证：真 RepoHub DO + 真 applyCalls + 真发件箱接线 ----
  // 两条 intent 事件锚在同一 issue 上；第一次 tick 注入"第二条评论失败"，
  // 于是游标不推进、下一 tick 重放整批。断言第一条评论全程恰好投递一次。
  async function seedTwoIntents(stub: DurableObjectStub): Promise<void> {
    for (const summary of ["第一条：已经成功投递", "第二条：投递时 GitHub 挂了"]) {
      const r = await stub.fetch("https://repohub/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "intent.progress", resource_id: "issue:376", agent_id: "coord-main", payload: { summary },
        }),
      });
      expect(r.status).toBe(201);
    }
  }

  /** 记录真实打到 GitHub 的评论正文；含 failMarker 的那条返回 500。 */
  function githubSpy(failMarker: string | null) {
    const comments: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const text = String(body["body"] ?? "");
      if (String(url).endsWith("/comments")) {
        if (failMarker !== null && text.includes(failMarker)) return new Response("boom", { status: 500 });
        comments.push(text);
      }
      return new Response(JSON.stringify({ id: comments.length }), { status: 201 });
    }) as unknown as typeof fetch;
    const countWith = (marker: string) => comments.filter((c) => c.includes(marker)).length;
    return { comments, fetchImpl, countWith };
  }

  it("反证（修复前的形态）：绕过发件箱时，部分失败重放会把已成功的意图评论再刷一条", async () => {
    const repo = "test/projection-outbox-regression";
    const stub = env.REPOHUB.get(env.REPOHUB.idFromName(repo));
    await seedTwoIntents(stub);
    const testEnv: Env = {
      ...(env as unknown as Env), GITHUB_APP_ID: "test", GITHUB_APP_PRIVATE_KEY: privatePem, PROJECTION_REPOS: repo,
    };
    const auth = { installationToken: async () => "token" } as never;

    const t1 = githubSpy("第二条");
    // outbox: undefined 刻意抹掉 projectRepo 接上的发件箱 —— 复现修复前的代码路径
    await runProjectionTick(testEnv, { auth, apply: (o) => applyCalls({ ...o, outbox: undefined, fetchImpl: t1.fetchImpl }) });
    expect(t1.countWith("第一条")).toBe(1);

    const { cursor } = await (await stub.fetch("https://repohub/projector/cursor")).json<{ cursor: string | null }>();
    expect(cursor).toBeNull(); // 有失败 → 游标未推进 → 下 tick 重放整批

    const t2 = githubSpy(null); // GitHub 恢复
    await runProjectionTick(testEnv, { auth, apply: (o) => applyCalls({ ...o, outbox: undefined, fetchImpl: t2.fetchImpl }) });

    // 缺陷本体：第一条评论在 issue 上出现了两次
    expect(t1.countWith("第一条") + t2.countWith("第一条")).toBe(2);
  });

  it("修复后：发件箱让重放幂等——已成功的评论恰好一次，剩余动作补齐，游标随后推进", async () => {
    const repo = "test/projection-outbox-fixed";
    const stub = env.REPOHUB.get(env.REPOHUB.idFromName(repo));
    await seedTwoIntents(stub);
    const testEnv: Env = {
      ...(env as unknown as Env), GITHUB_APP_ID: "test", GITHUB_APP_PRIVATE_KEY: privatePem, PROJECTION_REPOS: repo,
    };
    const auth = { installationToken: async () => "token" } as never;

    // tick 1：第一条成功（并登记进 DO 的发件箱）、第二条 500
    const t1 = githubSpy("第二条");
    await runProjectionTick(testEnv, { auth, apply: (o) => applyCalls({ ...o, fetchImpl: t1.fetchImpl }) });
    expect(t1.countWith("第一条")).toBe(1);
    expect(t1.countWith("第二条")).toBe(0);
    expect((await (await stub.fetch("https://repohub/projector/cursor")).json<{ cursor: string | null }>()).cursor).toBeNull();

    // tick 2：重放同一批，GitHub 已恢复
    const t2 = githubSpy(null);
    await runProjectionTick(testEnv, { auth, apply: (o) => applyCalls({ ...o, fetchImpl: t2.fetchImpl }) });

    expect(t2.countWith("第一条")).toBe(0);                        // 被发件箱挡下
    expect(t1.countWith("第一条") + t2.countWith("第一条")).toBe(1); // 全程恰好一次
    expect(t2.countWith("第二条")).toBe(1);                        // 剩余动作补齐

    // 整批无失败 → 游标推进；再来一个 tick 不会重复投递任何东西
    const cursorAfter = (await (await stub.fetch("https://repohub/projector/cursor")).json<{ cursor: string | null }>()).cursor;
    expect(cursorAfter).toMatch(/^evt_/);
    const t3 = githubSpy(null);
    await runProjectionTick(testEnv, { auth, apply: (o) => applyCalls({ ...o, fetchImpl: t3.fetchImpl }) });
    expect(t3.comments).toHaveLength(0);
  });

  it("GitHub apply 有失败时不推进游标，下一 tick 可重放同一事件批", async () => {
    const repo = "test/projection-apply-failure";
    const stub = env.REPOHUB.get(env.REPOHUB.idFromName(repo));
    const relay = await stub.fetch("https://repohub/intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "intent.progress",
        resource_id: "issue:371",
        agent_id: "coord-main",
        payload: { summary: "等待 Cloudflare 配置" },
      }),
    });
    expect(relay.ok).toBe(true);

    await runProjectionTick(
      { ...(env as unknown as Env), GITHUB_APP_ID: "test", GITHUB_APP_PRIVATE_KEY: privatePem, PROJECTION_REPOS: repo },
      {
        auth: { installationToken: async () => "token" } as never,
        apply: async () => ({ applied: 0, failed: 1, skipped: 0 }),
      },
    );

    const { cursor } = await (await stub.fetch("https://repohub/projector/cursor")).json<{ cursor: string | null }>();
    expect(cursor).toBeNull();
  });
});
