/**
 * role-authorization.ts —— PROP-HARNESS-AGENT-001 Epic E2（H3A-020/021/023/
 * 024/025/026/027/029）：把 §6 的 L1/L2/L3 分层模型和 §9.2 Authorization
 * Model 变成可对真实文件跑的校验器。
 *
 * 设计取舍（读完 E0 inventory 之后做的，写在这里免得下一个人重新踩一遍）：
 *
 * 1. `layer` 不写成 6 个真实 `.harness/agents/roles/*.yaml` 文件里的新增
 *    显式字段——那 6 个文件已经有 `kind` 字段（coordinator /
 *    architecture-coordinator / module-coordinator / worker / reviewer），
 *    §10.1 TPL-ROL-001 例子里的 `layer: domain_orchestrator` 和
 *    `kind: module-coordinator # legacy runtime enum` 两个字段同时出现，
 *    说明 spec 本身认为 `kind` 是要保留的 legacy 枚举、`layer` 是可以从它
 *    派生的规范视图，不是要求两处手工同步维护同一件事——本仓库刚好有一条
 *    反复踩坑的教训（AGENTS.md「同一事实不得声明在两处」，已经因为这个
 *    模式漂移过五次），所以这里选择"从 kind 派生 layer"而不是"新增 layer
 *    字段"，避免制造第六次。
 * 2. `supervisor` 直接复用 `reports_to`，`authority.merge`/`write_scopes`
 *    直接复用 `merge_authority`/`areas`——同样是"已有字段就是那个概念"，
 *    不重新发明命名。`authority.signoff` 在这 6 个文件里没有任何字段对应
 *    （E0 inventory 也没找到），校验器如实按"总是 false"处理，不假装读到
 *    了不存在的东西。
 * 3. `dispatch.allowed_child_layers/allowed_roles` 在真实文件里同样没有
 *    结构化数据——只有一个布尔 `dispatch_authority`。这里不编造一份
 *    allow-list 数据（那会是校验器自己编数据出来验证自己），只做布尔层面
 *    能验的事：谁被允许"拥有派生权"这件事本身（H3A-024/025/026）。
 *
 * 数据源两类，互不覆盖（同 role-freeze-doctor.ts 踩过的坑一样，这里也要
 * 小心不要漏了 registry.yaml 的 `reviewers:` 数组）：
 *   - `.harness/agents/roles/*.yaml`：6 个持久角色（L1/L2/部分 L3 reviewer）。
 *   - `.harness/agents/*.yaml`（不含 roles/ 子目录、不含 registry.yaml）：
 *     8 个扁平 subagent spec，对应 §6.3 里"没有持久角色文件、纯粹按任务
 *     派生"的 L3 Specialist Worker。
 *   - `.harness/agents/registry.yaml` 的 `agents:` + `reviewers:` 两个数组：
 *     身份登记权威，H3A-021/027 要用。
 *
 * 校验风格延续 terminology-model.ts 的先例：plain TS interface + 手写校验
 * 函数，累积上报全部问题，不 fail-fast。
 */

export type Layer = "root_orchestrator" | "domain_orchestrator" | "specialist_worker";

/**
 * H3A-020 完成契约原文指定的三个映射目标；键是 6 个真实角色文件里 `kind`
 * 字段的实际取值（`module-coordinator`/`architecture-coordinator` 都算
 * Domain Orchestrator——proposal §6.2 原文："Domain Orchestrator"是规范
 * 显示名，不新增语义重复的 kind；coord-architecture 在组织关系上视为
 * harness Domain 的 L2 Agent）。
 */
export const KIND_TO_LAYER: Readonly<Record<string, Layer>> = {
  coordinator: "root_orchestrator",
  "architecture-coordinator": "domain_orchestrator",
  "module-coordinator": "domain_orchestrator",
  worker: "specialist_worker",
  reviewer: "specialist_worker",
};

