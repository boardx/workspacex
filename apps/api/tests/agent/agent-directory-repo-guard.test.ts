/**
 * AG04 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent/pg-agent-directory-repository.ts` 的**守卫测试**。
 *
 * 同 `set-agent-role-label-repo-guard.test.ts` 一样的理由与形状：那条白名单条目声称
 * 「授权已在 `list-agent-directory.ts` 里、且在仓储调用之前发生，读面只限
 * `agents`/`agent_versions`/`capability_listings` 三张表，且永远只选 `scope='org-wide'`
 * 的行」——本文件把那句声明变成机械事实。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AGENT_DIRECTORY_REPOSITORY,
  AgentDirectoryError,
  getAgentDirectoryCard,
  listAgentDirectory,
  type AgentDirectoryRepository,
} from "../../src/application/agent/list-agent-directory";
import type { IdentityRepository } from "../../src/application/identity/ports";
import type { WorkflowDefinitionStore } from "../../src/application/agent-import/ports";
import { toOrgId } from "../../src/domain/org-id";

const REPO = new URL("../../src/infrastructure/agent/pg-agent-directory-repository.ts", import.meta.url);
const USE_CASE = new URL("../../src/application/agent/list-agent-directory.ts", import.meta.url);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/** 本仓储只允许命名的三张租户表——多一张就说明长出了新的读面。 */
const ALLOWED_TABLES = new Set(["agents", "agent_versions", "capability_listings"]);

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("AG04 白名单条目的前提：仓储侧", () => {
  it("只命名允许的三张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agents")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });

  /** AR13 同款 fail-closed：查询本身把「仅某组」的行挡在外面，不是「先列出来再判权限」。 */
  it("SQL 永远带 scope='org-wide' 谓词", () => {
    expect(repoSource).toContain("cl.scope = 'org-wide'");
  });
});

describe("AG04 白名单条目的前提：授权确实存在，且在仓储调用之前", () => {
  it("用例层两个入口都有组织成员判定", () => {
    const occurrences = useCaseSource.match(/findOrgMembership/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(useCaseSource).toContain('"UNAUTHENTICATED"');
  });

  it("授权判定排在仓储调用之前（两个函数体内）", () => {
    for (const fnName of ["listAgentDirectory", "getAgentDirectoryCard"]) {
      const fnStart = useCaseSource.indexOf(`export async function ${fnName}(`);
      expect(fnStart).toBeGreaterThan(-1);
      const nextFnStart = useCaseSource.indexOf("export async function", fnStart + 1);
      const body = useCaseSource.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);
      const authAt = body.indexOf("findOrgMembership");
      const readAt = body.indexOf("deps.repository.");
      expect(authAt).toBeGreaterThan(-1);
      expect(readAt).toBeGreaterThan(-1);
      expect(authAt).toBeLessThan(readAt);
    }
  });

  it("行为证明：membership 为 null 时用例从不调用仓储", async () => {
    let repoCalled = false;
    const identities: IdentityRepository = {
      findOrgMembership: async () => null,
    } as unknown as IdentityRepository;
    const repository: AgentDirectoryRepository = {
      listVisible: async () => { repoCalled = true; return []; },
      findVisible: async () => { repoCalled = true; return null; },
    };
    const workflows: WorkflowDefinitionStore = { isRegistered: async () => true, resolveName: async () => null };
    const orgId = toOrgId("org-guard-test");

    await expect(
      listAgentDirectory({ orgId, actorId: "u1", roleCategory: null, q: null }, { identities, repository, workflows }),
    ).rejects.toBeInstanceOf(AgentDirectoryError);
    expect(repoCalled).toBe(false);

    await expect(
      getAgentDirectoryCard({ orgId, actorId: "u1", agentId: "agent-1" }, { identities, repository, workflows }),
    ).rejects.toBeInstanceOf(AgentDirectoryError);
    expect(repoCalled).toBe(false);
  });

  it("不存在/不可见的行 → AGENT_NOT_FOUND，不是别的形状", async () => {
    const identities: IdentityRepository = {
      findOrgMembership: async () => ({ orgRole: "member" }),
    } as unknown as IdentityRepository;
    const repository: AgentDirectoryRepository = {
      listVisible: async () => [],
      findVisible: async () => null,
    };
    const workflows: WorkflowDefinitionStore = { isRegistered: async () => true, resolveName: async () => null };
    const orgId = toOrgId("org-guard-test");
    try {
      await getAgentDirectoryCard({ orgId, actorId: "u1", agentId: "missing" }, { identities, repository, workflows });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentDirectoryError);
      expect((error as AgentDirectoryError).code).toBe("AGENT_NOT_FOUND");
    }
  });
});

describe("AG04 白名单条目的自我健全性", () => {
  it("DI token 存在，供 kernel.module.ts 绑定", () => {
    expect(typeof AGENT_DIRECTORY_REPOSITORY).toBe("symbol");
  });
});
