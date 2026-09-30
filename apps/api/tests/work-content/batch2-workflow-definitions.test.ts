/**
 * batch2-workflow-definitions.test.ts —— 批次 2 七个 Workflow 定义（纯函数 + 文件系统，不连数据库）。
 *
 * 对着实体文档 §5 阶段表逐阶段核对（阶段顺序 / Skill / 能力分类 / sideEffect / 人工门），再核：
 * - 目录归属（shared：W003/W004/W007；operations：W052/W053/W055/W056）、key 取自 `BATCH2_WORKFLOW_SLOTS`、W017 不出现；
 * - 门恒 `autoApprove=false`，审批角色非空且不含 `workflow_initiator`；
 * - 按 starter-pack 注册：W055 因 S019 无 Skill 包而 unavailable（仅它），其余六个 available；
 * - 写类阶段在默认只读授权（无配置行）下被 effect-gateway 权限重查拦成 blocked_permission；授权到位后放行；
 * - 授权清单（`buildCapabilityCatalog` 默认目录）包含七个新 Workflow，写/发送分类逐项可见；
 * - 评测用例：文档 §14 的每条 E-case 要么在本文件有定义层断言，要么登记为「需运行时图」的已知缺口；
 * - 护栏：七个都不是内置 Definition、图不在生产图注册表（线性图运行时没有按 mode 选入口 / 按条件开门的能力，
 *   占位图会把写/发送伪装成成功——与销售线同一立场）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";
import { BATCH2_WORKFLOW_SLOTS, DEFERRED_WORKFLOW_IDS, PHASE_WORKFLOW_IDS, WorkflowCatalogItem } from "@repo/contracts/work-content";
import { OPERATIONS_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/operations";
import { SHARED_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/shared";
import {
  effectsOf,
  exactVersionResolver,
  registerWorkflowDefinitions,
  skillPinsOf,
  toDefinitionVersionInput,
  type WorkContentWorkflowModule,
} from "../../src/domain/work-content/workflow-definition-module";
import { contentWorkflowIdOf, contentWorkflowKeyOf } from "../../src/domain/agent/workflow-allowlist";
import { ComposedEffectPermissionRecheck, type EffectCapabilityAuthorityPort } from "../../src/application/workflow/effect-permission-recheck";
import { buildCapabilityCatalog, grantableCategories } from "../../src/application/workflow/workflow-capability-grants";
import { isRegisteredCapabilityCategory } from "../../src/domain/skill/capability-category-registry";
import { builtInWorkflowDefinitions, defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { DOC_FILES, REPO, docCaps, docEvalCaseIds, docGateId, docHasG5Line, docSkills, docStageRows } from "./batch2-workflow-docs";

const ALL: readonly WorkContentWorkflowModule[] = [...SHARED_WORKFLOW_DEFINITIONS, ...OPERATIONS_WORKFLOW_DEFINITIONS];
const byId = new Map(ALL.map((d) => [d.workflowId, d]));
const def = (id: string) => byId.get(id)!;
const stageOf = (id: string, stageId: string) => def(id).stages.find((s) => s.stageId === stageId)!;
const order = (id: string) => def(id).stages.map((s) => s.stageId);

/** 所有 work-* starter-pack 中的 (Skill, 版本)。 */
function packEntries(): { stableId: string; semanticVersion: string }[] {
  const root = resolve(REPO, "skills/starter-packs");
  const out = new Map<string, { stableId: string; semanticVersion: string }>();
  for (const dir of readdirSync(root).filter((d) => d.startsWith("work-"))) {
    for (const file of readdirSync(resolve(root, dir))) {
      const pack = JSON.parse(readFileSync(resolve(root, dir, file), "utf8")) as { skills: { name: string; semanticVersion: string }[] };
      for (const s of pack.skills) out.set(`${s.name}@${s.semanticVersion}`, { stableId: s.name, semanticVersion: s.semanticVersion });
    }
  }
  return [...out.values()];
}

