/**
 * **门禁第一道的判定本身**（#552；契约 `runSecurityScan`，UC-3.1 R3 步骤 3）。
 *
 * `security-gate.ts` 回答的是「扫描结果放不放行状态机往前走」；它**消费** `SecurityScanResult`
 * 却从来没有生产者——`GateState.scan` 在全仓恒为 `null`，而 `null` 的语义是「还没扫过」，
 * 于是 `gatesAllowEnable` 对每一个调用方都返回 `GATE_NOT_PASSED`。本文件是那个缺失的生产者。
 *
 * ## 扫的是**声明式内容本身**，不是跑一遍
 *
 * D-06 已裁 phase-1 无沙箱、不执行任意代码，所以这里没有、也不会有「装载」「执行」的概念。
 * 契约逐字列了四类扫描对象，本文件一一对应 `RiskItem.kind` 的四个取值：
 *
 *   · `prompt-injection`   提示词注入模式——模板里试图改写系统指令 / 越过前置约束的措辞
 *   · `scope-elevation`    越权数据范围申请——声明了范围，却没有任何范围是它有权申请的
 *   · `data-exfiltration`  敏感字段外泄倾向——把原始转写、密钥一类的东西往外送
 *   · `unauthorized-mcp`   引用未授权 MCP 工具
 *
 * ## ⚠ 判据是**模式匹配**，而且它是这么写下来的规格，不是一个占位实现
 *
 * 同 `declarative-contract.ts` 里 `parseSchema` 那条既定处置：「能跑的最弱判据配一条会红的
 * 测试，好过一个装了依赖却没人看结论的重型校验」。把它做成一个恒返回 `pass` 的桩才是缺口——
 * 那样双重门禁在数据上永远看不出第一道有没有生效。
 *
 * ## ⚠ 三档结论的分工，特别是中间那一档
 *
 * `risk-pending-confirm` **不是错误**（契约注释逐字）：它的 findings 逐条转交审核人，
 * 由 `gatesAllowEnable` 要求逐条 ack 才放行。把中风险直接判 `reject` 会让「有一条待确认」
 * 与「扫描判拒」在界面上变成同一件事，而后者是不可救的、前者是审核人的正常工作。
 */
import type { DeclarativeContract, SkillErrorCode } from "./declarative-contract";
import type { RiskItem, SecurityScanResult } from "./security-gate";

/**
 * 一条模式。`severity` 决定它把结论推到哪一档：
 *
 *   · `reject`  —— 结构上不可能通过人工确认化解的（提示词注入、密钥外泄）。
 *   · `confirm` —— 可能是正当需求，需要审核人**逐条**确认理由（读原始转写、引用 MCP）。
 *
 * ⚠ 两档写在模式表里而不是散在判定函数里：新增一条模式时，"它算哪一档" 是**必须回答**的
 *   问题，而不是一个可以默认掉的问题。
 */
interface ScanPattern {
  readonly id: string;
  readonly kind: RiskItem["kind"];
  readonly severity: "reject" | "confirm";
  readonly pattern: RegExp;
  readonly detail: string;
}

/**
 * 提示词注入：模板里出现「忽略前面的指令」「你现在是……」这类**改写系统约束**的措辞。
 *
 * ⚠ 中英文都要有。本仓的提示词模板是中文为主、英文片段混排的，只匹配一侧等于对另一侧
 *   完全失明——而攻击者用哪一侧不由我们决定。
 */
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /忽略(上面|以上|前面|之前)(的)?(所有)?(指令|要求|规则|限制)/,
  /ignore\s+(all\s+)?(the\s+)?(previous|above|prior)\s+(instructions?|rules?|constraints?)/i,
  /(disregard|override)\s+(the\s+)?(system|safety)\s+(prompt|instructions?|rules?)/i,
  /你(现在)?(不再是|不是).{0,12}(而是|你是)/,
  /(忽略|绕过|跳过)(安全|权限|门禁|审核)(检查|校验|限制)?/,
];

/** 敏感字段外泄：把内容往一个**外部落点**送。判据是「送出去」，不是「提到过」。 */
const EXFILTRATION_PATTERNS: readonly RegExp[] = [
  /(发送|上传|推送|转发|外发)(到|至|给)?\s*(https?:\/\/|外部|第三方)/,
  /(send|post|upload|exfiltrate)\s+.{0,40}\s*(to\s+)?https?:\/\//i,
  /(api[_\s-]?key|secret|token|password|凭据|密钥)\s*[:=]/i,
];

/** 引用 MCP 工具。**引用本身不是错**——本域无从判断它有没有被授权，所以一律转审核人。 */
const MCP_REFERENCE_PATTERNS: readonly RegExp[] = [
  /\bmcp:\/\/[\w.-]+/i,
  /\bmcp\s*(工具|tool)\s*[:：]/i,
  /@mcp\/[\w.-]+/i,
];

