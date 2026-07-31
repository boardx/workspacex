/**
 * **安全扫描门禁**（F61；`contracts/skills/domain.md` I-3 / I-23、UC-3.1 R3 步骤 3 与 AC2）。
 *
 * 双重门禁：**安全扫描（自动）＋ 方法论审核（人工）**，两道**并列**——
 * usecases.md 逐字「不是『先提交再补扫描』」。
 *
 * D-06 之下扫描对象是**声明式内容本身**（提示词注入模式 / 越权数据范围申请 /
 * 敏感字段外泄倾向 / 引用未授权 MCP），**不是**在沙箱里跑一遍：phase-1 无沙箱。
 *
 * ⚠ 三态里 `risk-pending-confirm` **不是错误**（契约注释逐字）：风险项逐条转审核人，
 *   确认理由留痕。把它当失败会让「有一条中风险」和「扫描判拒」在界面上变成同一件事。
 *
 * ## 本文件回答的唯一问题：**扫描没过时，状态机能不能往前走**
 *
 * 这是 F61 三条反向断言之一（「扫描不过则状态机不许前进」）。它不是
 * `runSecurityScan` 的返回值，而是**别的状态迁移的前置条件**——
 * 只写扫描器、不写这条前置，就会得到一个「扫描结果无人消费」的门禁。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import type { SkillErrorCode } from "./declarative-contract";
import type { SkillLifecycleStatus } from "./skill-status";
import { canTransition } from "./skill-status";

/** 三态从契约派生，**不重写**。 */
export type SecurityScanVerdict = z.infer<typeof skills.SecurityScanVerdict>;
export type RiskItem = z.infer<typeof skills.RiskItem>;

/** 扫描结论 ＋ 逐条风险项。⚠ `risk-pending-confirm` 必须带 findings，否则审核人无从确认。 */
export interface SecurityScanResult {
  readonly verdict: SecurityScanVerdict;
  readonly findings: readonly RiskItem[];
}

/**
 * 人工门禁的结论。`null` ＝ **还没有人审**（不是「审了没过」）。
 * 两者必须可分辨：I-3 要求「任何已启用 skill 都能倒查出两道门禁记录」。
 */
export type MethodologyReview = { readonly approved: boolean } | null;

export interface GateState {
  readonly scan: SecurityScanResult | null;
  readonly methodologyReview: MethodologyReview;
  /** `risk-pending-confirm` 的风险项，审核人**逐条**确认过的 id */
  readonly acknowledgedRiskItemIds: readonly string[];
}

export interface GateVerdict {
  readonly allowed: boolean;
  readonly code: SkillErrorCode | null;
  readonly reason: string | null;
}

/**
 * 扫描是否放行「提交进人工审核」（`草稿 → 待审核`）。
 *
 * · 没扫过        ⇒ 拒（`SECURITY_SCAN_REJECTED`）。⚠ **不是「先提交再补扫描」**
 * · `reject`      ⇒ 拒
 * · `risk-pending-confirm` ⇒ **放行**：风险项转给审核人裁决，那正是它存在的意义
 * · `pass`        ⇒ 放行
 */
export function scanAllowsSubmission(scan: SecurityScanResult | null): GateVerdict {
  if (scan === null) {
    return {
      allowed: false,
      code: "SECURITY_SCAN_REJECTED",
      reason: "尚未跑安全扫描：两道门禁是并列的，不是「先提交再补扫描」（UC-3.1 AC2）",
    };
  }
  if (scan.verdict === "reject") {
    return {
      allowed: false,
      code: "SECURITY_SCAN_REJECTED",
      reason: `安全扫描判拒，风险项 ${scan.findings.length} 条：${scan.findings.map((f) => f.kind).join("、")}`,
    };
  }
  return { allowed: true, code: null, reason: null };
}

/**
 * 两道门禁是否齐全且均通过 —— `待审核 → 已启用` 的前置（I-3）。
 *
 * ⚠ `risk-pending-confirm` 要**逐条确认**才算过：一个「有风险但没人确认过」的版本
 *   与「扫描通过」在数据上必须不同，否则 I-3 的倒查会查出一条看起来通过的记录。
 */