/** 文档阶段名 → 本定义阶段名（B 侧与 A 侧同名的阶段在一份 Definition 内必须改名）。 */
const RENAMED: Record<string, Record<string, string>> = {
  W055: { B1: "pilot_intake", B7: "pilot_publish" },
  W056: { B1: "followup_intake" },
};
/** 本定义在文档之外多出的阶段（只允许 W004 把站内发布与内部邮件拆开）。 */
const EXTRA_AFTER: Record<string, { after: string; stageId: string }> = {
  W004: { after: "publish", stageId: "publish_mail" },
};
/** 文档能力格里出现、但不属于该阶段 `capabilityCategories` 的分类（有意不放进阶段）。 */
const DOC_CAP_NOT_ON_STAGE: Record<string, Record<string, string[]>> = {
  W004: { publish: ["mail.send"] }, // 拆到 publish_mail（external_send）
  W055: { pilot_publish: ["docs.publish"] }, // 只登记不执行（文档 B7）
};

function docStageId(id: string, row: { rowId: string; stageId: string }): string {
  return RENAMED[id]?.[row.rowId] ?? row.stageId;
}

describe("批次 2 · 目录归属与槽位", () => {
  it("shared = W003/W004/W007，operations = W052/W053/W055/W056，与 BATCH2_WORKFLOW_SLOTS 逐项一致", () => {
    expect(SHARED_WORKFLOW_DEFINITIONS.map((d) => d.workflowId)).toEqual(["W003", "W004", "W007"]);
    expect(OPERATIONS_WORKFLOW_DEFINITIONS.map((d) => d.workflowId)).toEqual(["W052", "W053", "W055", "W056"]);
    expect(ALL.map((d) => d.workflowId).sort()).toEqual([...PHASE_WORKFLOW_IDS.batch2].sort());
    for (const slot of BATCH2_WORKFLOW_SLOTS) {
      const d = def(slot.workflowId);
      expect(d.key).toBe(slot.key);
      expect(d.line).toBe(slot.line);
      expect(d.version).toBe(1);
      expect(d.title).toContain(slot.title);
    }
  });

  it("W017 不出现在任何目录；目录可经白名单寻址 key ↔ 稳定编号", () => {
    for (const w of DEFERRED_WORKFLOW_IDS) expect(ALL.map((d) => d.workflowId)).not.toContain(w);
    for (const d of ALL) {
      expect(contentWorkflowIdOf(d.key)).toBe(d.workflowId);
      expect(contentWorkflowKeyOf(d.workflowId)).toBe(d.key);
    }
  });
});

describe("批次 2 · 每个定义产出合法 runtime 元数据", () => {
  it.each(ALL.map((d) => [d.workflowId, d] as const))("%s graphRef = key:version，门挂在本定义阶段上", (_id, d) => {
    const input = toDefinitionVersionInput(d);
    expect(WorkflowDefinitionVersionInput.safeParse(input).success).toBe(true);
    expect(input.graphRef).toBe(`${d.key}:1`);
    expect(new Set(order(d.workflowId)).size).toBe(d.stages.length);
    for (const g of d.gates) {
      expect(d.stages.some((s) => s.stageId === g.stageId)).toBe(true);
      expect(g.autoApprove).toBe(false);
    }
    // 每个带 humanGate 的阶段恰有一道登记的门，反之亦然。
    expect(d.stages.filter((s) => s.humanGate).map((s) => s.stageId).sort()).toEqual(d.gates.map((g) => g.stageId).sort());
    for (const s of d.stages) {
      if (!s.humanGate) continue;
      expect(s.humanGate.approverRoles.length).toBeGreaterThan(0);
      expect(s.humanGate.approverRoles).not.toContain("workflow_initiator");
    }
  });

  it("能力分类全部已登记（ADR-120 登记表）", () => {
    for (const d of ALL) for (const s of d.stages) for (const c of s.capabilityCategories) expect(isRegisteredCapabilityCategory(c), `${d.workflowId}/${s.stageId}/${c}`).toBe(true);
  });
});

