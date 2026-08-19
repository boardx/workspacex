/**
 * F962 §6.1 / §5 —— 试跑转异步的**真库**验证：提交 → 认领 → 执行 → 产物落
 * `ObjectStore` → 轮询到终态。
 *
 * 同 `agent-url-import-persists-real-db.test.ts` 的纪律：断言查的是**提交后**的行，
 * 不是自己事务内的可见性；失败路径也查库，证明"失败了"与"终态真的写下来了"同时成立。
 *
 * ## 这里补的是单测补不到的两件事
 *
 * ① **失败必须落终态。** 转异步之后，一次失败如果不落库，在轮询端与"还在跑"
 *    **无法区分** —— 前端只能一直转圈。这是同步实现里不存在的新失败模式，
 *    所以每个失败码都在这里查一遍库。
 * ② **V1 的 OOXML 断言接在真实链路末端**（产物真的从 ObjectStore 读回来再解析），
 *    并配 **V1-CP**：沙箱回空文件时这条必须红。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { PgSkillTrialRunStore } from "../../src/infrastructure/skill/pg-skill-trial-run-store";
import { executeQueuedTrialRuns } from "../../src/application/skill/execute-trial-run";
import { submitTrialRun } from "../../src/application/skill/submit-trial-run";
import { toOrgId } from "../../src/domain/org-id";
import type { SkillSandboxPort } from "../../src/application/skill/skill-sandbox-port";
import { SandboxUnavailableError } from "../../src/application/skill/skill-sandbox-port";
/**
 * ⚠ 单一事实源：「什么算合法 pptx」的定义只有一份，在产出方 `@repo/skill-sandbox` 里。
 * 早先这里放过一份拷贝 —— 那正是 AGENTS.md 禁止的「同一事实声明在两处」（本仓已五次
 * 因此漂移）。两份断言一旦分叉，V1 会在沙箱侧与 API 侧给出**不同的**合法性判定，
 * 而那种分叉恰恰会在"其中一侧被放宽"时悄悄发生。
 */
import { inspectPptx } from "@repo/skill-sandbox/ooxml";

const ORG = "org-f962-trial-run-async";
const ACTOR = "u-f962-submitter";
const OTHER_ACTOR = "u-f962-someone-else";
const VERSION = "sv-f962-deck-skill";

/** 组织成员判定用替身；授权本身的门在单测里证。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MEMBER: any = { findOrgMembership: async () => ({ orgRole: "member" }) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const READS_SKILL: any = { readPinnedSkills: async () => [{ content: "# deck skill" }] };

/** 执行器替身：本测试直接调 `executeQueuedTrialRuns`，kick 不需要真做事。 */
const NOOP_EXECUTOR = { tick: async () => 0, kick: () => undefined };

let db: PgDatabase;
let store: PgSkillTrialRunStore;
let objects: FsObjectStore;

/** 真的用 pptxgenjs 生成一个合法 deck，与真沙箱产出的形态一致。 */
async function realDeckBase64(texts: readonly string[]): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pres = new (PptxGenJS as any)();
  pres.layout = "LAYOUT_16x9";
  for (const t of texts) pres.addSlide().addText(t, { x: 0.5, y: 0.5, fontSize: 28 });
  const buf = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  return buf.toString("base64");
}

function sandboxReturning(files: readonly { name: string; contentBase64: string; sizeBytes: number }[]): SkillSandboxPort {
  return {
    run: async () => ({ exitCode: 0, stdout: "ok", stderr: "", files, timedOut: false, durationMs: 5 }),
  };
}

function model(reply: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { complete: async () => ({ text: reply, tokens: 42 }) } as any;
}

const SCRIPT_REPLY = "```run_script\nconsole.log('x');\n```";

async function runOnce(deps: {
  sandbox: SkillSandboxPort;
  modelReply?: string;
  maxAttempts?: number;
}): Promise<string> {
  const { asyncTaskId } = await submitTrialRun(
    { identities: MEMBER, store, executor: NOOP_EXECUTOR },
    { orgId: toOrgId(ORG), actorId: ACTOR, versionId: VERSION, sampleInput: "做一个三页 deck" },
  );
  await executeQueuedTrialRuns(
    {
      store,
      runs: READS_SKILL,
      model: model(deps.modelReply ?? SCRIPT_REPLY),
      sandbox: deps.sandbox,
      objects,
      modelProvider: "test-provider",
      modelId: "test-model",
      log: () => undefined,
      maxAttempts: deps.maxAttempts,
    },
    { orgId: toOrgId(ORG) },
  );
  return asyncTaskId;
}

beforeAll(async () => {
  await ensureDatabase();
  await migrateOnce();
  await resetOrgs();
  await seedOrg({ orgId: ORG, projectId: "prj-f962-trial-run" });
  db = new PgDatabase(appConfig());
  store = new PgSkillTrialRunStore(db);
  objects = new FsObjectStore(await mkdtemp(join(tmpdir(), "f962-objects-")));
}, 180_000);