function patternsOf(): readonly ScanPattern[] {
  const out: ScanPattern[] = [];
  PROMPT_INJECTION_PATTERNS.forEach((pattern, i) =>
    out.push({
      id: `prompt-injection-${i + 1}`,
      kind: "prompt-injection",
      severity: "reject",
      pattern,
      detail: "提示词模板中出现改写/绕过系统约束的措辞，属提示词注入模式",
    }),
  );
  EXFILTRATION_PATTERNS.forEach((pattern, i) =>
    out.push({
      id: `data-exfiltration-${i + 1}`,
      kind: "data-exfiltration",
      severity: "reject",
      pattern,
      detail: "声明中出现把内容送往外部落点或明文凭据的倾向",
    }),
  );
  MCP_REFERENCE_PATTERNS.forEach((pattern, i) =>
    out.push({
      id: `unauthorized-mcp-${i + 1}`,
      kind: "unauthorized-mcp",
      severity: "confirm",
      pattern,
      detail: "引用了 MCP 工具：本域无从判断该工具是否已授权，转审核人逐条确认",
    }),
  );
  return out;
}

/** 扫描面：声明里**所有自由文本**。⚠ 少扫一个字段，那个字段就是绕过通道。 */
function scannedText(contract: DeclarativeContract): readonly { field: string; text: string }[] {
  return [
    { field: "promptTemplate", text: contract.promptTemplate },
    { field: "inputSchema", text: contract.inputSchema },
    { field: "outputSchema", text: contract.outputSchema },
    { field: "fallbackDeclaration", text: contract.fallbackDeclaration },
    { field: "dataScope", text: contract.dataScope.join(" ") },
  ];
}

export interface ScanDeclarativeContractInput {
  readonly contract: DeclarativeContract;
  /**
   * 提交人**当时**持有的数据范围（I-12 的上界，来自 `SubmitterGrantsPort`）。
   *
   * ⚠ 它是入参而不是在这里现取：本文件是 domain 层，纯函数，不做 IO。
   *   `create-skill-draft` 已经用同一份事实判过一次越权；这里再判一次**不是重复**——
   *   那一次判的是「能不能建」，这一次判的是「这份声明现在还在不在上界内」，
   *   而 E6 要求权限被撤回时后续动作立即停下。同一份事实，两个时刻。
   */
  readonly submitterGrants: readonly string[];
}

/**
 * 跑一次声明式安全扫描。**纯函数**：没有时钟、没有 IO、没有随机数。
 *
 * `riskItemId` 由 `versionId` ＋ 模式 id ＋ 字段名拼成，**不是 uuid**：
 * `gatesAllowEnable` 要求审核人逐条 ack 这些 id，而一个每次扫描都变的 id 会让
 * 「上次确认过的那一条」在重扫之后变成一条从未被确认过的新风险——审核人于是永远 ack 不完。
 */
export function scanDeclarativeContract(
  versionId: string,
  input: ScanDeclarativeContractInput,
): SecurityScanResult {
  const findings: RiskItem[] = [];
  let hasRejectFinding = false;

  for (const { field, text } of scannedText(input.contract)) {
    if (text.trim() === "") continue;
    for (const p of patternsOf()) {
      if (!p.pattern.test(text)) continue;
      if (p.severity === "reject") hasRejectFinding = true;
      findings.push({
        riskItemId: `${versionId}:${p.id}:${field}`,
        kind: p.kind,
        detail: `${p.detail}（字段 ${field}）`,
      });
    }
  }

  // 越权数据范围申请：与上面的文本模式无关，判据是集合包含关系。
  const granted = new Set(input.submitterGrants);
  for (const scope of input.contract.dataScope) {
    if (granted.has(scope)) continue;
    hasRejectFinding = true;
    findings.push({
      riskItemId: `${versionId}:scope-elevation:${scope}`,
      kind: "scope-elevation",
      detail: `声明的数据范围 \`${scope}\` 超出提交人当前持有的范围（I-12 的上界）`,
    });
  }

  // 读原始转写：**可能正当**，所以是「待确认」而不是判拒——授权与否不在本域。
  if (input.contract.readsRawTranscript) {
    findings.push({
      riskItemId: `${versionId}:raw-transcript:readsRawTranscript`,
      kind: "data-exfiltration",
      detail: "声明读取原始转写：需审核人确认该用途已获单独授权（UC-3.1 R3）",
    });
  }

  if (findings.length === 0) return { verdict: "pass", findings: [] };
  return {
    verdict: hasRejectFinding ? "reject" : "risk-pending-confirm",
    findings,
  };
}

/**
 * 扫描判拒时的错误码。契约 `runSecurityScan.err` 只有两个取值，判拒是其中之一。
 *
 * ⚠ 判拒**仍然落库**：一次「扫过并被拒」与「从未扫过」在数据上必须可分辨，
 *   否则 I-3 的倒查会把两者都读成 `null`。所以它是一个错误码，不是一个「不写记录」的分支。
 */
export const SECURITY_SCAN_REJECTED: SkillErrorCode = "SECURITY_SCAN_REJECTED";