describe("批次 2 · 对照实体文档 §5 阶段表", () => {
  it.each(ALL.map((d) => [d.workflowId] as const))("%s 阶段顺序 / Skill / 能力 / sideEffect / 门 = 文档", (id) => {
    const rows = docStageRows(id);
    expect(rows.length).toBeGreaterThan(0);

    const expectedOrder = rows.map((r) => docStageId(id, r));
    const extra = EXTRA_AFTER[id];
    if (extra) expectedOrder.splice(expectedOrder.indexOf(extra.after) + 1, 0, extra.stageId);
    expect(order(id)).toEqual(expectedOrder);

    const docCapsOf = (rowId: string) => docCaps(rows.find((r) => r.rowId === rowId)!);
    for (const row of rows) {
      const stageId = docStageId(id, row);
      const s = stageOf(id, stageId);
      expect(s.skills.map((x) => x.stableId), `${id}/${stageId} skills`).toEqual(docSkills(row));
      expect(s.sideEffect, `${id}/${stageId} sideEffect`).toBe(row.sideEffect);

      const expectedCaps = /同 A1/.test(row.capCell) ? docCapsOf("A1") : docCaps(row);
      const dropped = DOC_CAP_NOT_ON_STAGE[id]?.[stageId] ?? [];
      expect([...s.capabilityCategories].sort(), `${id}/${stageId} caps`).toEqual(expectedCaps.filter((c) => !dropped.includes(c)).sort());

      const gateId = docGateId(row);
      const registered = def(id).gates.find((g) => g.stageId === stageId);
      expect(registered?.gateId ?? null, `${id}/${stageId} gate`).toBe(gateId);
      expect(Boolean(s.humanGate), `${id}/${stageId} humanGate`).toBe(gateId !== null);
    }
    // 门的集合没有多余（文档里每道 H 门都出现在某阶段行）。
    expect(def(id).gates.map((g) => g.gateId).sort()).toEqual(rows.flatMap((r) => docGateId(r) ?? []).sort());
  });

  it("W004 拆出的 publish_mail 是 external_send + mail.send，且站内 publish 不带 mail.send", () => {
    expect(stageOf("W004", "publish_mail").sideEffect).toBe("external_send");
    expect(stageOf("W004", "publish_mail").capabilityCategories).toEqual(["mail.send"]);
    expect(stageOf("W004", "publish").capabilityCategories).toEqual(["artifact.write", "notify.inapp"]);
  });

  it("副作用类一致：mail.send → external_send；其余写类分类所在阶段 ≥ write；只读阶段不带写类分类", () => {
    const writeCats = /\.(write|publish)$|^notify\.inapp$/;
    for (const d of ALL) {
      for (const s of d.stages) {
        for (const c of s.capabilityCategories) {
          if (c === "mail.send") expect(`${d.workflowId}/${s.stageId}:${s.sideEffect}`).toBe(`${d.workflowId}/${s.stageId}:external_send`);
          else if (writeCats.test(c)) expect(["write", "external_send"], `${d.workflowId}/${s.stageId}/${c}`).toContain(s.sideEffect);
        }
      }
    }
  });
});