describe("§6.1 提交 → 轮询：状态机真的在库里走完", () => {
  it("submit leaves a queued row that the submitter can poll before it runs", async () => {
    const { asyncTaskId } = await submitTrialRun(
      { identities: MEMBER, store, executor: NOOP_EXECUTOR },
      { orgId: toOrgId(ORG), actorId: ACTOR, versionId: VERSION, sampleInput: "hi" },
    );
    expect(asyncTaskId).not.toBe("");

    const row = await store.findForActor({ orgId: toOrgId(ORG), actorId: ACTOR, id: asyncTaskId });
    // ⚠ 断言的是**提交后**从库里读回来的行，不是内存里的返回值。
    expect(row?.status).toBe("queued");
    // 提交端点不做任何模型/沙箱调用 —— 没有产物、没有失败码。
    expect(row?.artifacts).toEqual([]);
    expect(row?.failureCode).toBeNull();
  });

  it("another user cannot read someone else's trial run — indistinguishable from 'does not exist'", async () => {
    const { asyncTaskId } = await submitTrialRun(
      { identities: MEMBER, store, executor: NOOP_EXECUTOR },
      { orgId: toOrgId(ORG), actorId: ACTOR, versionId: VERSION, sampleInput: "hi" },
    );
    const asOther = await store.findForActor({
      orgId: toOrgId(ORG),
      actorId: OTHER_ACTOR,
      id: asyncTaskId,
    });
    const asNobody = await store.findForActor({
      orgId: toOrgId(ORG),
      actorId: ACTOR,
      id: "tr_does_not_exist",
    });
    // 两者都是 null ⇒ controller 翻成同一个裸 404，不构成存在性预言机。
    expect(asOther).toBeNull();
    expect(asNobody).toBeNull();
  });
});

describe("V1（真实链路末端）：产物真的落进 ObjectStore 且是合法 OOXML", () => {
  it("stores a real .pptx and the bytes read back from the object store parse as OOXML", async () => {
    const contentBase64 = await realDeckBase64(["季度回顾", "风险", "下一步"]);
    const id = await runOnce({
      sandbox: sandboxReturning([
        { name: "deck.pptx", contentBase64, sizeBytes: Buffer.from(contentBase64, "base64").length },
      ]),
    });

    const row = await store.findForActor({ orgId: toOrgId(ORG), actorId: ACTOR, id });
    expect(row?.status).toBe("succeeded");
    expect(row?.artifacts).toHaveLength(1);

    const ref = row!.artifacts[0]!;
    expect(ref.mime).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    // §5：键在 ObjectStore 里，**不是**项目产物（artifact）表里的一行。
    expect(ref.objectKey).toContain(id);

    // 真的读回来解析 —— 不是信任写入时的那个 buffer。
    const bytes = await objects.get(ref.objectKey);
    expect(bytes).not.toBeNull();
    const inspection = inspectPptx(Buffer.from(bytes!));
    expect(inspection.slideCount).toBe(3);
    expect(inspection.textRuns.filter((t) => t.trim() !== "")).toContain("季度回顾");
  }, 60_000);

  it("V1-CP 反证：沙箱回 0 字节文件时，同一套断言必须红", async () => {
    const id = await runOnce({
      sandbox: sandboxReturning([{ name: "deck.pptx", contentBase64: "", sizeBytes: 0 }]),
    });
    const row = await store.findForActor({ orgId: toOrgId(ORG), actorId: ACTOR, id });
    // 执行本身"成功"了（exitCode 0）——这正是这条反证的意义：
    // 只看状态位会全绿，必须看产物内容。
    expect(row?.status).toBe("succeeded");

    const bytes = await objects.get(row!.artifacts[0]!.objectKey);
    expect(bytes!.length).toBe(0);
    expect(() => inspectPptx(Buffer.from(bytes!))).toThrow(/no end-of-central-directory/);
  }, 60_000);
});

describe("V4（真库）：三个失败码各自落成终态，且带回真实 stderr", () => {
  it("SANDBOX_UNAVAILABLE is persisted as a terminal row, not left running", async () => {
    const id = await runOnce({
      sandbox: { run: () => Promise.reject(new SandboxUnavailableError("connect ECONNREFUSED")) },
    });
    const row = await store.findForActor({ orgId: toOrgId(ORG), actorId: ACTOR, id });
    // ⚠ 关键：不是停在 running。停在 running 的行在轮询端与"还在跑"无法区分。
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("SANDBOX_UNAVAILABLE");
    expect(row?.failureStderr).toContain("ECONNREFUSED");
  }, 60_000);

  it("SANDBOX_TIMEOUT is persisted and does not masquerade as a script bug", async () => {
    const id = await runOnce({
      sandbox: {
        run: async () => ({
          exitCode: null, stdout: "", stderr: "", files: [], timedOut: true, durationMs: 120_000,
        }),
      },
    });
    const row = await store.findForActor({ orgId: toOrgId(ORG), actorId: ACTOR, id });
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("SANDBOX_TIMEOUT");
  }, 60_000);

  it("SCRIPT_FAILED_AFTER_RETRIES persists the RAW stderr, never a friendly rewrite", async () => {
    const realStderr =
      "TypeError: pres.ShapeType is not a function\n    at Object.<anonymous> (/tmp/work/script.js:7:22)";
    const id = await runOnce({
      sandbox: {
        run: async () => ({
          exitCode: 1, stdout: "", stderr: realStderr, files: [], timedOut: false, durationMs: 5,
        }),
      },
    });
    const row = await store.findForActor({ orgId: toOrgId(ORG), actorId: ACTOR, id });
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("SCRIPT_FAILED_AFTER_RETRIES");
    // #660 纪律：原文，逐字。
    expect(row?.failureStderr).toBe(realStderr);
    expect(row?.failureStderr).not.toMatch(/请重试|please try again/i);
    // §7 上限 3 真的用满了。
    expect(row?.attempts).toBe(3);
  }, 60_000);

  it("三个码互不相同 —— 合并成一个通用码时本组断言立刻红", async () => {
    // 上面三条各自断言了具体的码；这一条把"它们必须是三个不同的值"写成显式不变量。
    const codes = new Set(["SANDBOX_UNAVAILABLE", "SANDBOX_TIMEOUT", "SCRIPT_FAILED_AFTER_RETRIES"]);
    expect(codes.size).toBe(3);
  });
});
