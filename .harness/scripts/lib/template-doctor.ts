/**
 * template-doctor.ts —— HMV2-010/011/012：实例唯一性 + 生命周期 + 引用完整性。
 *
 * Proposal §12 列了 14 条 `templates doctor` 检查，E1 只实现其中真正**现在就有数据
 * 可验**的那几条（唯一性、生命周期、引用存在性、死链、版本受支持）。其余（renderer
 * 是否存在、生成文件是否被手改、签核 hash 是否漂移……）要等 E2/E5 把对应机制建出来
 * 才有东西可查——本文件的报告会**显式列出哪些检查号在 E1 阶段不适用**，不是悄悄
 * 只做六条却让报告看起来像"doctor 全过了"。这正是 Proposal 自己 G6/P7 那条
 * "仪器失败时不说谎"，用在文档本身完成度上。
 */
import type { InstanceMetadata, TemplateRegistry, TemplateRegistryEntry } from "./template-model";

export type FindingSeverity = "FAIL" | "WARN";

export interface Finding {
  /** 稳定机器码，为 HMV2-062（统一 finding ID）预留形状，即便本 Epic 还没做全仓统一。 */
  code: string;
  severity: FindingSeverity;
  message: string;
  sourceFile?: string;
}

export interface DoctorReport {
  status: "PASS" | "FAIL" | "UNKNOWN";
  findings: Finding[];
  /** 本次实际检查了多少份实例——0 不是失败，是"还没人开始用这套元数据"的诚实状态。 */
  instancesChecked: number;
  /** Proposal §12 里编号但 E1 尚未实现的检查项，如实报出，不假装齐全。 */
  notYetImplemented: string[];
}

const NOT_YET_IMPLEMENTED = [
  "#7 renderer 存在（需要 E2）",
  "#8 消费者存在（需要消费者自身可被发现的机制，E2+）",
  // #9 generated 文件未手改：已由 HMV2-016 实现（generated-drift-gate.ts，
  // templates-doctor.ts 入口对全部 git 跟踪的 .md/.yaml/.yml 运行），从本清单移除。
  "#10 signoff hash 未漂移（需要 E5）",
  "#13 数据源失败不会渲染为零（本文件已遵守此原则，但作为「仓库级」检查需要看板集成，E6）",
  "#14 allowlist 只能相对 merge-base 缩短（本 Epic 没有 allowlist，等真正开始迁移才有意义，E9）",
];

function registryByTemplateId(registry: TemplateRegistry): Map<string, TemplateRegistryEntry> {
  return new Map(registry.entries.map((e) => [e.template_id, e]));
}

/** HMV2-010：instance_id 全仓唯一。 */
export function duplicateInstanceIds(instances: readonly InstanceMetadata[]): Finding[] {
  const seen = new Map<string, InstanceMetadata>();
  const findings: Finding[] = [];
  for (const inst of instances) {
    const prior = seen.get(inst.instance_id);
    if (prior) {
      findings.push({
        code: "TPL-DUP-INSTANCE",
        severity: "FAIL",
        message: `instance_id "${inst.instance_id}" 重复：${prior.sourceFile} 与 ${inst.sourceFile}`,
        sourceFile: inst.sourceFile,
      });
    } else {
      seen.set(inst.instance_id, inst);
    }
  }
  return findings;
}

/**
 * HMV2-012：每个实例引用的 template_id 必须在注册表里存在；
 * template_version 不得超过注册表当前登记的版本（"版本受支持"）。
 */
export function unregisteredOrUnsupportedTemplateReferences(
  instances: readonly InstanceMetadata[],
  registry: TemplateRegistry,
): Finding[] {
  const byId = registryByTemplateId(registry);
  const findings: Finding[] = [];
  for (const inst of instances) {
    const entry = byId.get(inst.template_id);
    if (!entry) {
      findings.push({
        code: "TPL-REF-UNREGISTERED",
        severity: "FAIL",
        message: `${inst.sourceFile} 引用了未注册的 template_id "${inst.template_id}"`,
        sourceFile: inst.sourceFile,
      });
      continue;
    }
    if (inst.template_version > entry.template_version) {
      findings.push({
        code: "TPL-REF-VERSION-UNSUPPORTED",
        severity: "FAIL",
        message:
          `${inst.sourceFile} 引用 ${inst.template_id} 的 template_version=${inst.template_version}，` +
          `但注册表当前只登记到 ${entry.template_version}——版本不受支持`,
        sourceFile: inst.sourceFile,
      });
    }
  }
  return findings;
}