describe("批次 2 · 门：审批角色与自批规则", () => {
  const gateOf = (id: string, gateId: string) => stageOf(id, def(id).gates.find((g) => g.gateId === gateId)!.stageId).humanGate!;

  it("W003：H1 决定人；H2/H3 不得自批（E4：D001 不能自批 H2），H2 与 H3 是两道不同的门、计划在前卡在后", () => {
    expect(gateOf("W003", "H1").approverRoles).toEqual(["decision_owner"]);
    expect(gateOf("W003", "H2").allowSelfApproval).toBe(false);
    expect(gateOf("W003", "H3").allowSelfApproval).toBe(false);
    expect(def("W003").gates.map((g) => g.stageId)).toEqual(["decide", "approve_plan", "approve_cards"]);
    const o = order("W003");
    for (const before of ["decide", "plan", "risk", "approve_plan", "materialize_preview", "approve_cards"]) expect(o.indexOf(before)).toBeLessThan(o.indexOf("write_cards"));
    expect(o.indexOf("plan")).toBeGreaterThan(o.indexOf("decide"));
    expect(def("W003").gates.find((g) => g.gateId === "H2")!.binds).toEqual(["planId", "planVersion", "inputsDigest"]);
  });

  it("W004：唯一的门是 H1（周报负责人）；mail.send 独立在门之后", () => {
    expect(def("W004").gates.map((g) => g.gateId)).toEqual(["H1"]);
    expect(gateOf("W004", "H1").approverRoles).toEqual(["digest_owner"]);
    const o = order("W004");
    expect(o.indexOf("publish_mail")).toBeGreaterThan(o.indexOf("review_digest"));
  });

  it("W007：H0–H4 五道门；发送在 H2 之后、解决在发送之后、知识库审阅最后", () => {
    expect(def("W007").gates.map((g) => g.gateId)).toEqual(["H0", "H1", "H2", "H3", "H4"]);
    const o = order("W007");
    expect(o.indexOf("send_reply")).toBeGreaterThan(o.indexOf("approve_reply"));
    expect(o.indexOf("resolve")).toBeGreaterThan(o.indexOf("send_reply"));
    expect(o.indexOf("kb_draft")).toBeGreaterThan(o.indexOf("resolve"));
    expect(o.indexOf("apply_triage")).toBeGreaterThan(o.indexOf("confirm_triage"));
    expect(gateOf("W007", "H1").approverRoles).toEqual(["ticket_owner", "support_manager"]);
  });

  it("W052：H1/H2 不允许自批（请求人与 sponsor 不能是唯一审批人）；规划只在受理之后；H2 审批角色含资源负责人", () => {
    expect(gateOf("W052", "H1").allowSelfApproval).toBe(false);
    expect(gateOf("W052", "H2").allowSelfApproval).toBe(false);
    expect(gateOf("W052", "H2").approverRoles).toContain("resource_owner");
    const o = order("W052");
    for (const s of def("W052").constraints!.planningAfterAcceptStages!) expect(o.indexOf(s)).toBeGreaterThan(o.indexOf("accept"));
    for (const s of ["create_project", "write_cards", "register_baseline"]) expect(o.indexOf(s)).toBeGreaterThan(o.indexOf("approve_baseline"));
    const planning = def("W052").stages.filter((s) => s.parallelGroup === "planning").map((s) => s.stageId);
    expect(planning).toEqual(["preview", "capacity", "risk"]);
  });

  it("W053：H3 多签；2a–2d 同属 gathering；通知（发布）在 H1 之后（E12：H1 无人处理无 notify）", () => {
    expect(def("W053").gates.find((g) => g.gateId === "H3")!.requiresDualSign).toBe(true);
    expect(gateOf("W053", "H3").allowSelfApproval).toBe(false);
    const gathering = def("W053").stages.filter((s) => s.parallelGroup === "gathering").map((s) => s.stageId);
    expect(gathering).toEqual(def("W053").constraints!.gatheringStages);
    const o = order("W053");
    expect(o.indexOf("publish")).toBeGreaterThan(o.indexOf("review_pack"));
    expect(stageOf("W053", "publish").capabilityCategories).toContain("notify.inapp");
    expect(o.indexOf("risk")).toBeLessThan(o.indexOf("review"));
  });

  it("W055：H1–H5；S011/S156 在 H1 之后（E2）；S019 只在 pilot_review 侧且在 H4 之后（E11）；docs.publish 不执行", () => {
    expect(def("W055").gates.map((g) => g.gateId)).toEqual(["H1", "H2", "H3", "H4", "H5"]);
    const o = order("W055");
    expect(o.indexOf("diagnose")).toBeGreaterThan(o.indexOf("validate_map"));
    expect(o.indexOf("plan")).toBeGreaterThan(o.indexOf("validate_map"));
    const pilotSide = def("W055").constraints!.pilotReviewStages!;
    expect(pilotSide).toContain("sop");
    expect(o.indexOf("sop")).toBeGreaterThan(o.indexOf("decide"));
    const s019Stages = def("W055").stages.filter((s) => s.skills.some((x) => x.stableId === "S019")).map((s) => s.stageId);
    expect(s019Stages.every((s) => pilotSide.includes(s))).toBe(true);
    for (const s of def("W055").stages) expect(s.capabilityCategories).not.toContain("docs.publish");
    const modeSplit = [...def("W055").constraints!.diagnoseAndPlanStages!, ...pilotSide].sort();
    expect(modeSplit).toEqual(order("W055").sort());
  });

  it("W056：H1/H2；S011/S179 在 H1 之后、建卡在 H2 之后（E2/E5）；行动项建卡不走 S142（矩阵无此边）", () => {
    expect(def("W056").gates.map((g) => g.gateId)).toEqual(["H1", "H2"]);
    expect(def("W056").gates.find((g) => g.gateId === "H2")!.requiresDualSign).toBe(true);
    expect(gateOf("W056", "H2").approverRoles).toEqual(expect.arrayContaining(["incident_commander", "engineering_lead", "legal_counsel"]));
    const o = order("W056");
    for (const s of ["diagnose", "document"]) expect(o.indexOf(s)).toBeGreaterThan(o.indexOf("confirm_facts"));
    for (const s of ["materialize_actions", "publish"]) expect(o.indexOf(s)).toBeGreaterThan(o.indexOf("review_assign"));
    for (const id of def("W056").constraints!.stagesWithoutSkill!) expect(stageOf("W056", id).skills).toEqual([]);
    expect(skillPinsOf(def("W056")).map((p) => p.skillId)).not.toContain("S142");
    const split = [...def("W056").constraints!.postmortemStages!, ...def("W056").constraints!.followThroughStages!].sort();
    expect(split).toEqual(o.slice().sort());
  });

  it("W003 / W007 模式与条件约束在 constraints 里自洽", () => {
    const w3 = def("W003").constraints!;
    expect([...w3.planAndMaterializeStages!, ...w3.followThroughStages!.filter((s) => s !== "intake")].sort()).toEqual(order("W003").sort());
    expect(w3.scheduleAllowedModes).toEqual(["follow_through"]);
    const w7 = def("W007").constraints!;
    for (const s of w7.uploadedOriginDisabledStages!) expect(["write", "external_send"]).toContain(stageOf("W007", s).sideEffect);
    // 上传模式禁用的恰是全部写/发阶段。
    expect(def("W007").stages.filter((s) => s.sideEffect === "write" || s.sideEffect === "external_send").map((s) => s.stageId).sort()).toEqual([...w7.uploadedOriginDisabledStages!].sort());
    expect(w7.triggerKinds).not.toContain("schedule");
    expect(def("W004").constraints!.neverWriteCapabilities).toEqual(["knowledge.graph.write"]);
    for (const s of def("W004").stages) expect(s.capabilityCategories).not.toContain("knowledge.graph.write");
  });
});