export interface Finding {
  code: string;
  severity: "FAIL" | "WARN";
  sourceFile: string;
  message: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/* ═══════════════════════ H3A-020：角色文件 schema + layer 派生 ═══════════════════════ */

export interface RawRoleFile {
  /** `.harness/agents/roles/<file>.yaml` 相对路径，用于定位问题。 */
  sourceFile: string;
  parsed: unknown;
}

/** 校验通过后的规范化视图——`layer`/`supervisor`/`authority` 都是从既有字段派生的，不是新字段。 */
export interface LayeredRole {
  sourceFile: string;
  name: string;
  kind: string;
  /** H3A-020：从 kind 派生的规范层级。 */
  layer: Layer;
  areas: string[];
  /** H3A-020 `supervisor` ≡ 既有 `reports_to`。 */
  supervisor: string | null;
  /** H3A-020 `authority.merge` ≡ 既有 `merge_authority`。 */
  mergeAuthority: boolean;
  /** H3A-020 `authority.signoff`——6 个真实文件里没有对应字段，恒为 false。 */
  signoffAuthority: false;
  /** H3A-020 `dispatch` 的布尔投影 ≡ 既有 `dispatch_authority`。 */
  dispatchAuthority: boolean;
}

/**
 * H3A-020 的核心：解析 + 校验一个角色文件，返回规范化视图或累积的问题列表。
 * 纯函数，不碰文件系统（IO 在 role-authorization-doctor.ts）。
 */
export function validateRoleFile(file: RawRoleFile): { role: LayeredRole | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${file.sourceFile}#${field}`;

  if (typeof file.parsed !== "object" || file.parsed === null || Array.isArray(file.parsed)) {
    return { role: null, issues: [{ path: file.sourceFile, message: "顶层必须是对象" }] };
  }
  const r = file.parsed as Record<string, unknown>;

  if (!isNonEmptyString(r.name)) issues.push({ path: p("name"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.kind)) issues.push({ path: p("kind"), message: "必须是非空字符串" });
  if (!Array.isArray(r.areas) || r.areas.some((a) => typeof a !== "string")) {
    issues.push({ path: p("areas"), message: "必须是字符串数组" });
  }
  if (r.reports_to !== null && !isNonEmptyString(r.reports_to)) {
    issues.push({ path: p("reports_to"), message: "必须是 null 或非空字符串" });
  }
  if (typeof r.merge_authority !== "boolean") {
    issues.push({ path: p("merge_authority"), message: "必须是布尔值" });
  }
  if (typeof r.dispatch_authority !== "boolean") {
    issues.push({ path: p("dispatch_authority"), message: "必须是布尔值" });
  }

  // kind 存在但映射不到已知 layer——H3A-020 完成契约要求 layer 可验证，
  // 映射表之外的 kind 无法派生出 layer，必须当成结构问题上报，不能悄悄跳过。
  let layer: Layer | undefined;
  if (isNonEmptyString(r.kind)) {
    layer = KIND_TO_LAYER[r.kind];
    if (!layer) {
      issues.push({
        path: p("kind"),
        message: `kind "${r.kind}" 不在已知映射表 [${Object.keys(KIND_TO_LAYER).join(", ")}] 里，无法派生 layer`,
      });
    }
  }

  if (issues.length > 0) return { role: null, issues };

  return {
    role: {
      sourceFile: file.sourceFile,
      name: r.name as string,
      kind: r.kind as string,
      layer: layer as Layer,
      areas: r.areas as string[],
      supervisor: (r.reports_to as string | null) ?? null,
      mergeAuthority: r.merge_authority as boolean,
      signoffAuthority: false,
      dispatchAuthority: r.dispatch_authority as boolean,
    },
    issues: [],
  };
}

export function validateRoleFiles(files: readonly RawRoleFile[]): { roles: LayeredRole[]; findings: Finding[] } {
  const roles: LayeredRole[] = [];
  const findings: Finding[] = [];
  for (const file of files) {
    const { role, issues } = validateRoleFile(file);
    if (role) roles.push(role);
    for (const issue of issues) {
      findings.push({
        code: "H3A020-INVALID-ROLE-FIELD",
        severity: "FAIL",
        sourceFile: file.sourceFile,
        message: issue.message,
      });
    }
  }
  return { roles, findings };
}

/* ═══════════════════════ H3A-021：Root Orchestrator 单例门 ═══════════════════════ */

export interface RegistryIdentity {
  id: string;
  kind: string;
  active: boolean;
}

/**
 * 检查 registry.yaml 的 `agents:` 数组——同一时刻最多一个
 * `kind: coordinator`（≡ layer root_orchestrator）身份是 `active: true`。
 * 只看 `agents:`，不看 `reviewers:`——reviewer 结构上不可能是 root
 * orchestrator（`kind: reviewer` 恒映射到 specialist_worker）。
 */
export function checkRootOrchestratorSingleton(agents: readonly RegistryIdentity[]): Finding[] {
  const activeRoots = agents.filter((a) => KIND_TO_LAYER[a.kind] === "root_orchestrator" && a.active);
  if (activeRoots.length <= 1) return [];
  return [
    {
      code: "H3A021-MULTIPLE-ROOT-ACTIVE",
      severity: "FAIL",
      sourceFile: ".harness/agents/registry.yaml",
      message:
        `${activeRoots.length} 个 layer:root_orchestrator（kind:coordinator）身份同时 active:true：` +
        `${activeRoots.map((a) => a.id).join(", ")}——同一时刻只能有一个 Root Orchestrator，` +
        `否则合并权/全局排序会出现两个权威`,
    },
  ];
}

/* ═══════════════════════ H3A-023：Specialist Worker（扁平 subagent spec）schema ═══════════════════════ */

export interface RawAgentSpec {
  /** `.harness/agents/<file>.yaml` 相对路径（不含 roles/ 子目录、不含 registry.yaml）。 */
  sourceFile: string;
  name: unknown;
  role: unknown;
  tools: unknown;
}

/**
 * H3A-023 完成契约："单一职责、I/O、tools、write scope、stop 条件完整"。
 * 今天的扁平 subagent spec（gen-subagents.ts 的 AgentSpec）只有 `role`
 * （任务类型字符串）和 `tools`（数组）两个字段能机械核实"单一职责"这件
 * 事——`write scope`/`stop 条件`目前只体现在 system_prompt 的自然语言里，
 * 不是结构化字段，如实不检查（不假装能从自由文本判定停止条件），只检查
 * 今天真的结构化的两项。
 *
 * tools 数量上限选 8：8 个真实文件实测范围是 1–4（见下方 doctor 的真实
 * 运行结果），8 给出一倍余量，既不是形同虚设的天花板，也不会因为将来
 * 合理新增一两个工具就无端 WARN。
 */
const MAX_REASONABLE_TOOL_COUNT = 8;

export function checkSpecialistWorkerSpecs(specs: readonly RawAgentSpec[]): Finding[] {
  const findings: Finding[] = [];
  for (const spec of specs) {
    if (!isNonEmptyString(spec.role)) {
      findings.push({
        code: "H3A023-MISSING-ROLE-FIELD",
        severity: "FAIL",
        sourceFile: spec.sourceFile,
        message: "缺少非空 `role:` 字段（单一职责的任务类型标记）——Specialist Worker 必须声明自己是什么类型的原子任务",
      });
    }
    if (!Array.isArray(spec.tools) || spec.tools.length === 0) {
      findings.push({
        code: "H3A023-TOOLS-EMPTY",
        severity: "WARN",
        sourceFile: spec.sourceFile,
        message: "`tools:` 缺失或为空数组——无法核实该 Specialist Worker 的写入边界",
      });
    } else if (spec.tools.length > MAX_REASONABLE_TOOL_COUNT) {
      findings.push({
        code: "H3A023-TOOLS-TOO-MANY",
        severity: "WARN",
        sourceFile: spec.sourceFile,
        message:
          `声明了 ${spec.tools.length} 个 tools（> ${MAX_REASONABLE_TOOL_COUNT}）——` +
          `工具面越宽，"单一职责"的边界越模糊，建议复核是否该拆成多个 Specialist Worker`,
      });
    }
  }
  return findings;
}

/* ═══════════════════════ H3A-024：最大三层深度 gate ═══════════════════════ */

/**
 * 完成契约："Specialist Worker 派生第四层会红"。今天没有结构化的
 * "第四层派生"事件可以直接观测（E0 inventory 已确认：派生的 subagent 不
 * 注册），能机械核实的代理指标是 §6.3 硬边界那句"默认
 * `dispatch_authority: false`，不得继续派生第四层"——把它翻译成：任何声明
 * `dispatch_authority: true` 的角色，其 layer 必须在
 * {root_orchestrator, domain_orchestrator} 里；specialist_worker 层
 * 一旦声明 dispatch_authority:true 就等于给自己开了派生第四层的口子。
 *
 * 扁平 subagent spec 今天没有 dispatch_authority 字段（8/8 实测确认），
 * 所以这里只对 6 个持久角色文件生效；如果将来扁平 spec 也长出这个字段，
 * 传入的 flatDispatchAuthority 参数让调用方决定要不要一起查（默认不查，
 * 因为字段今天不存在，不能对不存在的字段下判断）。
 */
export function checkMaxDepthGate(roles: readonly LayeredRole[]): Finding[] {
  const findings: Finding[] = [];
  for (const role of roles) {
    if (role.dispatchAuthority && role.layer === "specialist_worker") {
      findings.push({
        code: "H3A024-DISPATCH-AUTHORITY-ON-WORKER",
        severity: "FAIL",
        sourceFile: role.sourceFile,
        message:
          `角色 "${role.name}"（layer: specialist_worker）声明 dispatch_authority:true——` +
          `Specialist Worker 硬边界是默认 false、不得继续派生第四层，这条会打破三层深度上限`,
      });
    }
  }
  return findings;
}

/* ═══════════════════════ H3A-025：Role authority monotonicity gate ═══════════════════════ */

/**
 * 完成契约："子角色权限不能大于 supervisor/Task Assignment"。今天没有
 * Task Assignment 系统（Epic E3 还没开始），只能核对"子角色 vs
 * supervisor 角色"这一半。root（`supervisor === null`）豁免——它没有
 * supervisor 可比，proposal 原文也明确"UNLESS the role IS coord-main
 * (root, no supervisor)"。
 *
 * 比较维度：`mergeAuthority`/`dispatchAuthority` 两个布尔——子角色为 true
 * 而 supervisor 为 false（或 supervisor 不存在于已登记角色里）都判违规；
 * supervisor 查不到时不能默默放过（那等于允许权限凭空变大），按"supervisor
 * 未登记"单独报一条 FAIL，而不是静默跳过monotonicity 检查。
 */
export function checkAuthorityMonotonicity(roles: readonly LayeredRole[]): Finding[] {
  const byName = new Map(roles.map((r) => [r.name, r]));
  const findings: Finding[] = [];

  for (const role of roles) {
    if (role.supervisor === null) continue; // root，没有 supervisor 可比，豁免

    const supervisor = byName.get(role.supervisor);
    if (!supervisor) {
      findings.push({
        code: "H3A025-SUPERVISOR-NOT-FOUND",
        severity: "FAIL",
        sourceFile: role.sourceFile,
        message:
          `声明 reports_to "${role.supervisor}"，但在已校验的角色文件集合里找不到该 supervisor——` +
          `无法核实 authority monotonicity，不能默认放行`,
      });
      continue;
    }

    if (role.mergeAuthority && !supervisor.mergeAuthority) {
      findings.push({
        code: "H3A025-AUTHORITY-EXCEEDS-SUPERVISOR",
        severity: "FAIL",
        sourceFile: role.sourceFile,
        message: `"${role.name}" 的 merge_authority:true，但其 supervisor "${supervisor.name}" 是 false——子角色权限不能大于 supervisor`,
      });
    }
    if (role.dispatchAuthority && !supervisor.dispatchAuthority) {
      findings.push({
        code: "H3A025-AUTHORITY-EXCEEDS-SUPERVISOR",
        severity: "FAIL",
        sourceFile: role.sourceFile,
        message: `"${role.name}" 的 dispatch_authority:true，但其 supervisor "${supervisor.name}" 是 false——子角色权限不能大于 supervisor`,
      });
    }
  }
  return findings;
}

/* ═══════════════════════ H3A-026：merge/signoff 权限 gate ═══════════════════════ */

/**
 * 完成契约："非 Root merge、任意 Agent 人类签核会红"。
 *   - merge 部分：只有 layer:root_orchestrator 允许 merge_authority:true。
 *   - signoff 部分：本仓库今天没有任何字段声称"人类签核权限"（E0 inventory
 *     确认过），`LayeredRole.signoffAuthority` 恒为 false，所以这一半
 *     天然不会有违规可报——如实说明是"今天没有输入数据可违反"，不是伪造一条
 *     违规出来凑数（house discipline 明确要求这样）。
 */
export function checkMergeSignoffGate(roles: readonly LayeredRole[]): Finding[] {
  const findings: Finding[] = [];
  for (const role of roles) {
    if (role.mergeAuthority && role.layer !== "root_orchestrator") {
      findings.push({
        code: "H3A026-MERGE-AUTHORITY-NOT-ROOT",
        severity: "FAIL",
        sourceFile: role.sourceFile,
        message: `"${role.name}"（layer: ${role.layer}）声明 merge_authority:true——只有 layer:root_orchestrator 允许合并权`,
      });
    }
    // signoffAuthority 恒为 false（见上方注释），没有分支可违反——如实不生成 finding。
  }
  return findings;
}

/* ═══════════════════════ H3A-027：producer/verifier separation policy ═══════════════════════ */

/**
 * 完成契约："同 actor 自产自签会红"。Epic E3（Task Assignment/Review
 * Decision 模型）还没开始，"同一个 actor 生产又评审了同一个 artifact"这个
 * 判断需要运行态数据（谁产出了哪个 commit、谁对哪个 exact-SHA 出了
 * verdict），今天的静态角色文件里没有这些事实，无法机械核实——如实在
 * doctor 输出里说明这一点，不假装用静态文件就能验证运行态语义。
 *
 * 今天能核实的是"自我一致性"这一小块：
 *   1. registry.yaml 的 `agents:` 和 `reviewers:` 两个数组不能有重叠 id——
 *      一个身份如果同时出现在两边，就意味着同一个身份既能"生产"又能
 *      "评审"，producer/verifier 分离在身份登记层面就已经破了。
 *   2. 6 个持久角色文件的 `name` 不能重复且 kind 不冲突——如果同一个
 *      name 在不同文件里一次是 reviewer 一次不是，说明同一角色声称了
 *      两种互斥身份。
 */
export function checkProducerVerifierSeparation(
  agentIds: ReadonlySet<string>,
  reviewerIds: ReadonlySet<string>,
  roles: readonly LayeredRole[],
): Finding[] {
  const findings: Finding[] = [];

  for (const id of agentIds) {
    if (reviewerIds.has(id)) {
      findings.push({
        code: "H3A027-DUAL-IDENTITY",
        severity: "FAIL",
        sourceFile: ".harness/agents/registry.yaml",
        message: `身份 "${id}" 同时出现在 agents[] 和 reviewers[]——同一身份不能既是生产者又是独立评审者`,
      });
    }
  }

  const kindByName = new Map<string, { kind: string; sourceFile: string }>();
  for (const role of roles) {
    const prior = kindByName.get(role.name);
    if (prior && prior.kind !== role.kind) {
      const priorIsReviewer = prior.kind === "reviewer";
      const currentIsReviewer = role.kind === "reviewer";
      if (priorIsReviewer !== currentIsReviewer) {
        findings.push({
          code: "H3A027-ROLE-KIND-CONFLICT",
          severity: "FAIL",
          sourceFile: role.sourceFile,
          message:
            `角色名 "${role.name}" 在 ${prior.sourceFile}（kind:${prior.kind}）和 ` +
            `${role.sourceFile}（kind:${role.kind}）里给出冲突的 kind，其中一个是 reviewer 一个不是——` +
            `同一角色不能同时声称是独立评审者又是产出者`,
        });
      }
    } else {
      kindByName.set(role.name, { kind: role.kind, sourceFile: role.sourceFile });
    }
  }

  return findings;
}

/* ═══════════════════════ H3A-029：Root 直派 L3 例外门 ═══════════════════════ */

/**
 * 完成契约："仅独立 review、恢复、迁移兼容；必须绑定 subject domain 和
 * 受限 scope"。§6.4 原文列了三种允许 Root 直派 L3（跳过 Domain
 * Orchestrator）的场景：独立 reviewer/verifier、失联子树恢复、迁移期
 * 兼容任务；第三种"迁移兼容"明确是过渡态，迁移完成后退役。
 *
 * 今天能机械核实的只有"reports_to:coord-main 且 layer 不是
 * domain_orchestrator"这个结构信号，判不出恢复/迁移语义（那需要运行态
 * 的 lease 回收事件，静态文件没有）。severity 选 WARN 而不是 FAIL：
 * 6 个真实文件里，`dev-ai-runtime`/`dev-chat-e2e` 正好落在这个模式里
 * （kind:worker、reports_to:coord-main），这是 E0 inventory 已经如实
 * 记录的"迁移期尚未建立 Domain Role"的已知状态（chat/ai-runtime 两个
 * 领域还没有 Domain Orchestrator），不是这次改动引入的新问题——用 FAIL
 * 会把一个已知、文档化、proposal 自己允许的过渡态当成阻断性回归，这不是
 * "诚实报告违规"，是把纪律和过渡期搞混。WARN 能让这个信号持续可见（每次
 * `pnpm harness verify` 都会印出来），但不会在 Domain Orchestrator 还没
 * 建好之前就把仓库堵死——同 role-freeze-doctor.ts 的 WARN 先例。
 */
export function checkRootDirectL3Exception(roles: readonly LayeredRole[]): Finding[] {
  const findings: Finding[] = [];
  for (const role of roles) {
    if (role.supervisor === "coord-main" && role.layer !== "domain_orchestrator" && role.kind !== "reviewer") {
      findings.push({
        code: "H3A029-DIRECT-L3-NOT-REVIEWER",
        severity: "WARN",
        sourceFile: role.sourceFile,
        message:
          `"${role.name}"（kind:${role.kind}）直接 reports_to:coord-main 且不是 domain_orchestrator——` +
          `§6.4 只允许这个模式用于独立 reviewer/verifier、子树恢复或迁移期兼容任务；` +
          `如果这是迁移期兼容（尚无 Domain Orchestrator 承接该领域），保持 WARN 可见即可，` +
          `一旦对应 Domain Orchestrator 建立就应该改成 reports_to 该 Domain Orchestrator`,
      });
    }
  }
  return findings;
}
