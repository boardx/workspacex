/**
 * F115 —— 预设内容从不被当作响应字段回吐（`lint-permission-paths.mjs` 对
 * `pg-chat-preset-repository.ts` 那条豁免的**加载承重测试**，见该脚本 ALLOWLIST
 * 里那一条的最后一句：「这个测试删掉，那条豁免必须一起删掉」）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74）——本文件用**内存假仓储**代替
 * `PgChatPresetRepository`，只验证 application 层四个函数各自的**返回值形状**，
 * 不测仓储的 SQL。
 *
 * ## 这个文件在断言什么
 *
 * `pg-chat-preset-repository.ts` 读 `chat_presets`（含 `openingPrompt` / `skills` /
 * `agents`），本该走「读租户表 ⇒ 经 `Guarded<T>` 出门」的正门（`lint-permission-paths.mjs`
 * 的默认规则），但它被列进了该脚本的 ALLOWLIST——理由是「读了，但从没把这三个字段
 * 回吐给调用者」。这句话如果不被断言，就是一句可以随时被打破却没人发现的承诺。
 * 所以这里对 `upsertPreset` / `dispatchPreset` / `startPresetInstance` /
 * `getPresetUsage` 四个函数的返回值各自跑一遍：塞一个非空的
 * `openingPrompt`/`skills`/`agents` 进假仓储，断言返回的 JSON 里**没有**这三个键。
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { upsertPreset } from "../../src/application/chat/upsert-preset";
import { dispatchPreset } from "../../src/application/chat/dispatch-preset";
import { startPresetInstance } from "../../src/application/chat/start-preset-instance";
import { getPresetUsage } from "../../src/application/chat/get-preset-usage";
import type {
  ChatPresetRepository,
  PresetDispatchRecord,
  PresetInstanceRecord,
  PresetRecord,
  UpsertPresetOutcome,
  UpsertPresetRepoInput,
} from "../../src/application/chat/ports";
import type { NewThreadInput } from "../../src/application/chat/ports";
import type { IdentityRepository, OrgMembershipRow, ProjectMembershipRow } from "../../src/application/identity/ports";
import type { AclObjectRef, BindingRow } from "../../src/application/identity/ports";
import type { OrgId } from "../../src/domain/org-id";
import type { IdFactory } from "../../src/application/artifact/ports";

const ORG = toOrgId("org-f115-echo");
const PROJECT = "proj-f115-echo";
const PRESET_CONTENT = {
  openingPrompt: "机密开场白：只对被下发者可见",
  skills: ["skill-secret"],
  agents: ["agent-secret"],
};
const FORBIDDEN_KEYS = ["openingPrompt", "skills", "agents"];

function assertNoContentLeak(result: object): void {
  const keys = Object.keys(result);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys).not.toContain(forbidden);
  }
}

/** 只实现测试用得到的方法，其余抛错——本测试若不小心调用到它们会当场暴露。 */
function notUsed(name: string): never {
  throw new Error(`unexpectedly called IdentityRepository.${name} in this test`);
}

function fakeIdentityRepo(role: ProjectMembershipRow["projectRole"] | null): IdentityRepository {
  return {
    findOrganization: async () => notUsed("findOrganization"),
    findOrgMembership: async () => notUsed("findOrgMembership") as unknown as OrgMembershipRow | null,
    findProjectMembership: async () =>
      role === null ? null : ({ projectRole: role, groupId: null, isHost: false } satisfies ProjectMembershipRow),
    findBindings: async (_orgId: OrgId, _objects: readonly AclObjectRef[]) =>
      new Map<string, BindingRow>(),
    listMemberships: async () => [],
    ensurePersonalLocalOrg: async () => notUsed("ensurePersonalLocalOrg"),
    findPersonalLocalOrg: async () => notUsed("findPersonalLocalOrg"),
    countOrgMembers: async () => notUsed("countOrgMembers"),
  };
}

function fakeIdFactory(): IdFactory {
  let n = 0;
  return { next: (prefix: string) => `${prefix}-${++n}` };
}

interface FakeState {
  preset: PresetRecord;
  instances: Map<string, PresetInstanceRecord>; // keyed by actorId
  dispatches: Map<string, PresetDispatchRecord>; // keyed by fingerprint
  dispatchedActors: Set<string>;
}

