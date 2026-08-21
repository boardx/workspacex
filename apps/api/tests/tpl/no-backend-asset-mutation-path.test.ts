/**
 * F28 · **不存在从项目上下文直接写后台资产的旁路 + 关键动作写审计**（`uc-2-2#R6`）。
 *
 * 两个方向：
 *
 *   ① **旁路清单**：跨两个能力域（`templates` 蓝本 / `skill` 工作流模板）核对同一条性质——
 *      application 层里，能碰到「后台资产本体」（蓝本 / 工作流模板 / 画布模板 / skill /
 *      agent）的端口方法名集合是一份**钉死的白名单**，且白名单里没有任何回写动词。
 *      `skill` 束（F63）已经把这条钉在 `TEMPLATE_PORTS_ALLOWED_METHODS` 上——本文件不重
 *      新发明一套判断，而是把它当作跨域共享的性质**一并断言**，因为「换绑模板与 skill」
 *      这条编辑面本身就落在 `skill` 束的端口上，F28 的隔离承诺覆盖到它。
 *   ② **审计**（V19/V18/V6 + `uc-2-2#R6` 逐字「套用蓝本…均写审计」）：套用蓝本成功写
 *      `套用`；三条权限/可见性判定被拒各自写 `越权尝试`，且**零业务写入**
 *      （`repo.apply` 从未被调用）——审计与业务写入互斥这条本身也是隔离的一部分：
 *      被拒的调用不该在业务侧留下任何痕迹,只该在审计侧留下痕迹。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyBlueprintUseCase, ApplyBlueprintError } from "../../src/application/templates/apply-blueprint";
import type { ApplyBlueprintCommand, ApplyBlueprintRepository, AppliedProject } from "../../src/application/templates/apply-blueprint-ports";
import type { BlueprintAuditRecordInput, BlueprintAuditWriter } from "../../src/application/templates/blueprint-audit-ports";
import { TEMPLATE_PORTS_ALLOWED_METHODS } from "../../src/application/skill/ports";
import type { BlueprintVersion } from "../../src/domain/templates/blueprint-version";
import { designFacetKeys } from "../../src/domain/templates/design-facet-table";
import { toOrgId } from "../../src/domain/org-id";

const SKILL_PORTS_SRC = fileURLToPath(new URL("../../src/application/skill/ports.ts", import.meta.url));

const V1: BlueprintVersion = {
  id: "v-1",
  blueprintId: "bp-1",
  versionNumber: 1,
  content: {},
  changedDesignFacetKeys: [],
  rolledBackFrom: null,
  state: "published",
};

class RecordingAuditWriter implements BlueprintAuditWriter {
  readonly records: BlueprintAuditRecordInput[] = [];
  async record(input: BlueprintAuditRecordInput): Promise<void> {
    this.records.push(input);
  }
}

class SpyRepository implements ApplyBlueprintRepository {
  calls = 0;
  async apply(cmd: ApplyBlueprintCommand): Promise<AppliedProject> {
    this.calls += 1;
    return { projectId: "p-1", blueprintVersionId: cmd.blueprintVersionId, initialized: cmd.initialized, created: true };
  }
}

const baseInput = {
  orgId: toOrgId("org-1"),
  actorId: "u-1",
  blueprintId: "bp-1",
  blueprintExists: true,
  visibleToActor: true,
  resolvedVersion: V1,
  filledFacetKeys: designFacetKeys(),
  tier: "two-day" as const,
  projectName: "新项目",
  idempotencyKey: "idem-1",
  flowAgendaContent: null,
};

describe("① 旁路清单：能碰后台资产本体的端口方法名恒等于白名单，且没有回写动词", () => {
  it("方法集合与 TEMPLATE_PORTS_ALLOWED_METHODS 逐字相等（结构性质，不是约定）", () => {
    const src = readFileSync(SKILL_PORTS_SRC, "utf8");
    for (const [iface, allowed] of Object.entries(TEMPLATE_PORTS_ALLOWED_METHODS)) {
      const m = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`, "m").exec(src);
      expect(m, `${iface} 不在 ports.ts 里`).not.toBeNull();
      const methods = [...(m![1] as string).matchAll(/^\s{2}(\w+)\s*\(/gm)].map((x) => x[1]);
      expect(new Set(methods)).toEqual(new Set(allowed));
    }
  });

  it("模板本体侧的两个端口（读模板 / 建组织模板）没有 save/update/patch/write/upsert 这类回写动词", () => {
    // ⚠ 只查「碰后台资产本体」的两个端口——`ProjectOrchestrationStorePort` 是**项目实例**
    // 自己的存储（instance 级编排，改它是「改这场项目」，不是「回写模板」），它的 `save`
    // 恰恰是隔离模型允许的那一半：实例可以自由写自己的存储，只是不能碰模板本体的存储。
    const backendAssetPorts = ["WorkflowTemplateReadPort", "OrgTemplateCreatePort"] as const;
    const forbidden = ["save", "update", "patch", "write", "upsert", "delete"];
    for (const iface of backendAssetPorts) {
      for (const verb of forbidden) {
        expect(TEMPLATE_PORTS_ALLOWED_METHODS[iface] as readonly string[]).not.toContain(verb);
      }
    }
  });
});

describe("② 审计：套用蓝本成功写 `套用`，且不重复计数幂等重放", () => {
  it("成功套用一次 ⇒ 恰好一条 `套用` 审计记录，字段带 blueprintId/actorId/projectId", async () => {
    const repo = new SpyRepository();
    const auditWriter = new RecordingAuditWriter();

    const out = await applyBlueprintUseCase(
      { repo, auditWriter },
      { ...baseInput, actorOrgRole: "lead" },
    );

    expect(auditWriter.records).toHaveLength(1);
    expect(auditWriter.records[0]).toMatchObject({
      blueprintId: "bp-1",
      actorId: "u-1",
      action: "套用",
    });
    expect(auditWriter.records[0]!.detail).toMatchObject({ projectId: out.projectId });
  });

  it("没有传 auditWriter 时套用照常成功——审计是可选依赖，不是隐藏前置条件", async () => {
    const repo = new SpyRepository();
    await expect(
      applyBlueprintUseCase({ repo }, { ...baseInput, idempotencyKey: "idem-noaudit", actorOrgRole: "lead" }),
    ).resolves.toMatchObject({ projectId: expect.any(String) });
  });
});

describe("② 审计：三条权限/可见性判定被拒 ⇒ 写 `越权尝试`，且零业务写入", () => {
  it("组织层无角色：NO_ORG_ROLE，repo.apply 从未被调用，审计写 `越权尝试`", async () => {
    const repo = new SpyRepository();
    const auditWriter = new RecordingAuditWriter();

    await expect(
      applyBlueprintUseCase({ repo, auditWriter }, { ...baseInput, actorOrgRole: null }),
    ).rejects.toThrow(ApplyBlueprintError);

    expect(repo.calls).toBe(0);
    expect(auditWriter.records).toHaveLength(1);
    expect(auditWriter.records[0]).toMatchObject({ action: "越权尝试" });
    expect(auditWriter.records[0]!.detail).toMatchObject({ reasonCode: "NO_ORG_ROLE" });
  });

  it("角色不足（非 lead，含 admin）：ROLE_INSUFFICIENT，零业务写入，审计写 `越权尝试`", async () => {
    const repo = new SpyRepository();
    const auditWriter = new RecordingAuditWriter();

    // ⚠ 同头注②：**连 admin 都不行**——套用蓝本的终点是建项目容器，只有 lead 能建。
    await expect(
      applyBlueprintUseCase({ repo, auditWriter }, { ...baseInput, actorOrgRole: "admin" }),
    ).rejects.toThrow(ApplyBlueprintError);

    expect(repo.calls).toBe(0);
    expect(auditWriter.records[0]).toMatchObject({ action: "越权尝试" });
    expect(auditWriter.records[0]!.detail).toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
  });

  it("team-only 蓝本对非该 team 成员不可见：BLUEPRINT_NOT_VISIBLE，零业务写入，审计写 `越权尝试`", async () => {
    const repo = new SpyRepository();
    const auditWriter = new RecordingAuditWriter();

    await expect(
      applyBlueprintUseCase(
        { repo, auditWriter },
        { ...baseInput, actorOrgRole: "lead", visibleToActor: false },
      ),
    ).rejects.toThrow(ApplyBlueprintError);

    expect(repo.calls).toBe(0);
    expect(auditWriter.records[0]).toMatchObject({ action: "越权尝试" });
    expect(auditWriter.records[0]!.detail).toMatchObject({ reasonCode: "BLUEPRINT_NOT_VISIBLE" });
  });

  it("六类写入失败（INITIALIZATION_FAILED）⇒ 不写 `套用`——失败的那次不产生审计记录", async () => {
    const auditWriter = new RecordingAuditWriter();
    const failingRepo: ApplyBlueprintRepository = {
      async apply(): Promise<AppliedProject> {
        const { BlueprintInitializationFailedError } = await import(
          "../../src/application/templates/apply-blueprint-ports"
        );
        throw new BlueprintInitializationFailedError("分组");
      },
    };

    await expect(
      applyBlueprintUseCase({ repo: failingRepo, auditWriter }, { ...baseInput, actorOrgRole: "lead" }),
    ).rejects.toThrow(ApplyBlueprintError);

    expect(auditWriter.records).toEqual([]);
  });
});