describe("批次 2 · 按 starter-pack 注册（pin 解析）", () => {
  const items = registerWorkflowDefinitions(ALL, exactVersionResolver(packEntries()));
  const item = (id: string) => items.find((i) => i.workflowId === id)!;

  it("目录条目满足 WorkflowCatalogItem 契约", () => {
    for (const i of items) expect(WorkflowCatalogItem.safeParse(i).success, i.workflowId).toBe(true);
  });

  it("W003/W004/W007/W052/W053/W056 available；W055 只因 S019 无 Skill 包而 unavailable", () => {
    for (const id of ["W003", "W004", "W007", "W052", "W053", "W056"]) {
      expect(item(id).availability, id).toBe("available");
      expect(item(id).unresolvedPins).toEqual([]);
    }
    const w055 = item("W055");
    expect(w055.availability).toBe("unavailable");
    expect(w055.unavailableReason).toBe("workflow_skill_pin_unresolved");
    expect(w055.unresolvedPins).toEqual([{ skillId: "S019", semanticVersion: "1.0.0" }]);
  });

  it("S019 进包后 W055 自动 available（无需改定义）", () => {
    const withS019 = registerWorkflowDefinitions([def("W055")], exactVersionResolver([...packEntries(), { stableId: "S019", semanticVersion: "1.0.0" }]));
    expect(withS019[0]!.availability).toBe("available");
  });

  it("版本不匹配也算未解析：只让引用它的 Workflow 不可用", () => {
    const entries = packEntries().map((e) => (e.stableId === "S154" ? { ...e, semanticVersion: "9.9.9" } : e));
    const r = registerWorkflowDefinitions(ALL, exactVersionResolver(entries));
    const unavailable = r.filter((i) => i.availability === "unavailable").map((i) => i.workflowId).sort();
    expect(unavailable).toEqual(["W003", "W052", "W055"]);
    expect(r.find((i) => i.workflowId === "W052")!.unresolvedPins).toEqual([{ skillId: "S154", semanticVersion: "1.0.0" }]);
  });

  it("effects = 写/发送阶段的能力并集（每个 Workflow 都有、且含各自的写类分类）", () => {
    expect(effectsOf(def("W003"))).toEqual(expect.arrayContaining(["knowledge.graph.write", "board.write", "notify.inapp", "artifact.write"]));
    expect(effectsOf(def("W007"))).toEqual(expect.arrayContaining(["ticket.write", "tracker.write", "kb.publish", "mail.send"]));
    expect(effectsOf(def("W052"))).toEqual(expect.arrayContaining(["project.write", "project.member.write", "board.write"]));
    expect(effectsOf(def("W056"))).toEqual(expect.arrayContaining(["board.write", "artifact.write"]));
    for (const d of ALL) expect(effectsOf(d).length, d.workflowId).toBeGreaterThan(0);
  });
});

