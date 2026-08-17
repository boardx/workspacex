/**
 * `trialRunSkill` 的模型解析这一段，作为纯函数直测——同 `tool-scope-cap-pure-fn.test.ts`
 * 的纪律：不起 DB、不起 HTTP，`AgentRunStore`/`ModelCallPort`/`OrgAgentModelReader`
 * 全用最小 fake 替身，只盯"三段回退（自愈式 org 模型 → 静态配置 → 诚实报
 * MODEL_UNAVAILABLE）到底选中了哪一段"这一件事。
 *
 * 人类反馈（2026-08-17，两次）：devapp 上试跑仍报 `MODEL_UNAVAILABLE`——排查发现第一版
 * 自愈式回退会无条件采信 `orgAgentModel.findAnyPublished()` 的返回值，即便那正是一个
 * 保证打不通的 provider（`deep-agent`，见 `pg-org-agent-model-reader.ts` 头注）。真正的
 * 过滤（只信任 `RoutingModelCallPort` 的通用 provider）发生在 `PgOrgAgentModelReader`
 * 的 SQL 里，是 infra 层，脱不开 DB 直测；这里锁的是 `trialRunSkill` 自己那一半逻辑：
 * **只要 `orgAgentModel` 返回了什么，就该怎么用**——包括"返回了但 modelId 是空串"
 * 这个边界，`??` 对空串不生效，是本文件要钉死的那一条。
 */
import { describe, expect, it } from "vitest";
import {
  trialRunSkill,
  type OrgAgentModel,
  type OrgAgentModelReader,
  type TrialRunSkillDeps,
} from "../../src/application/skill/trial-run-skill";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-trial-run-model-resolution");

function reader(result: OrgAgentModel | null): OrgAgentModelReader {
  return { findAnyPublished: async () => result };
}

function baseDeps(overrides: Partial<TrialRunSkillDeps>): TrialRunSkillDeps {
  const calls: { modelProvider: string; modelId: string }[] = [];
  return {
    identities: {
      findOrgMembership: async () => ({ orgRole: "member" }),
    } as unknown as TrialRunSkillDeps["identities"],
    runs: {
      readPinnedSkills: async () => [
        { versionId: "sv-1", stableName: "sv-1-stable", name: "试跑用 skill", content: "system prompt" },
      ],
    } as unknown as TrialRunSkillDeps["runs"],
    model: {
      complete: async (input) => {
        calls.push({ modelProvider: input.modelProvider, modelId: input.modelId });
        return { text: `echo:${input.modelProvider}/${input.modelId}`, tokens: 3 };
      },
    } as TrialRunSkillDeps["model"],
    modelProvider: "static-provider",
    modelId: "",
    log: () => {},
    trialRunIdFor: () => "tr-fixed",
    now: () => 0,
    ...overrides,
  };
}

describe("trialRunSkill 的三段模型回退", () => {
  it("① 没有 orgAgentModel 依赖、静态配置也是空串 ⇒ 诚实报 MODEL_UNAVAILABLE", async () => {
    const deps = baseDeps({});
    await expect(
      trialRunSkill(deps, { orgId: ORG, actorId: "u1", versionId: "sv-1", sampleInput: "hi" }),
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });

  it("② orgAgentModel 查不到（组织没有可借的已发布 agent）⇒ 退回静态配置", async () => {
    const deps = baseDeps({
      orgAgentModel: reader(null),
      modelProvider: "static-provider",
      modelId: "static-model",
    });
    const result = await trialRunSkill(deps, {
      orgId: ORG, actorId: "u1", versionId: "sv-1", sampleInput: "hi",
    });
    expect(result.output).toBe("echo:static-provider/static-model");
  });

  it("③ orgAgentModel 查到一个可用模型 ⇒ 优先用它，不用静态配置", async () => {
    const deps = baseDeps({
      orgAgentModel: reader({ provider: "generic-provider", modelId: "org-model-1" }),
      modelProvider: "static-provider",
      modelId: "static-model",
    });
    const result = await trialRunSkill(deps, {
      orgId: ORG, actorId: "u1", versionId: "sv-1", sampleInput: "hi",
    });
    expect(result.output).toBe("echo:generic-provider/org-model-1");
  });

  it(
    "④ ⭐ orgAgentModel 返回了一行、但 modelId 是空串 ⇒ 不采信它，退回静态配置" +
      "（这是第一版 `??` 会漏掉的边界：非 null 对象里的空串不会触发 `??` 回退）",
    async () => {
      const deps = baseDeps({
        orgAgentModel: reader({ provider: "generic-provider", modelId: "" }),
        modelProvider: "static-provider",
        modelId: "static-model",
      });
      const result = await trialRunSkill(deps, {
        orgId: ORG, actorId: "u1", versionId: "sv-1", sampleInput: "hi",
      });
      expect(result.output).toBe("echo:static-provider/static-model");
    },
  );

  it("⑤ orgAgentModel 返回空串、静态配置也是空串 ⇒ 两段都用不上，诚实报 MODEL_UNAVAILABLE", async () => {
    const deps = baseDeps({
      orgAgentModel: reader({ provider: "generic-provider", modelId: "" }),
      modelProvider: "static-provider",
      modelId: "",
    });
    await expect(
      trialRunSkill(deps, { orgId: ORG, actorId: "u1", versionId: "sv-1", sampleInput: "hi" }),
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
});
