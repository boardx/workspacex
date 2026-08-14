/**
 * F176 —— **归因从 `agent_runs` 查出来，不接受前端传入**。这是本 feature 的核心不变量。
 *
 * ## 为什么它值一个独立文件
 *
 * 满意度是 UC-3.6 整条改进闭环的输入（👎 → 聚合 → 提案 → 新版本）。前端能传归因，
 * 就等于任何用户都能给任意 skill 版本刷满意度——而且刷出来的数字与真实数字
 * **长得一模一样**，没有任何下游能分辨。所以这条不是「顺便测一下」，
 * 它就是这个 feature 的主张本身。
 *
 * ## 三道防线，逐条断言
 *
 *   ① **契约层**：`rateMessage.in` 是 `.strict()` 的 `{ messageId, verdict, reason }`，
 *      多带一个 `skillVersionId` 当场被 zod 拒。
 *   ② **用例层**：`submitMessageRating` 的入参里**没有**可以传归因的地方，
 *      attribution 只可能来自 `deps.ratings.resolveForMessage`。这条按源码断言——
 *      日后有人给 input 加个 attribution 字段，签名断言会红。
 *   ③ **落库**：真库里存的是服务端查出来的那个版本 id。
 *
 * ## 归因规则：恰好一个 skill 版本才归因
 *
 * `agent_runs.skill_version_ids` 是数组，契约的 attribution 只有单个 `skillVersionId`。
 * 0 个与 ≥2 个都降级为「只计 agent 级」。⚠ ≥2 时挑一个是 I-20 逐字禁止的
 * 「不得随意归给某个 skill」——把一条 👎 记在 A 头上会让 B 的满意度偏高、A 的偏低，
 * 而两个数字看起来都很正常。**可见的少算，好过看不见的错算。**
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { skills as C } from "@repo/contracts";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgMessageRatingRepository } from "../../src/infrastructure/skill/pg-message-rating-repository";
import type { MessageRatingRepository } from "../../src/application/skill/ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f176-attr";
const PROJECT = "proj-f176-attr";
const THREAD = "thread-f176-attr";
const ACTOR = "u-f176-attr-actor";

let db: PgDatabase;
let repo: MessageRatingRepository;

/** 建一条「由某次 run 产出的 AI 消息」，run 上钉 `versionIds` 这些 skill 版本。 */
async function seedAiMessage(opts: {
  messageId: string; runId: string; versionIds: readonly string[];
  registerVersions?: boolean;
}): Promise<void> {
  const inputId = `${opts.runId}-input`;
  await addChatMessage({ orgId: ORG, id: inputId, threadId: THREAD, body: "问", authorId: ACTOR });
  await asApp(ORG, (c) => c.query(
    `INSERT INTO agent_runs
       (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
        skill_version_ids,model_provider,model_id,status)
     VALUES ($1,$2,$3,$4,'agent-f176','agent-version-f176',$5::jsonb,'p','m','succeeded')`,
    [opts.runId, ORG, THREAD, inputId, JSON.stringify(opts.versionIds)],
  ));
  await asApp(ORG, (c) => c.query(
    `INSERT INTO chat_messages
       (id,org_id,thread_id,author_kind,author_id,agent_id,body,agent_run_id)
     VALUES ($1,$2,$3,'agent','agent-f176','agent-f176','答',$4)`,
    [opts.messageId, ORG, THREAD, opts.runId],
  ));
  if (opts.registerVersions !== false) {
    for (const vid of opts.versionIds) {
      const skillId = `skill-of-${vid}`;
      await asApp(ORG, (c) => c.query(
        `INSERT INTO skills (id,org_id,name,stable_name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$3,$3,'enabled',$4,now(),now())
         ON CONFLICT DO NOTHING`,
        [skillId, ORG, skillId, ACTOR],
      ));
      await asApp(ORG, (c) => c.query(
        `INSERT INTO skill_versions
           (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
         -- published=false：归因只问「这个版本属于哪个 skill」，与它有没有发布无关。
         -- 发布态由 skill_versions 自己的触发器管（草稿→发布），这里不绕过它。
         VALUES ($1,$2,$3,$1,repeat('a',64),'{}'::jsonb,$4,now(),false)`,
        [vid, ORG, skillId, ACTOR],
      ));
    }
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgMessageRatingRepository(db).forOrg(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

afterAll(async () => {
  await db.close();
});

describe("F176 归因由服务端派生", () => {
  it("① 契约层：请求体里多带一个 skillVersionId 会被 .strict() 当场拒", () => {
    const good = C.operations.rateMessage.in.safeParse({
      messageId: "m1", verdict: "down", reason: null,
    });
    expect(good.success, "合法请求被拒了 —— 下面那条断言会因此失去意义").toBe(true);

    const forged = C.operations.rateMessage.in.safeParse({
      messageId: "m1", verdict: "down", reason: null,
      skillId: "skill-victim", skillVersionId: "sv-victim",
    });
    expect(forged.success, "伪造的归因通过了契约校验").toBe(false);
  });

  it("② 用例层：submitMessageRating 的入参里没有任何可以传归因的地方", () => {
    const src = readFileSync(
      join(__dirname, "../../src/application/skill/submit-message-rating.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const input = /export interface SubmitMessageRatingInput \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    expect(input.length, "读不到入参声明 —— 这条断言在空转").toBeGreaterThan(0);
    for (const forbidden of ["attribution", "skillId", "skillVersionId", "agentId"]) {
      expect(input, `入参里出现了 ${forbidden} —— 归因可以从外面传进来了`)
        .not.toContain(forbidden);
    }
    // 阳性对照：attribution 确实来自仓储。
    expect(src).toContain("deps.ratings.resolveForMessage");
  });

  it("③ 恰好一个 skill 版本 ⇒ 归因到它，skillId 从 skill_versions 查出来", async () => {
    await seedAiMessage({ messageId: "m-one", runId: "run-one", versionIds: ["sv-1"] });

    expect(await repo.resolveForMessage("m-one")).toEqual({
      agentId: "agent-f176", skillId: "skill-of-sv-1", skillVersionId: "sv-1",
    });
  });

  it("③ 零个 skill 版本 ⇒ 只计 agent 级", async () => {
    await seedAiMessage({ messageId: "m-zero", runId: "run-zero", versionIds: [] });

    expect(await repo.resolveForMessage("m-zero")).toEqual({
      agentId: "agent-f176", skillId: null, skillVersionId: null,
    });
  });

  it("③ 两个 skill 版本 ⇒ **也是**只计 agent 级，不挑一个（I-20 逐字禁止随意归给某 skill）", async () => {
    await seedAiMessage({ messageId: "m-two", runId: "run-two", versionIds: ["sv-a", "sv-b"] });

    const attribution = await repo.resolveForMessage("m-two");
    expect(attribution).toEqual({ agentId: "agent-f176", skillId: null, skillVersionId: null });
    // 把「挑第一个」写进实现时，上面那条会红；这条钉住它不是**碰巧**没挑到 b。
    expect(attribution?.skillVersionId).not.toBe("sv-a");
    expect(attribution?.skillVersionId).not.toBe("sv-b");
  });

  it("③ 版本行已被清理 ⇒ 不为一条不存在的版本编造归属", async () => {
    await seedAiMessage({
      messageId: "m-ghost", runId: "run-ghost", versionIds: ["sv-ghost"], registerVersions: false,
    });

    expect(await repo.resolveForMessage("m-ghost")).toEqual({
      agentId: "agent-f176", skillId: null, skillVersionId: null,
    });
  });

  it("③ 人类发的消息不可归因 ⇒ null（调用方据此拒绝，不是编一个空 agentId）", async () => {
    await addChatMessage({
      orgId: ORG, id: "m-human", threadId: THREAD, body: "我说的", authorId: ACTOR,
    });

    expect(await repo.resolveForMessage("m-human")).toBeNull();
  });

  it("④ 落库的是服务端查出来的版本，不是任何外部输入", async () => {
    await seedAiMessage({ messageId: "m-real", runId: "run-real", versionIds: ["sv-real"] });
    const attribution = await repo.resolveForMessage("m-real");
    await repo.save({
      ratingId: "r-real", messageId: "m-real", raterId: ACTOR, verdict: "down",
      reason: null, attribution: attribution!,
    });

    const { rows } = await asApp(ORG, (c) => c.query<{ skill_version_id: string }>(
      "SELECT skill_version_id FROM message_ratings WHERE org_id=$1 AND id='r-real'", [ORG],
    ));
    expect(rows[0]?.skill_version_id).toBe("sv-real");
  });
});