describe("批次 2 · 写类阶段在默认只读授权下 blocked_permission", () => {
  const access = {
    orgRoleOf: async () => "member" as const,
    runnableAgentVersion: async () => "agent-v1",
    workflowAllowlistRefusal: async () => null,
  };
  /** 没有配置行 = 保守默认（read 封顶 + 已授权），与 PgEffectCapabilityAuthority 对「无行」的返回一致。 */
  const defaultAuthority: EffectCapabilityAuthorityPort = { checkCapability: async () => ({ authorized: true, sideEffectCap: "read" }) };
  const grantedAuthority: EffectCapabilityAuthorityPort = { checkCapability: async () => ({ authorized: true, sideEffectCap: "external_send" }) };
  const recheckFor = (authority: EffectCapabilityAuthorityPort) => new ComposedEffectPermissionRecheck(access, authority);

  const writeStages = ALL.flatMap((d) =>
    d.stages.filter((s) => s.sideEffect === "write" || s.sideEffect === "external_send").flatMap((s) => s.capabilityCategories.map((c) => [d.workflowId, d.key, s.stageId, c, s.sideEffect] as const)),
  );

  it("写/发送阶段的每个 (阶段, 能力分类) 重查都被拦：capability_exceeds_side_effect_cap", async () => {
    expect(writeStages.length).toBeGreaterThan(20);
    const recheck = recheckFor(defaultAuthority);
    for (const [wid, key, stageId, cat, sideEffect] of writeStages) {
      const r = await recheck.recheck({ orgId: "o", instanceId: "i", stageId, workflowKey: key, initiatorUserId: "u", agentId: "a", agentVersionId: "v", capabilityCategory: cat, sideEffect });
      expect(r, `${wid}/${stageId}/${cat}`).toEqual({ ok: false, reasonCode: "capability_exceeds_side_effect_cap" });
    }
  });

  it("管理员授予对应封顶后放行（授权后可 resume）", async () => {
    const recheck = recheckFor(grantedAuthority);
    for (const [, key, stageId, cat, sideEffect] of writeStages) {
      const r = await recheck.recheck({ orgId: "o", instanceId: "i", stageId, workflowKey: key, initiatorUserId: "u", agentId: "a", agentVersionId: "v", capabilityCategory: cat, sideEffect });
      expect(r).toEqual({ ok: true });
    }
  });

  it("只读阶段不触发写权限：read / none 阶段在默认授权下放行", async () => {
    const recheck = recheckFor(defaultAuthority);
    for (const d of ALL) {
      for (const s of d.stages.filter((x) => x.sideEffect === "read")) {
        for (const c of s.capabilityCategories) {
          const r = await recheck.recheck({ orgId: "o", instanceId: "i", stageId: s.stageId, workflowKey: d.key, initiatorUserId: "u", agentId: "a", agentVersionId: "v", capabilityCategory: c, sideEffect: "read" });
          expect(r, `${d.workflowId}/${s.stageId}/${c}`).toEqual({ ok: true });
        }
      }
    }
  });
});

