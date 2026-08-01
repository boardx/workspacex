import { describe, expect, it } from "vitest";
import {
  getWorkflowOrchestration,
  GetWorkflowOrchestrationError,
} from "../../src/application/templates/get-workflow-orchestration";
import {
  switchWorkflowTemplate,
  SwitchWorkflowTemplateError,
} from "../../src/application/templates/switch-workflow-template";
import type {
  OrchestrationRepository,
  WorkflowTemplateCatalogEntry,
  WorkflowTemplateCatalogPort,
} from "../../src/application/templates/workflow-orchestration-ports";
import type { WorkflowOrchestrationSnapshot } from "../../src/domain/templates/workflow-orchestration";

/**
 * F26 —— 工作流编排：模板层（两级继承）+ 换模板破坏性确认（`uc-2-2` R7）。
 *
 * ## 两级继承（O-02）
 * 蓝本 ⊃ 工作流模板：项目此刻的编排（`getWorkflowOrchestration`）带着一个
 * `template.sourceVersion`（「来自后台 v2」），且它是套用时的**快照**——本文件不
 * 断言快照不漂移本身（那是 F23/F30 的断言面），只断言读出来的形状确实带着这两级
 * 该有的字段（模板层 + 环节链 + 矩阵）。
 *
 * ## 换模板须先出影响面、后写入（A5/V9f）
 * `confirmed: false` ⇒ 零写入，只读返回 `impact`；`confirmed: true` 才真正替换。
 */

class FakeOrchestrationRepository implements OrchestrationRepository {
  store = new Map<string, WorkflowOrchestrationSnapshot>();
  replaceCalls: { projectId: string; snapshot: WorkflowOrchestrationSnapshot }[] = [];

  async load(projectId: string) {
    return this.store.get(projectId) ?? null;
  }
  async replace(projectId: string, snapshot: WorkflowOrchestrationSnapshot) {
    this.replaceCalls.push({ projectId, snapshot });
    this.store.set(projectId, snapshot);
  }
  async upsertCell(): Promise<{ readonly ok: true; readonly revision: string } | { readonly ok: false }> {
    throw new Error("not used in this test file");
  }
}

class FakeCatalog implements WorkflowTemplateCatalogPort {
  entries = new Map<string, WorkflowTemplateCatalogEntry>();
  async load(templateId: string) {
    return this.entries.get(templateId) ?? null;
  }
}

const CURRENT_SNAPSHOT: WorkflowOrchestrationSnapshot = {
  template: { templateId: "tpl-design-thinking-5", name: "设计思维标准五步", sourceVersion: 2 },
  segments: [
    { agendaSegmentId: "seg-1", title: "共情", addedBy: null, optional: false },
    { agendaSegmentId: "seg-2", title: "定义", addedBy: null, optional: false },
    { agendaSegmentId: "seg-3", title: "构思", addedBy: null, optional: true },
  ],
  matrix: [
    {
      cellId: "cell-1",
      agendaSegmentId: "seg-1",
      roleKey: "facilitator",
      content: "开场引导",
      canvasTemplateId: "tpl-hmw",
      skillIds: ["skill-voice-to-note"],
    },
    {
      cellId: "cell-2",
      agendaSegmentId: "seg-3",
      roleKey: "member",
      content: "写 ≥1 张便签",
      canvasTemplateId: null,
      skillIds: [],
    },
    {
      cellId: "cell-3",
      agendaSegmentId: "seg-3",
      roleKey: "groupLead",
      content: "",
      canvasTemplateId: null,
      skillIds: [],
    },
  ],
  revision: "rev-1",
};

describe("getWorkflowOrchestration —— 两级继承的读面", () => {
  it("无项目角色 ⇒ NO_PROJECT_ROLE，且不触碰仓储", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    await expect(
      getWorkflowOrchestration(
        { orchestrations },
        { projectId: "proj-1", actorProjectRole: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
    expect(orchestrations.store.size).toBe(0);
  });

  it("observer 也能读（契约 err 里没有 ROLE_INSUFFICIENT）", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    orchestrations.store.set("proj-1", CURRENT_SNAPSHOT);
    const out = await getWorkflowOrchestration(
      { orchestrations },
      { projectId: "proj-1", actorProjectRole: "observer" },
    );
    expect(out.template).toEqual({
      templateId: "tpl-design-thinking-5",
      name: "设计思维标准五步",
      sourceVersion: 2,
    });
    expect(out.segmentChain).toHaveLength(3);
    expect(out.matrix).toHaveLength(3);
  });

  it("该项目尚无实例编排 ⇒ DEPENDENCY_UNAVAILABLE", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    await expect(
      getWorkflowOrchestration(
        { orchestrations },
        { projectId: "proj-none", actorProjectRole: "facilitator" },
      ),
    ).rejects.toBeInstanceOf(GetWorkflowOrchestrationError);
  });
});