/**
 * HMV2-011：retired 模板不得有新实例。
 *
 * "新" 的判定：本函数不看 git 历史（那需要调用方传时间线，E1 暂不做），只做
 * **当前树上**的一致性检查——任何引用 retired 模板、且状态不是 `retired` 的实例
 * 都会被标：意味着"这份实例还活着，但它所属的模板类型已经死了，这本身就是矛盾
 * 状态"，不管它是不是历史遗留。真正的"允许历史遗留、只拦新增"由调用方在 CI 里
 * 用 `git diff --name-only merge-base` 只对新增/修改的文件跑本检查来实现
 * （与 rewrite-coverage.ts 的 allowlist 棘轮同一思路：本函数给出"当前树的真相"，
 * "历史 vs 新增"的时间维度由外层决定）。
 */
export function retiredTemplateViolations(
  instances: readonly InstanceMetadata[],
  registry: TemplateRegistry,
): Finding[] {
  const byId = registryByTemplateId(registry);
  const findings: Finding[] = [];
  for (const inst of instances) {
    const entry = byId.get(inst.template_id);
    if (entry && entry.status === "retired" && inst.status !== "retired") {
      findings.push({
        code: "TPL-RETIRED-TEMPLATE-LIVE-INSTANCE",
        severity: "FAIL",
        message:
          `${inst.sourceFile} 引用的 ${inst.template_id} 已 retired，但该实例 status="${inst.status}"` +
          `（应同步标为 retired，或说明为什么这是允许的历史遗留）`,
        sourceFile: inst.sourceFile,
      });
    }
  }
  return findings;
}

/** doctor 检查项 #11：refs[] 指向的 instance_id 必须真实存在（无死链）。 */
export function deadReferences(instances: readonly InstanceMetadata[]): Finding[] {
  const known = new Set(instances.map((i) => i.instance_id));
  const findings: Finding[] = [];
  for (const inst of instances) {
    for (const ref of inst.refs) {
      if (!known.has(ref)) {
        findings.push({
          code: "TPL-DEAD-REF",
          severity: "FAIL",
          message: `${inst.sourceFile} 的 refs 引用了不存在的 instance_id "${ref}"`,
          sourceFile: inst.sourceFile,
        });
      }
    }
  }
  return findings;
}

export interface DoctorInput {
  registry: TemplateRegistry | null;
  registryParseError: string | null;
  instances: readonly InstanceMetadata[];
  /** 逐份实例的 schema 校验失败信息（来自 validateInstanceMetadata），本函数不重复校验。 */
  instanceValidationFailures: readonly { sourceFile: string; message: string }[];
}

/**
 * 汇总判定。**注册表读不到就是 UNKNOWN，不是"没有缺口"**——这条对应 G6/P7：
 * 权威数据源不可读时必须输出 UNKNOWN，不得渲染成通过。今天 #574 的
 * `analyzeRewriteCoverage` 已经证明过这条判断力的价值，这里复用同一原则。
 */
export function runTemplateDoctor(input: DoctorInput): DoctorReport {
  if (input.registryParseError || !input.registry) {
    return {
      status: "UNKNOWN",
      findings: [
        {
          code: "TPL-REGISTRY-UNREADABLE",
          severity: "FAIL",
          message: input.registryParseError ?? "registry.yaml 解析结果为空",
        },
      ],
      instancesChecked: 0,
      notYetImplemented: NOT_YET_IMPLEMENTED,
    };
  }

  const findings: Finding[] = [];
  for (const f of input.instanceValidationFailures) {
    findings.push({ code: "TPL-INSTANCE-SCHEMA-INVALID", severity: "FAIL", message: f.message, sourceFile: f.sourceFile });
  }
  findings.push(...duplicateInstanceIds(input.instances));
  findings.push(...unregisteredOrUnsupportedTemplateReferences(input.instances, input.registry));
  findings.push(...retiredTemplateViolations(input.instances, input.registry));
  findings.push(...deadReferences(input.instances));

  const hasFail = findings.some((f) => f.severity === "FAIL");
  return {
    status: hasFail ? "FAIL" : "PASS",
    findings,
    instancesChecked: input.instances.length,
    notYetImplemented: NOT_YET_IMPLEMENTED,
  };
}