describe("批次 2 · 管理员授权页按 Workflow 展示需求", () => {
  const catalog = buildCapabilityCatalog();

  it("默认目录包含七个新 Workflow，且每个都列出写/发送分类与阶段", () => {
    for (const d of ALL) {
      const entry = catalog.find((e) => e.workflowId === d.workflowId);
      expect(entry, d.workflowId).toBeDefined();
      expect(entry!.workflowKey).toBe(d.key);
      expect(entry!.capabilities.length, d.workflowId).toBeGreaterThan(0);
      for (const c of entry!.capabilities) {
        expect(["write", "external_send"]).toContain(c.requiredCap);
        expect(c.stageIds.length).toBeGreaterThan(0);
      }
    }
  });

  it("需求上限按阶段抬升：mail.send 需要 external_send，board.write 只需 write", () => {
    const need = (wid: string, cat: string) => catalog.find((e) => e.workflowId === wid)!.capabilities.find((c) => c.capabilityCategory === cat)!;
    expect(need("W004", "mail.send").requiredCap).toBe("external_send");
    expect(need("W007", "mail.send").requiredCap).toBe("external_send");
    expect(need("W007", "ticket.write").requiredCap).toBe("external_send"); // send_reply 同线程回复（对外）
    expect(need("W003", "board.write").requiredCap).toBe("write");
    expect(need("W052", "project.write").stageIds).toEqual(["create_project"]);
  });

  it("写类分类都可授权（进入 grantableCategories），产品线 W029 仍在目录里", () => {
    const grantable = grantableCategories(catalog);
    for (const d of ALL) for (const c of effectsOf(d)) expect(grantable.has(c), `${d.workflowId}/${c}`).toBe(true);
    expect(catalog.some((e) => e.workflowId === "W029")).toBe(true);
    expect(catalog.some((e) => e.workflowId === "W011")).toBe(false);
  });
});

describe("批次 2 · 评测用例（文档 §14）", () => {
  /**
   * 文档 §14 的用例是「确定性 case 跑回环模型」的**运行时**评测，需要 Workflow 图真实执行（Skill 执行、门、写路径）。
   * 本批只交付 Definition（图不注册，见下一组护栏），所以每条 E-case 必须落在两类之一：
   * - structural：可由 Definition 的形状直接判定的部分，已在上面的测试里断言（见括号里的测试锚点）；
   * - runtime：需要图执行，登记为已知缺口，待图与评测夹具落地（`evals/work-stack/W0xx/`）后转为真实 eval。
   */
  const STRUCTURAL: Record<string, string[]> = {
    W003: ["E4", "E6", "E13"], // H2 不可自批；H2/H3 分离；写卡阶段被权限重查拦下
    W004: ["E4", "E7", "E8"], // H1 恒在发布前（autoApprove=false）；mail.send 独立 external_send；S197 只提议（无 graph.write）
    W007: ["E5", "E9"], // apply_triage 在 H0 之后；上传模式禁用的恰是全部写/发阶段
    W052: ["E4", "E5", "E6", "E12", "E13"], // 规划在 H1 之后；H2 含资源负责人；H1/H2 不可自批；写卡被拦
    W053: ["E6", "E12"], // H3 多签且不可自批；发布（notify）在 H1 之后
    W055: ["E2", "E11"], // S011/S156 在 H1 之后；S019 只在 pilot_review 且在 H4 之后
    W056: ["E2", "E5", "E9"], // S011/S179 在 H1 之后；建卡在 H2 之后；无 S142（写卡逐卡 receipt）
  };

  it.each(Object.keys(DOC_FILES).map((id) => [id] as const))("%s §14 用例编号连续、含 G5 判据，structural 用例都在文档里", (id) => {
    const ids = docEvalCaseIds(id);
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(ids).toEqual(ids.map((_, i) => `E${i + 1}`));
    expect(docHasG5Line(id)).toBe(true);
    for (const c of STRUCTURAL[id]!) expect(ids).toContain(c);
    const runtimeOnly = ids.filter((c) => !STRUCTURAL[id]!.includes(c));
    expect(runtimeOnly.length + STRUCTURAL[id]!.length).toBe(ids.length);
  });
});

describe("批次 2 · 护栏：不作为内置 Definition 发布、图不在生产注册表", () => {
  it("七个 Workflow 都不在内置 Definition 与生产图注册表里（多 mode 入口 / 条件门 / 写路径未接线）", () => {
    const keys = builtInWorkflowDefinitions().map((d) => d.key);
    const refs = defaultWorkflowGraphs().map((g) => g.graphRef);
    for (const d of ALL) {
      expect(keys).not.toContain(d.key);
      expect(refs).not.toContain(`${d.key}:${d.version}`);
    }
  });

  it("每个 Workflow 的 skillPins 集合没有重复 stableId（同一 Skill 只钉一个版本）", () => {
    for (const d of ALL) {
      const pins = skillPinsOf(d).map((p) => p.skillId);
      expect(new Set(pins).size).toBe(pins.length);
    }
  });
});