export function gatesAllowEnable(state: GateState): GateVerdict {
  const submission = scanAllowsSubmission(state.scan);
  if (!submission.allowed) {
    return { allowed: false, code: "GATE_NOT_PASSED", reason: submission.reason };
  }

  const scan = state.scan;
  if (scan !== null && scan.verdict === "risk-pending-confirm") {
    const acked = new Set(state.acknowledgedRiskItemIds);
    const unacked = scan.findings.filter((f) => !acked.has(f.riskItemId));
    if (unacked.length > 0) {
      return {
        allowed: false,
        code: "GATE_NOT_PASSED",
        reason: `安全扫描有 ${unacked.length} 条风险项未被审核人逐条确认（确认理由须留痕）`,
      };
    }
  }

  if (state.methodologyReview === null) {
    return {
      allowed: false,
      code: "GATE_NOT_PASSED",
      reason: "方法论审核尚无记录：已启用必须两道门禁记录齐全（I-3）",
    };
  }
  if (!state.methodologyReview.approved) {
    return { allowed: false, code: "GATE_NOT_PASSED", reason: "方法论审核未通过" };
  }

  return { allowed: true, code: null, reason: null };
}

/**
 * **状态机唯一的写入口。**
 *
 * 把「这条边存在吗」（`canTransition`）与「门禁过了吗」（上面两个函数）合成一次判定，
 * 是为了让 F61 的那条反向断言有一个可指的地方：**扫描不过 ⇒ 状态机不许前进**。
 * 若两者分散在调用方，第二个调用方就会只问其中一个。
 *
 * ⚠ 任何试图直接置 `已启用` 的路径（`草稿 → 已启用`）在这里落到
 *   `GATE_NOT_PASSED` 而不是「非法迁移」，因为 I-23 要求这条**写安全审计**——
 *   它是一次绕过尝试，不是一次手滑。
 *
 * ⚠ **`已停用 → 已启用`（`restoreSkill`，F66）是第二个合法产生 `已启用` 的入口**，
 *   且**不重新过门禁**——`status-enum-exactly-four.test.ts` 已经把这条写成规格：
 *   「门禁记录在停用前就已经存在」，恢复恢复的是状态，不是重新审一遍契约正文
 *   （正文本来就没变：I-6 的版本快照不可变，恢复动作根本不碰版本链）。
 *   因此下面把「唯一合法前驱」从「`待审核` 一个」拆成「`待审核`（过门禁）
 *   或 `已停用`（免门禁）」两个，其余来源（如 `草稿`）依旧落 `GATE_NOT_PASSED`。
 */
export function authorizeStatusTransition(input: {
  readonly from: SkillLifecycleStatus;
  readonly to: SkillLifecycleStatus;
  readonly gates: GateState;
}): GateVerdict {
  const { from, to, gates } = input;

  if (to === "已启用" && from !== "待审核" && from !== "已停用") {
    return {
      allowed: false,
      code: "GATE_NOT_PASSED",
      reason:
        "「已启用」只能由人工审核的 approve 分支或 restoreSkill 恢复产生；" +
        "任何其他直达路径都是绕过双重门禁（I-23，须写安全审计）",
    };
  }

  if (!canTransition(from, to)) {
    return {
      allowed: false,
      code: "SKILL_VERSION_CHANGED",
      reason: `不存在 ${from} → ${to} 这条迁移`,
    };
  }

  if (from === "草稿" && to === "待审核") {
    return scanAllowsSubmission(gates.scan);
  }

  // 恢复：已停用 → 已启用，免门禁（见上方函数头注释）。
  if (from === "已停用" && to === "已启用") {
    return { allowed: true, code: null, reason: null };
  }

  if (to === "已启用") {
    return gatesAllowEnable(gates);
  }

  return { allowed: true, code: null, reason: null };
}
