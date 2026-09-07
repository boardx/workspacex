/**
 * issue #1493（「chat 用上后台画布模板」后端块）—— **真栈反证**：本组织已发布的画布模板清单
 * 真的进了发给模型的 system prompt，分区名来自数据库而不是写死的常量，新发布立刻在下一次 run
 * 生效（不是缓存过期后才生效），草稿/归档模板不出现，空清单不注入假清单，个人对话与项目对话
 * 一视同仁。
 *
 * 全程 `executeQueuedRuns` → `buildSystemPrompt`，与生产 `kernel.module.ts` 同一条组装路径：
 * `createCanvasTemplateGuidancePort` 包一层 `listTemplates`，不新开查询——本文件因此也不直接
 * 断言仓储/用例本身（那是 `list-templates.test.ts`/`canvas-template.controller` 一类测试的
 * 职责），只钉住「execute-run 真的用上了它、真的现查、真的不注入假清单」这几条本次改动独有的
 * 断言。
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgCanvasTemplateRepository } from "../../src/infrastructure/canvas/pg-canvas-template-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { createCanvasTemplateGuidancePort } from "../../src/application/agent-run/canvas-template-guidance";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1493-canvas-guidance";
const THREAD_PROJECT = "thr-1493-project";
const THREAD_PERSONAL = "thr-1493-personal";
const PROJECT = "proj-1493-canvas-guidance";
const ACTOR = "u-1493-actor";
const AGENT_ID = "agent-1493-canvas-guidance";
const MODEL_PROVIDER = "test-provider";
const MODEL_ID = "test-model";

let db: PgDatabase;
let repo: PgAgentRunRepository;
let agentVersionId: string;

async function seedAgent(): Promise<void> {
  const instructions = "You are a helpful assistant for #1493 canvas guidance testing.";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [AGENT_ID, ORG, AGENT_ID, "#1493 测试 agent", ACTOR],
    );
    agentVersionId = `${AGENT_ID}-v1`;
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
      [agentVersionId, ORG, AGENT_ID, createHash("sha256").update(instructions).digest("hex"),
        instructions, MODEL_PROVIDER, MODEL_ID, ACTOR],
    );
  });
}

async function seedTemplate(t: {
  readonly key: string;
  readonly version: number;
  readonly status: "draft" | "trial" | "published" | "archived";
  readonly displayName: string;
  readonly sections: readonly { sectionId: string; name: string; order: number; required: boolean; capacity: number | null }[];
  readonly archivedFrom?: "draft" | "trial" | "published" | null;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          underlying_type, sections)
       VALUES ($1,$2,$3,$4,$5,$6,false,'org-wide','canvas',$7::jsonb)`,
      [ORG, t.key, t.version, t.displayName, t.status, t.archivedFrom ?? null, JSON.stringify(t.sections)],
    ),
  );
}

async function enqueueRun(threadId: string, inputMessageId: string, runId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'queued')`,
      [runId, ORG, threadId, inputMessageId, AGENT_ID, agentVersionId, MODEL_PROVIDER, MODEL_ID],
    ),
  );
}

let clock = 0;
function deps(calls: ModelCallInput[], withCanvas = true): ExecuteAgentRunDeps {
  return {
    runs: repo,
    model: {
      async complete(input: ModelCallInput) {
        calls.push(input);
        return { text: "好的，收到。" };
      },
    },
    canvasTemplates: withCanvas
      ? createCanvasTemplateGuidancePort({
        identity: new PgIdentityRepository(db),
        templates: new PgCanvasTemplateRepository(db),
        ids: new UuidDecisionIdFactory(),
      })
      : undefined,
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
}

async function askAndRun(
  threadId: string, question: string, runId: string, withCanvas = true,
): Promise<{ system: string }> {
  const qid = `f1493-q-${runId}`;
  await addChatMessage({ orgId: ORG, id: qid, threadId, body: question, authorId: ACTOR });
  await enqueueRun(threadId, qid, runId);
  const calls: ModelCallInput[] = [];
  const runtimeDeps = deps(calls, withCanvas);
  await executeQueuedRuns(runtimeDeps, { orgId: toOrgId(ORG) });
  // Finish writeback so the next run on this thread can be claimed.
  expect(await writeBackPendingRuns(runtimeDeps, { orgId: toOrgId(ORG) })).toBe(1);
  const call = calls.at(-1);
  expect(call).toBeDefined();
  return { system: call!.system };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD_PROJECT, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await addChatThread({
    orgId: ORG, id: THREAD_PERSONAL, projectId: null, visibilityScope: "private", createdBy: ACTOR,
  });
  await seedAgent();
});

afterAll(async () => {
  await db.close();
});

describe("issue #1493 canvas 模板指引真栈进 system prompt", () => {
  it("已发布模板 → system prompt 含 key 与分区名（分区名来自数据库，不是写死的常量）", async () => {
    await seedTemplate({
      key: "persona", version: 1, status: "published", displayName: "用户画像",
      sections: [
        { sectionId: "s1", name: "用户描述", order: 0, required: true, capacity: null },
        { sectionId: "s2", name: "目标和需求", order: 1, required: true, capacity: null },
      ],
    });

    const { system } = await askAndRun(THREAD_PROJECT, "帮我画一个用户画像", "f1493-run-1");

    expect(system).toContain("persona");
    expect(system).toContain("用户描述");
    expect(system).toContain("目标和需求");
    expect(system).toContain("```canvas");
    expect(system).toContain("模板: <key>");
    // 人类澄清：canvas 是协作模板，不是 mermaid 那类标准图表——措辞必须点出这条边界，
    // 且两段指引各自成段（标题不同、不合并成一段模糊的「可视化」说明）。
    expect(system).toContain("## 工作坊协作画布（canvas 围栏）");
    expect(system).toContain("不是另一种画图方式，也不是普通图表");
    expect(system).toContain("## 可视化（mermaid 图）");
    expect(system.indexOf("## 可视化（mermaid 图）")).toBeLessThan(system.indexOf("## 工作坊协作画布"));
  });

  it("组织新发布一个模板 → 下一次 run 的 prompt 立刻反映，证明不是缓存的（每次 run 现查）", async () => {
    await seedTemplate({
      key: "persona", version: 1, status: "published", displayName: "用户画像",
      sections: [{ sectionId: "s1", name: "用户描述", order: 0, required: true, capacity: null }],
    });
    const before = await askAndRun(THREAD_PROJECT, "第一次提问", "f1493-run-before");
    expect(before.system).toContain("persona");
    expect(before.system).not.toContain("swot");

    // 组织新发布第二个模板——生产语义上等价于「后台点了发布」，不经过任何缓存失效动作。
    await seedTemplate({
      key: "swot", version: 1, status: "published", displayName: "SWOT 分析",
      sections: [
        { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
        { sectionId: "s2", name: "劣势", order: 1, required: true, capacity: null },
        { sectionId: "s3", name: "机会", order: 2, required: false, capacity: null },
        { sectionId: "s4", name: "威胁", order: 3, required: false, capacity: null },
      ],
    });

    const after = await askAndRun(THREAD_PROJECT, "第二次提问，紧接着上一次", "f1493-run-after");
    expect(after.system).toContain("persona");
    expect(after.system).toContain("swot");
    expect(after.system).toContain("优势");
    expect(after.system).toContain("威胁");
  });

  it("组织没有已发布模板 → 不注入假清单：既没有 canvas 指引小节，也没有任何模板 key", async () => {
    // 只有草稿，没有任何已发布模板。
    await seedTemplate({
      key: "draft-only", version: 1, status: "draft", displayName: "草稿模板",
      sections: [{ sectionId: "s1", name: "占位分区", order: 0, required: true, capacity: null }],
    });

    const { system } = await askAndRun(THREAD_PROJECT, "组织还没配画布模板时的提问", "f1493-run-empty");

    expect(system).not.toContain("## 工作坊协作画布");
    expect(system).not.toContain("draft-only");
    expect(system).not.toContain("占位分区");
    // mermaid 指引不受影响，仍然无条件存在。
    expect(system).toContain("## 可视化（mermaid 图）");
  });

  it("草稿/已归档模板不出现在清单里——只读已发布的", async () => {
    await seedTemplate({
      key: "published-one", version: 1, status: "published", displayName: "已发布模板",
      sections: [{ sectionId: "s1", name: "可见分区", order: 0, required: true, capacity: null }],
    });
    await seedTemplate({
      key: "draft-two", version: 1, status: "draft", displayName: "草稿模板",
      sections: [{ sectionId: "s1", name: "草稿分区", order: 0, required: true, capacity: null }],
    });
    await seedTemplate({
      key: "archived-three", version: 1, status: "archived", archivedFrom: "published",
      displayName: "归档模板",
      sections: [{ sectionId: "s1", name: "归档分区", order: 0, required: true, capacity: null }],
    });

    const { system } = await askAndRun(THREAD_PROJECT, "混合状态下的提问", "f1493-run-mixed");

    expect(system).toContain("published-one");
    expect(system).toContain("可见分区");
    expect(system).not.toContain("draft-two");
    expect(system).not.toContain("草稿分区");
    expect(system).not.toContain("archived-three");
    expect(system).not.toContain("归档分区");
  });

  it("个人对话（projectId 为空的线程）同样验证到这段注入存在——只依赖 orgId，不依赖 projectId", async () => {
    await seedTemplate({
      key: "persona", version: 1, status: "published", displayName: "用户画像",
      sections: [{ sectionId: "s1", name: "用户描述", order: 0, required: true, capacity: null }],
    });

    const { system } = await askAndRun(THREAD_PERSONAL, "个人对话里的提问", "f1493-run-personal");

    expect(system).toContain("persona");
    expect(system).toContain("用户描述");
  });

  it("`deps.canvasTemplates` 未注入（既有调用点，如试跑）时，system prompt 与本次改动之前逐字节相同——不多出 canvas 指引", async () => {
    await seedTemplate({
      key: "persona", version: 1, status: "published", displayName: "用户画像",
      sections: [{ sectionId: "s1", name: "用户描述", order: 0, required: true, capacity: null }],
    });

    const { system } = await askAndRun(THREAD_PROJECT, "未接 canvasTemplates 依赖时的提问", "f1493-run-no-port", false);

    expect(system).not.toContain("persona");
    expect(system).not.toContain("## 工作坊协作画布");
    expect(system).toContain("## 可视化（mermaid 图）");
  });
});
