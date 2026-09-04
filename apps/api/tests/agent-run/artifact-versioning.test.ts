/**
 * Phase 14 F09（`artifacts-steering` 契约束 UC-3 `continueArtifact`，R3 步骤 1/5，
 * domain I-1/I-2/I-3）—— 连续两次"继续修改"后版本历史正确递增、每个版本可独立追溯到
 * 产生它的 run/step，且失败的继续尝试不计入版本历史。
 *
 * 真实 Postgres，不是内存 fake：核心断言之一是 `agent_artifact_versions` 的
 * `produced_by_run_id`/`produced_by_step_id` 外键与追加时的版本号计算（见
 * `pg-artifact-store.ts` 的 `FOR UPDATE` 序列化），这是 SQL 行为，纯内存 store 测不出来
 * （同 `agent-run-context-snapshot.test.ts` 头注的既有理由）。`ArtifactRunLauncher` 用
 * 确定性 fake——"新 run 怎么发起"不在 F09 范围内（`ports.ts` 头注），fake 只负责在被调用时
 * 造好这次"新 run"的 `agent_runs`/`agent_run_steps` 夹具行，让 producedByRunId/StepId
 * 有真实的外键目标。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { seedAgentRun, seedToolCallStep } from "../support/agent-run-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgArtifactStore } from "../../src/infrastructure/artifacts-steering/pg-artifact-store";
import { continueArtifact, type ContinueArtifactDeps } from "../../src/application/artifacts-steering/continue-artifact";
import { createArtifactFromToolOutput, recordArtifactContinuationOutcome } from "../../src/application/artifacts-steering/record-artifact";
import { getArtifact } from "../../src/application/artifacts-steering/read-artifact";
import type { ArtifactRunLauncher } from "../../src/application/artifacts-steering/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = toOrgId("org-f09-artifact-versioning");
const PROJECT = "proj-f09-artifact-versioning";
const THREAD = "thread-f09-artifact-versioning";
const ACTOR = "u-f09-artifact-versioning";

let db: PgDatabase;
let artifacts: PgArtifactStore;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  artifacts = new PgArtifactStore(db);
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
});

/** 造一次"新 run"的最小夹具，模拟真实 launcher 会做的事：起一个 run + 一个 tool_call step。 */
async function seedRunAndStep(runId: string, seq: number): Promise<{ runId: string; runStepId: string }> {
  await seedAgentRun({ orgId: ORG, id: runId, threadId: THREAD, authorId: ACTOR });
  const runStepId = await seedToolCallStep({ orgId: ORG, runId, seq, toolName: "pdf-export" });
  return { runId, runStepId };
}

function deps(launcher: ArtifactRunLauncher): ContinueArtifactDeps {
  return {
    artifacts,
    launcher,
    chat: new PgChatRepository(db),
    repo: new PgIdentityRepository(db),
    ids: new UuidDecisionIdFactory(),
  };
}