describe("switchWorkflowTemplate —— 破坏性变更须先出影响面（A5/V9f）", () => {
  const TARGET: WorkflowTemplateCatalogEntry = {
    templateId: "tpl-business-model",
    name: "商业模式共创",
    sourceVersion: 1,
    segments: [
      { agendaSegmentId: "seg-1", title: "共情", addedBy: null, optional: false },
      { agendaSegmentId: "seg-9", title: "画布填写", addedBy: null, optional: false },
    ],
    matrix: [
      {
        cellId: "tpl-cell-1",
        agendaSegmentId: "seg-9",
        roleKey: "facilitator",
        content: "讲解画布",
        canvasTemplateId: "tpl-business-model-canvas",
        skillIds: [],
      },
    ],
  };

  function makeDeps() {
    const orchestrations = new FakeOrchestrationRepository();
    orchestrations.store.set("proj-1", CURRENT_SNAPSHOT);
    const catalog = new FakeCatalog();
    catalog.entries.set(TARGET.templateId, TARGET);
    let idx = 0;
    let revCount = 0;
    return {
      orchestrations,
      catalog,
      newCellId: (i: number) => `new-cell-${i}-${idx++}`,
      newRevision: () => `rev-${++revCount}`,
    };
  }

  it("无写权限（observer） ⇒ ROLE_INSUFFICIENT，零写入", async () => {
    const deps = makeDeps();
    await expect(
      switchWorkflowTemplate(deps, {
        projectId: "proj-1",
        templateId: TARGET.templateId,
        confirmed: true,
        actorProjectRole: "observer",
      }),
    ).rejects.toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
    expect(deps.orchestrations.replaceCalls).toHaveLength(0);
  });

  it("目标模板不存在 ⇒ DEPENDENCY_UNAVAILABLE", async () => {
    const deps = makeDeps();
    await expect(
      switchWorkflowTemplate(deps, {
        projectId: "proj-1",
        templateId: "tpl-nowhere",
        confirmed: true,
        actorProjectRole: "facilitator",
      }),
    ).rejects.toBeInstanceOf(SwitchWorkflowTemplateError);
  });

  it("confirmed: false ⇒ 只返回 impact，applied=false，且完全零写入", async () => {
    const deps = makeDeps();
    const out = await switchWorkflowTemplate(deps, {
      projectId: "proj-1",
      templateId: TARGET.templateId,
      confirmed: false,
      actorProjectRole: "facilitator",
    });
    expect(out.applied).toBe(false);
    // seg-2 与 seg-3 在目标模板里不存在 ⇒ 丢失；seg-3 上有两格（cell-2 非空，cell-3 空）
    expect(out.impact.lostSegments.map((s) => s.agendaSegmentId).sort()).toEqual(["seg-2", "seg-3"]);
    expect(out.impact.droppedCells).toBe(2); // cell-2 + cell-3 都挂在 seg-3
    expect(out.impact.affectedTasks).toBe(1); // 只有非空格 cell-2 计入（D-10 保守口径）
    expect(deps.orchestrations.replaceCalls).toHaveLength(0);
    // 仓储里原编排原样保留
    expect(await deps.orchestrations.load("proj-1")).toEqual(CURRENT_SNAPSHOT);
  });

  it("confirmed: true ⇒ 真正替换环节链与矩阵，applied=true", async () => {
    const deps = makeDeps();
    const out = await switchWorkflowTemplate(deps, {
      projectId: "proj-1",
      templateId: TARGET.templateId,
      confirmed: true,
      actorProjectRole: "facilitator",
    });
    expect(out.applied).toBe(true);
    expect(deps.orchestrations.replaceCalls).toHaveLength(1);
    const saved = await deps.orchestrations.load("proj-1");
    expect(saved?.template.templateId).toBe(TARGET.templateId);
    expect(saved?.segments.map((s) => s.agendaSegmentId)).toEqual(["seg-1", "seg-9"]);
    expect(saved?.matrix).toHaveLength(1);
  });

  it("首次为项目选模板（当前无编排）视同非破坏性：未确认也直接写入", async () => {
    const orchestrations = new FakeOrchestrationRepository();
    const catalog = new FakeCatalog();
    catalog.entries.set(TARGET.templateId, TARGET);
    const out = await switchWorkflowTemplate(
      { orchestrations, catalog, newCellId: (i) => `c-${i}`, newRevision: () => "rev-1" },
      {
        projectId: "proj-fresh",
        templateId: TARGET.templateId,
        confirmed: false,
        actorProjectRole: "facilitator",
      },
    );
    expect(out.applied).toBe(true);
    expect(out.impact.lostSegments).toEqual([]);
  });
});
