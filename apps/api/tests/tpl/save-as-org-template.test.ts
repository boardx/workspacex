import { describe, expect, it } from "vitest";
import {
  saveAsOrgTemplate,
  SaveAsOrgTemplateError,
} from "../../src/application/templates/save-as-org-template";
import type {
  OrchestrationRepository,
  OrgTemplateCreatePort,
} from "../../src/application/templates/workflow-orchestration-ports";
import type { WorkflowOrchestrationSnapshot } from "../../src/domain/templates/workflow-orchestration";

/**
 * F26 —— `[另存为组织模板]`（`uc-2-2` R7 步骤 8 / 契约 `saveAsOrgTemplate`）。
 *
 * ⚠ O-02：产物是**工作流模板**，不是新蓝本；不需要蓝本维护者审核——它与 UC-2.3
 *   的「提交回蓝本」是两条不同路径，这里不断言任何蓝本侧的写入（因为依赖清单里
 *   本来就没有能写蓝本的端口）。
 * ⚠ I-17：不回写来源模板——本用例的依赖里**没有**「读/写来源模板本体」的端口，
 *   只有 `OrchestrationRepository.load`（读实例）与 `OrgTemplateCreatePort.create`
 *   （只有 create，没有 update/upsert）。
 */

class FakeOrchestrationRepository implements OrchestrationRepository {
  store = new Map<string, WorkflowOrchestrationSnapshot>();
  async load(projectId: string) {
    return this.store.get(projectId) ?? null;
  }
  async replace() {
    throw new Error("not used in this test file");
  }
  async upsertCell(): Promise<{ ok: true; revision: string } | { ok: false }> {
    throw new Error("not used in this test file");
  }
}

class FakeOrgTemplateCreatePort implements OrgTemplateCreatePort {
  created: Parameters<OrgTemplateCreatePort["create"]>[0][] = [];
  nextId = "new-tpl-1";
  /** 测试可配置：模拟一个坏实现，把新 id 分配成来源模板 id（应被用例本身拦下）。 */
  returnSourceIdInstead: string | null = null;

  async create(input: Parameters<OrgTemplateCreatePort["create"]>[0]) {
    this.created.push(input);
    return { workflowTemplateId: this.returnSourceIdInstead ?? this.nextId };
  }
}

const INSTANCE: WorkflowOrchestrationSnapshot = {
  template: { templateId: "tpl-source-v2", name: "设计思维标准五步", sourceVersion: 2 },
  segments: [
    { agendaSegmentId: "seg-1", title: "共情", addedBy: null, optional: false },
    { agendaSegmentId: "seg-2", title: "定义", addedBy: null, optional: false },
  ],
  matrix: [
    {
      cellId: "cell-1",
      agendaSegmentId: "seg-1",
      roleKey: "facilitator",
      content: "开场",
      canvasTemplateId: "tpl-hmw",
      skillIds: ["skill-voice-to-note"],
    },
  ],
  revision: "rev-1",
};

function makeDeps() {
  const orchestrations = new FakeOrchestrationRepository();
  orchestrations.store.set("proj-1", INSTANCE);
  const orgTemplates = new FakeOrgTemplateCreatePort();
  return { orchestrations, orgTemplates };
}

describe("saveAsOrgTemplate", () => {
  it("无写权限（observer） ⇒ ROLE_INSUFFICIENT，且不调用 create", async () => {
    const deps = makeDeps();
    await expect(
      saveAsOrgTemplate(deps, {
        projectId: "proj-1",
        orgId: "org-1",
        name: "我的模板",
        actorProjectRole: "observer",
      }),
    ).rejects.toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
    expect(deps.orgTemplates.created).toHaveLength(0);
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const deps = makeDeps();
    await expect(
      saveAsOrgTemplate(deps, {
        projectId: "proj-1",
        orgId: "org-1",
        name: "我的模板",
        actorProjectRole: null,
      }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("该项目尚无实例编排 ⇒ DEPENDENCY_UNAVAILABLE", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    const orgTemplates = new FakeOrgTemplateCreatePort();
    await expect(
      saveAsOrgTemplate(
        { orchestrations, orgTemplates },
        { projectId: "proj-none", orgId: "org-1", name: "我的模板", actorProjectRole: "facilitator" },
      ),
    ).rejects.toBeInstanceOf(SaveAsOrgTemplateError);
  });

  it("成功：产出新 workflowTemplateId，且携带当前实例的环节链与矩阵内容", async () => {
    const deps = makeDeps();
    const out = await saveAsOrgTemplate(deps, {
      projectId: "proj-1",
      orgId: "org-1",
      name: "我的工作坊模板",
      actorProjectRole: "facilitator",
    });
    expect(out.workflowTemplateId).toBe("new-tpl-1");
    expect(deps.orgTemplates.created).toHaveLength(1);
    const call = deps.orgTemplates.created[0]!;
    expect(call.orgId).toBe("org-1");
    expect(call.name).toBe("我的工作坊模板");
    expect(call.segments.map((s) => s.agendaSegmentId)).toEqual(["seg-1", "seg-2"]);
    expect(call.matrix).toHaveLength(1);
    expect(call.matrix[0]).toMatchObject({ agendaSegmentId: "seg-1", roleKey: "facilitator" });
  });

  it("新模板 id ≠ 来源模板 id（I-17：一份新本体，不是覆盖来源）", async () => {
    const deps = makeDeps();
    const out = await saveAsOrgTemplate(deps, {
      projectId: "proj-1",
      orgId: "org-1",
      name: "另存的模板",
      actorProjectRole: "facilitator",
    });
    expect(out.workflowTemplateId).not.toBe(INSTANCE.template.templateId);
  });

  it("端口把新 id 分配成来源模板 id 时（I-17 违规实现）：用例本身拦下，不静默放行", async () => {
    const deps = makeDeps();
    deps.orgTemplates.returnSourceIdInstead = INSTANCE.template.templateId;
    await expect(
      saveAsOrgTemplate(deps, {
        projectId: "proj-1",
        orgId: "org-1",
        name: "另存的模板",
        actorProjectRole: "facilitator",
      }),
    ).rejects.toThrow(/overwrite, not a save-as/);
  });

  it("依赖清单只有两个键：读实例 + 只写一次的 create（结构性不回写，见文件头注）", () => {
    const deps = makeDeps();
    expect(Object.keys(deps).sort()).toEqual(["orchestrations", "orgTemplates"]);
  });
});
