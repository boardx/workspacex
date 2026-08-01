/**
 * F98 — `[AI 建议人选]`：候选态 + 理由与来源 + 三出口，且**不自动写入联系方式**
 * (uc-6-7 R3-3 / AC3 / V12).
 *
 * 纯应用层 + 内存仓储测试，不连接数据库——理由与同目录
 * `contact-mask-audit-export-exclude.test.ts` 文件头相同（issue #74 的标准指令）。
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_CONTACT_CIPHER } from "../support/interview-db";
import { FakeSubjectRepository } from "../support/fake-subject-repository";
import { toOrgId } from "../../src/domain/org-id";
import { suggestCandidates } from "../../src/application/interview/suggest-candidates";
import { acceptCandidate, CandidateNotFoundError } from "../../src/application/interview/accept-candidate";
import { createSubject } from "../../src/application/interview/create-subject";
import { AiGenerationUnavailableError } from "../../src/application/interview/errors";
import {
  HistoryBasedCandidateSuggester,
  InMemoryCandidateStore,
} from "../../src/infrastructure/interview/in-memory-candidate-store";
import type { CandidateSuggestionPort } from "../../src/application/interview/candidate-ports";

const ORG = toOrgId("org-f98-candidate");
const GROUP_A = "grp-f98-cand-a";
const GROUP_B = "grp-f98-cand-b";
const FACILITATOR = "u-f98-cand-facilitator";

function makeRepo() {
  return new FakeSubjectRepository(FIXTURE_CONTACT_CIPHER);
}

describe("HistoryBasedCandidateSuggester — 基于组织历史对象的启发式建议 (R3-3)", () => {
  it("同机构的既有对象被建议，携带机器产出的理由与来源", async () => {
    const repo = makeRepo();
    // 组 A 已有一个「某物流园区」的对象。
    await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP_A, contact: "13800001111", sourceKind: "human", createdBy: FACILITATOR,
    });
    // 组 B 也有一个同机构、但不同人的历史对象——这是建议的种子。
    await repo.create({
      orgId: ORG, displayName: "李雷", roleTitle: "运营总监", orgName: "某物流园区",
      groupId: GROUP_B, contact: "13900002222", sourceKind: "human", createdBy: FACILITATOR,
    });

    const suggester = new HistoryBasedCandidateSuggester(repo);
    const suggestions = await suggester.suggest(ORG, GROUP_A);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.name).toBe("李雷");
    expect(suggestions[0]!.reason).toContain("某物流园区");
    expect(suggestions[0]!.sources.length).toBeGreaterThan(0);
    // 结构上就没有联系方式字段——不是运行时判断要不要带。
    expect(Object.keys(suggestions[0]!)).not.toContain("contact");
  });

  it("组内已有的对象不会被建议给自己（不产生「建议我已经加过的人」这种噪音）", async () => {
    const repo = makeRepo();
    await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP_A, contact: null, sourceKind: "human", createdBy: FACILITATOR,
    });
    const suggester = new HistoryBasedCandidateSuggester(repo);
    const suggestions = await suggester.suggest(ORG, GROUP_A);
    expect(suggestions).toEqual([]);
  });

  it("本组没有任何机构线索时不建议任何人，而不是报错", async () => {
    const repo = makeRepo();
    const suggester = new HistoryBasedCandidateSuggester(repo);
    await expect(suggester.suggest(ORG, GROUP_A)).resolves.toEqual([]);
  });
});

describe("suggestCandidates — 落候选态，机器产出标识 + 理由 + 来源 (AC3)", () => {
  it("每条建议都标 origin: 'ai'，落入候选存储，不直接出现在对象表里", async () => {
    const repo = makeRepo();
    await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP_A, contact: null, sourceKind: "human", createdBy: FACILITATOR,
    });
    await repo.create({
      orgId: ORG, displayName: "李雷", roleTitle: "运营总监", orgName: "某物流园区",
      groupId: GROUP_B, contact: null, sourceKind: "human", createdBy: FACILITATOR,
    });

    const store = new InMemoryCandidateStore();
    const suggestions = new HistoryBasedCandidateSuggester(repo);

    const result = await suggestCandidates(
      { suggestions, store },
      { orgId: ORG, actorId: FACILITATOR, input: { groupId: GROUP_A } },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.origin).toBe("ai");
    expect(result.candidates[0]!.reason.length).toBeGreaterThan(0);
    expect(result.candidates[0]!.sources.length).toBeGreaterThan(0);

    // 候选真的落了状态——能从 store 里取回来，且尚未变成对象表里的一行。
    const stored = await store.get(ORG, result.candidates[0]!.candidateId);
    expect(stored).not.toBeNull();
    expect(await repo.listByGroup(ORG, GROUP_A)).toHaveLength(1); // 还是只有王芳，李雷没有被直接插入。
  });

  it("AI 服务不可用只落在这一个端口——手工加对象（createSubject）完全不受影响 (V12)", async () => {
    const repo = makeRepo();
    const store = new InMemoryCandidateStore();
    const brokenSuggestions: CandidateSuggestionPort = {
      suggest: async () => {
        throw new Error("upstream boom");
      },
    };

    await expect(
      suggestCandidates(
        { suggestions: brokenSuggestions, store },
        { orgId: ORG, actorId: FACILITATOR, input: { groupId: GROUP_A } },
      ),
    ).rejects.toThrow(AiGenerationUnavailableError);

    // 同一时刻，手工加对象这条路径完全没有受到影响。
    const manuallyAdded = await createSubject(
      { repo },
      {
        orgId: ORG, actorId: FACILITATOR,
        input: {
          displayName: "手工加的对象", roleTitle: "顾问", orgName: null,
          groupId: GROUP_A, contact: null, sourceKind: "human",
        },
      },
    );
    expect(manuallyAdded.displayName).toBe("手工加的对象");
  });
});

describe("acceptCandidate — 三出口中的两个，恒不自动写入联系方式 (AC3)", () => {
  async function suggestOneCandidate(repo: FakeSubjectRepository, store: InMemoryCandidateStore) {
    await repo.create({
      orgId: ORG, displayName: "王芳", roleTitle: "采购总监", orgName: "某物流园区",
      groupId: GROUP_A, contact: null, sourceKind: "human", createdBy: FACILITATOR,
    });
    await repo.create({
      orgId: ORG, displayName: "李雷", roleTitle: "运营总监", orgName: "某物流园区",
      groupId: GROUP_B, contact: null, sourceKind: "human", createdBy: FACILITATOR,
    });
    const suggestions = new HistoryBasedCandidateSuggester(repo);
    const result = await suggestCandidates(
      { suggestions, store },
      { orgId: ORG, actorId: FACILITATOR, input: { groupId: GROUP_A } },
    );
    return result.candidates[0]!.candidateId;
  }

  it("「加入表」（edits: null）：候选原样写入对象表，contactMask 为空——从未有联系方式被填入", async () => {
    const repo = makeRepo();
    const store = new InMemoryCandidateStore();
    const candidateId = await suggestOneCandidate(repo, store);

    const created = await acceptCandidate(
      { store, repo },
      { orgId: ORG, actorId: FACILITATOR, input: { candidateId, edits: null } },
    );

    expect(created.displayName).toBe("李雷");
    expect(created.contactMask).toBe("");
    const rows = await repo.listByGroup(ORG, GROUP_A);
    expect(rows).toHaveLength(2); // 王芳 + 刚确认的李雷。
  });

  it("「编辑后加入」（edits 非空）：改写展示名，联系方式依旧恒为 null", async () => {
    const repo = makeRepo();
    const store = new InMemoryCandidateStore();
    const candidateId = await suggestOneCandidate(repo, store);

    const created = await acceptCandidate(
      { store, repo },
      { orgId: ORG, actorId: FACILITATOR, input: { candidateId, edits: "李雷（已核实）" } },
    );

    expect(created.displayName).toBe("李雷（已核实）");
    expect(created.contactMask).toBe("");
  });

  it("同一张候选卡不能被接受第二次——候选态在接受后终结", async () => {
    const repo = makeRepo();
    const store = new InMemoryCandidateStore();
    const candidateId = await suggestOneCandidate(repo, store);

    await acceptCandidate({ store, repo }, { orgId: ORG, actorId: FACILITATOR, input: { candidateId, edits: null } });

    await expect(
      acceptCandidate({ store, repo }, { orgId: ORG, actorId: FACILITATOR, input: { candidateId, edits: null } }),
    ).rejects.toThrow(CandidateNotFoundError);
  });

  it("「忽略」不需要服务端调用——不调 acceptCandidate 时，候选永远不会进对象表", async () => {
    const repo = makeRepo();
    const store = new InMemoryCandidateStore();
    await suggestOneCandidate(repo, store);
    // 客户端选择忽略：什么都不做。断言的是"什么都不做"确实什么都不改变。
    expect(await repo.listByGroup(ORG, GROUP_A)).toHaveLength(1); // 只有王芳，李雷没有被自动加入。
  });
});
