/**
 * F02 -- D-39/AC4/V7: "owner 恒为人，agent 只能出现在 executor 字段"，且两者分列输出，
 * 不混在一个字段里.
 *
 * Two layers of proof, both real:
 *   ① Pure domain (`renderCard`/`assertHumanOwner`) -- no database.
 *   ② Real Postgres round trip (`createTask` -> `PgTaskRepository` -> the DB's own CHECK
 *      constraint from the F02 migration) -- proves the rejection is not merely an
 *      application-layer opinion the DB itself would have let through.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderCard, OwnerRenderedAsAgentError, type RawTaskRow } from "../../src/domain/board/card-render";
import { assertHumanOwner, isAgentIdentifier, OwnerMustBeHumanError } from "../../src/domain/board/owner-identity";
import { createTask, CreateTaskRejectedError } from "../../src/application/board/create-task";
import { PgTaskRepository } from "../../src/infrastructure/board/pg-task-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { migrateOnce, resetOrgs, seedOrg, asOwner } from "../support/db";

function row(overrides: Partial<RawTaskRow> = {}): RawTaskRow {
  return {
    id: "t-1", title: "task", status: "todo", sourceKind: "手工创建",
    ownerUserId: "u-human", executor: null, dueAt: null, riskLevel: null,
    waitingOn: null, syncStatus: "synced", projectId: null, updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("F02 pure domain: owner/executor split", () => {
  it("isAgentIdentifier recognizes the agent: prefix convention and nothing else", () => {
    expect(isAgentIdentifier("agent:scout")).toBe(true);
    expect(isAgentIdentifier("u-human")).toBe(false);
    expect(isAgentIdentifier(null)).toBe(false);
    expect(isAgentIdentifier(undefined)).toBe(false);
  });

  it("assertHumanOwner throws OwnerMustBeHumanError for an agent id, passes for a human id", () => {
    expect(() => assertHumanOwner("agent:ledger")).toThrow(OwnerMustBeHumanError);
    expect(() => assertHumanOwner("u-human")).not.toThrow();
  });

  it("renderCard splits owner (always ownerUserId, a plain string) and executor (a tagged ref) into two fields", () => {
    const humanExecutor = renderCard(row({ ownerUserId: "u-owner", executor: "u-exec" }));
    expect(humanExecutor.ownerUserId).toBe("u-owner");
    expect(humanExecutor.executor).toEqual({ kind: "human", id: "u-exec" });

    const agentExecutor = renderCard(row({ ownerUserId: "u-owner", executor: "agent:scout" }));
    expect(agentExecutor.ownerUserId).toBe("u-owner");
    expect(agentExecutor.executor).toEqual({ kind: "agent", id: "agent:scout" });
    // The two fields are never merged: owner stays the plain human id regardless of executor.
    expect(agentExecutor.ownerUserId).not.toContain("agent:");
  });

  it("renderCard REFUSES to render a card whose stored owner looks like an agent id -- read-side re-assertion, not write-time-only", () => {
    expect(() => renderCard(row({ ownerUserId: "agent:scout" }))).toThrow(OwnerRenderedAsAgentError);
  });

  it("a null owner (unassigned) and a null executor both render as null, not as empty strings or agent guesses", () => {
    const c = renderCard(row({ ownerUserId: null, executor: null }));
    expect(c.ownerUserId).toBeNull();
    expect(c.executor).toBeNull();
  });
});

const ORG = "f02-owner-split-org";
const PROJECT = "f02-owner-split-project";
const HOOK_TIMEOUT_MS = 120_000;

describe("F02 real Postgres: createTask rejects an agent owner, accepts an agent executor", () => {
  let db: PgDatabase;
  let tasks: PgTaskRepository;

  beforeAll(async () => {
    await migrateOnce();
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    db = new PgDatabase(appConfig());
    tasks = new PgTaskRepository();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await resetOrgs(ORG);
    await db.close();
  });

  it("V7: setting ownerUserId to an agent identity is rejected at the application layer (422-shaped)", async () => {
    await expect(
      createTask(
        { db, tasks },
        { orgId: toOrgId(ORG), projectId: PROJECT, title: "越权指派", ownerUserId: "agent:scout" },
      ),
    ).rejects.toThrow(CreateTaskRejectedError);
  });

  it("V7: the SAME agent id succeeds as executor -- proves the rejection is owner-specific, not id-specific", async () => {
    const created = await createTask(
      { db, tasks },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, title: "Scout 执行的任务",
        ownerUserId: "u-real-human", executor: "agent:scout",
      },
    );
    expect(created.status).toBe("todo");

    const rows = await db.withTenant(toOrgId(ORG), (s) =>
      tasks.listVisibleWithin(s, { orgId: toOrgId(ORG), userId: "u-real-human", projectIds: [PROJECT], role: "org-wide-admin", groupId: null }));
    const stored = rows.find((r) => r.id === created.id)!;
    expect(stored.ownerUserId).toBe("u-real-human");
    expect(stored.executor).toBe("agent:scout");
  });

  it("the DB's own CHECK constraint refuses an agent-prefixed owner_user_id even bypassing the application layer", async () => {
    await expect(
      asOwner((c) =>
        c.query(
          `INSERT INTO tasks (id, org_id, project_id, title, status, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          ["t-direct-insert-agent-owner", ORG, PROJECT, "direct insert", "todo", "agent:sneaky"],
        )),
    ).rejects.toThrow(/tasks_owner_not_agent_literal_check/);
  });
});