describe("Phase 14 F09 -- Artifact 版本化：连续两次 continue 后版本历史正确递增", () => {
  it("R3 步骤1/5, I-1: 每个版本都能追溯到产生它的 run/step，版本号按序递增", async () => {
    const v1 = await seedRunAndStep(`${THREAD}-run-v1`, 1);
    const artifact = await createArtifactFromToolOutput(
      { artifacts, clock: { now: () => new Date().toISOString(), newArtifactId: () => "artifact-f09-vt" } },
      {
        orgId: ORG, threadId: THREAD, name: "报告.pdf", kind: "pdf",
        producedByRunId: v1.runId, producedByStepId: v1.runStepId,
        changeNote: "初始生成", storageKey: "s3://artifacts/v1.pdf", sizeBytes: 1024,
      },
    );
    expect(artifact.versions).toHaveLength(1);
    expect(artifact.versions[0]).toMatchObject({
      version: 1, producedByRunId: v1.runId, producedByStepId: v1.runStepId,
    });

    // 第一次 continue：basedOnVersion=1（当前唯一版本）。
    const v2 = await seedRunAndStep(`${THREAD}-run-v2`, 1);
    const launcher1: ArtifactRunLauncher = { launch: async () => ({ runId: v2.runId }) };
    const out1 = await continueArtifact(deps(launcher1), {
      userId: ACTOR, orgId: ORG, artifactId: artifact.artifactId,
      basedOnVersion: 1, instruction: "把第二页标题改成 X",
    });
    expect(out1.runId).toBe(v2.runId);
    const appended2 = await recordArtifactContinuationOutcome(
      { artifacts },
      {
        orgId: ORG, artifactId: artifact.artifactId, runId: v2.runId, runStepId: v2.runStepId,
        changeNote: "把第二页标题改成 X", status: "succeeded",
        output: { storageKey: "s3://artifacts/v2.pdf", sizeBytes: 1100 },
      },
    );
    expect(appended2).toMatchObject({ version: 2, producedByRunId: v2.runId, producedByStepId: v2.runStepId });

    // 第二次 continue：basedOnVersion=2（此刻的最新版本）。
    const v3 = await seedRunAndStep(`${THREAD}-run-v3`, 1);
    const launcher2: ArtifactRunLauncher = { launch: async () => ({ runId: v3.runId }) };
    const out2 = await continueArtifact(deps(launcher2), {
      userId: ACTOR, orgId: ORG, artifactId: artifact.artifactId,
      basedOnVersion: 2, instruction: "再把页脚加上日期",
    });
    expect(out2.runId).toBe(v3.runId);
    const appended3 = await recordArtifactContinuationOutcome(
      { artifacts },
      {
        orgId: ORG, artifactId: artifact.artifactId, runId: v3.runId, runStepId: v3.runStepId,
        changeNote: "再把页脚加上日期", status: "succeeded",
        output: { storageKey: "s3://artifacts/v3.pdf", sizeBytes: 1150 },
      },
    );
    expect(appended3).toMatchObject({ version: 3, producedByRunId: v3.runId, producedByStepId: v3.runStepId });

    const final = await getArtifact(
      { artifacts, chat: new PgChatRepository(db), repo: new PgIdentityRepository(db), ids: new UuidDecisionIdFactory() },
      { userId: ACTOR, orgId: ORG, artifactId: artifact.artifactId },
    );
    expect(final.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(final.versions.map((v) => v.producedByRunId)).toEqual([v1.runId, v2.runId, v3.runId]);
    expect(final.versions.map((v) => v.producedByStepId)).toEqual([v1.runStepId, v2.runStepId, v3.runStepId]);
  });

  it("R4 E4 / I-3: continue 触发的 run 失败时不创建版本，失败的尝试不计入版本历史", async () => {
    const v1 = await seedRunAndStep(`${THREAD}-run-fail-v1`, 1);
    const artifact = await createArtifactFromToolOutput(
      { artifacts, clock: { now: () => new Date().toISOString(), newArtifactId: () => "artifact-f09-fail" } },
      {
        orgId: ORG, threadId: THREAD, name: "报告.pdf", kind: "pdf",
        producedByRunId: v1.runId, producedByStepId: v1.runStepId,
        changeNote: "初始生成", storageKey: "s3://artifacts/fail-v1.pdf", sizeBytes: 900,
      },
    );

    const failedRun = await seedRunAndStep(`${THREAD}-run-fail-v2`, 1);
    const launcher: ArtifactRunLauncher = { launch: async () => ({ runId: failedRun.runId }) };
    const { runId } = await continueArtifact(deps(launcher), {
      userId: ACTOR, orgId: ORG, artifactId: artifact.artifactId,
      basedOnVersion: 1, instruction: "改一下配色",
    });

    const appended = await recordArtifactContinuationOutcome(
      { artifacts },
      {
        orgId: ORG, artifactId: artifact.artifactId, runId, runStepId: failedRun.runStepId,
        changeNote: "改一下配色", status: "failed",
      },
    );
    expect(appended).toBeNull();

    const after = await getArtifact(
      { artifacts, chat: new PgChatRepository(db), repo: new PgIdentityRepository(db), ids: new UuidDecisionIdFactory() },
      { userId: ACTOR, orgId: ORG, artifactId: artifact.artifactId },
    );
    // 唯一还在的版本仍是初始的 v1——失败尝试完全没有留下痕迹（不是"留下一个空/损坏版本"）。
    expect(after.versions).toHaveLength(1);
    expect(after.versions[0]?.version).toBe(1);
  });
});
