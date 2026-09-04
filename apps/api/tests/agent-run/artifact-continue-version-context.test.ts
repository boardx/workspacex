/**
 * Phase 14 F09（`artifacts-steering` 契约束 UC-3 `continueArtifact`，R4 E2，
 * domain I-4）—— `continueArtifact` 必须使用 `basedOnVersion` 显式指定的那个版本的内容
 * 作为上下文，不能默默使用"当前最新版本"代替；指定版本不存在时拒绝
 * （`ARTIFACT_VERSION_NOT_FOUND`），且不发起任何新 run。
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
import { createArtifactFromToolOutput } from "../../src/application/artifacts-steering/record-artifact";
import { ArtifactNotVisibleError, ArtifactVersionNotFoundError } from "../../src/application/artifacts-steering/errors";
import type { ArtifactRunLauncher } from "../../src/application/artifacts-steering/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = toOrgId("org-f09-continue-version-context");
const PROJECT = "proj-f09-continue-version-context";
const THREAD = "thread-f09-continue-version-context";
const ACTOR = "u-f09-continue-version-context";
const OUTSIDER = "u-f09-continue-version-context-outsider";

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
  await addOrgMember(ORG, OUTSIDER, "consultant", null);
  // OUTSIDER 有组织身份但没有项目成员资格——没有权限访问这个 run/artifact。
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
});

function deps(launcher: ArtifactRunLauncher): ContinueArtifactDeps {
  return {
    artifacts,
    launcher,
    chat: new PgChatRepository(db),
    repo: new PgIdentityRepository(db),
    ids: new UuidDecisionIdFactory(),
  };
}

/** v1 + v2 两个版本、storageKey 互不相同,足以断言"用的是哪一个"。 */
async function seedTwoVersionArtifact(): Promise<{ artifactId: string }> {
  await seedAgentRun({ orgId: ORG, id: `${THREAD}-run-v1`, threadId: THREAD, authorId: ACTOR });
  const stepV1 = await seedToolCallStep({ orgId: ORG, runId: `${THREAD}-run-v1`, seq: 1, toolName: "pdf-export" });
  const artifact = await createArtifactFromToolOutput(
    { artifacts, clock: { now: () => new Date().toISOString(), newArtifactId: () => "artifact-f09-ctx" } },
    {
      orgId: ORG, threadId: THREAD, name: "报告.pdf", kind: "pdf",
      producedByRunId: `${THREAD}-run-v1`, producedByStepId: stepV1,
      changeNote: "初始生成", storageKey: "s3://artifacts/OLD-v1.pdf", sizeBytes: 1000,
    },
  );

  await seedAgentRun({ orgId: ORG, id: `${THREAD}-run-v2`, threadId: THREAD, authorId: ACTOR });
  const stepV2 = await seedToolCallStep({ orgId: ORG, runId: `${THREAD}-run-v2`, seq: 1, toolName: "pdf-export" });
  await artifacts.appendVersion(ORG, {
    artifactId: artifact.artifactId, producedByRunId: `${THREAD}-run-v2`, producedByStepId: stepV2,
    changeNote: "第一次修改", storageKey: "s3://artifacts/NEW-v2.pdf", sizeBytes: 1200,
  });

  return { artifactId: artifact.artifactId };
}

describe("Phase 14 F09 -- continueArtifact 使用的是明确指定版本的内容作上下文", () => {
  it("I-4 / R4 E2: basedOnVersion=1（不是最新的 2）时，launcher 收到的是 v1 的内容", async () => {
    const { artifactId } = await seedTwoVersionArtifact();
    const seenVersions: number[] = [];
    let seenStorageKey: string | null = null;
    const launcher: ArtifactRunLauncher = {
      launch: async (_orgId, input) => {
        seenVersions.push(input.basedOnVersion.version);
        seenStorageKey = input.basedOnVersion.storageKey;
        return { runId: "run-continuation-from-v1" };
      },
    };

    const out = await continueArtifact(deps(launcher), {
      userId: ACTOR, orgId: ORG, artifactId, basedOnVersion: 1, instruction: "把第二页标题改成 X",
    });

    expect(out).toEqual({ runId: "run-continuation-from-v1", artifactId });
    expect(seenVersions).toEqual([1]);
    // 断言的关键：不是"当前最新版本"（v2 / NEW-v2.pdf），是显式指定的 v1。
    expect(seenStorageKey).toBe("s3://artifacts/OLD-v1.pdf");
    expect(seenStorageKey).not.toBe("s3://artifacts/NEW-v2.pdf");
  });

  it("E2: basedOnVersion 指向不存在的版本时拒绝，不静默回退到最新版本，也不发起任何新 run", async () => {
    const { artifactId } = await seedTwoVersionArtifact();
    let launched = false;
    const launcher: ArtifactRunLauncher = {
      launch: async () => { launched = true; return { runId: "should-never-exist" }; },
    };

    await expect(
      continueArtifact(deps(launcher), {
        userId: ACTOR, orgId: ORG, artifactId, basedOnVersion: 99, instruction: "把第二页标题改成 X",
      }),
    ).rejects.toBeInstanceOf(ArtifactVersionNotFoundError);
    expect(launched).toBe(false);
  });

  it("NOT_VISIBLE: 调用者对该 Artifact 所在线程无权限访问时拒绝", async () => {
    const { artifactId } = await seedTwoVersionArtifact();
    const launcher: ArtifactRunLauncher = { launch: async () => ({ runId: "should-never-exist" }) };

    await expect(
      continueArtifact(deps(launcher), {
        userId: OUTSIDER, orgId: ORG, artifactId, basedOnVersion: 1, instruction: "把第二页标题改成 X",
      }),
    ).rejects.toBeInstanceOf(ArtifactNotVisibleError);
  });
});