function fakeChatPresetRepo(state: FakeState): ChatPresetRepository {
  return {
    findPreset: async () => state.preset,
    upsertPreset: async (_orgId, _projectId, input: UpsertPresetRepoInput): Promise<UpsertPresetOutcome> => ({
      kind: "ok",
      presetId: input.presetId,
      version: state.preset.version + 1,
    }),
    findOutOfScopeResource: async () => null, // 全部在范围内，走放行分支
    countDispatchTargets: async () => 7,
    findExistingDispatch: async (_orgId, _presetId, fingerprint) => state.dispatches.get(fingerprint) ?? null,
    recordDispatch: async (_orgId, _presetId, fingerprint, _version, targetCount) => {
      const rec: PresetDispatchRecord = { dispatchId: `disp-${fingerprint}`, targetCount };
      state.dispatches.set(fingerprint, rec);
      state.dispatchedActors.add("u-actor");
      return rec;
    },
    isActorDispatchTarget: async (_orgId, _presetId, _projectId, actorId) => state.dispatchedActors.has(actorId),
    findInstanceForActor: async (_orgId, _presetId, actorId) => state.instances.get(actorId) ?? null,
    createPresetInstance: async (_orgId, _presetId, actorId, newThread: NewThreadInput) => {
      const rec: PresetInstanceRecord = { threadId: newThread.threadId, instanceId: `pinst-${actorId}` };
      state.instances.set(actorId, rec);
      return rec;
    },
    listPresetInstances: async () =>
      [...state.instances.entries()].map(([actorId, rec]) => ({ instanceId: rec.instanceId, startedBy: actorId })),
  };
}

function freshState(): FakeState {
  return {
    preset: { id: "preset-1", projectId: PROJECT, version: 1, createdBy: "u-facilitator", ...PRESET_CONTENT },
    instances: new Map(),
    dispatches: new Map(),
    dispatchedActors: new Set(),
  };
}

describe("F115 预设内容从不被回吐（lint-permission-paths.mjs 豁免的加载承重测试）", () => {
  it("upsertPreset 的返回值不含 openingPrompt/skills/agents", async () => {
    const state = freshState();
    const result = await upsertPreset(
      { repo: fakeIdentityRepo("facilitator"), chatPresets: fakeChatPresetRepo(state), presetIds: fakeIdFactory() },
      {
        userId: "u-facilitator", orgId: ORG, projectId: PROJECT, presetId: "preset-1",
        ...PRESET_CONTENT, expectedVersion: 1,
      },
    );
    assertNoContentLeak(result);
    expect(Object.keys(result).sort()).toEqual(["presetId", "version"]);
  });

  it("dispatchPreset 的返回值不含 openingPrompt/skills/agents", async () => {
    const state = freshState();
    const result = await dispatchPreset(
      { repo: fakeIdentityRepo("facilitator"), chatPresets: fakeChatPresetRepo(state) },
      {
        userId: "u-facilitator", orgId: ORG, projectId: PROJECT, presetId: "preset-1",
        targets: { plenary: true, groupIds: null, roles: null }, expectedVersion: null,
      },
    );
    assertNoContentLeak(result);
    expect(Object.keys(result).sort()).toEqual(["dispatchId", "targetCount"]);
  });

  it("startPresetInstance 的返回值不含 openingPrompt/skills/agents（即便内部读过它们）", async () => {
    const state = freshState();
    state.dispatchedActors.add("u-member");
    const result = await startPresetInstance(
      { chatPresets: fakeChatPresetRepo(state), threadIds: fakeIdFactory() },
      { userId: "u-member", orgId: ORG, projectId: PROJECT, presetId: "preset-1" },
    );
    assertNoContentLeak(result);
    expect(Object.keys(result).sort()).toEqual(["instanceId", "threadId"]);
  });

  it("getPresetUsage 的返回值不含 openingPrompt/skills/agents，且只有 usageCount", async () => {
    const state = freshState();
    state.instances.set("u-a", { threadId: "thr-a", instanceId: "pinst-a" });
    state.instances.set("u-b", { threadId: "thr-b", instanceId: "pinst-b" });
    const result = await getPresetUsage(
      { repo: fakeIdentityRepo("member"), chatPresets: fakeChatPresetRepo(state) },
      { userId: "u-member", orgId: ORG, projectId: PROJECT, presetId: "preset-1" },
    );
    assertNoContentLeak(result);
    expect(result).toEqual({ usageCount: 2 });
  });
});
