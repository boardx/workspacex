/**
 * startup-discovery.ts —— #401：开工流程第 2 步「找到唯一 in_progress 的 feature」
 * 必须在**干净 clone** 上可复现。
 *
 * ## 缺陷现场
 * `.gitignore` 里的 `**` 通配规则忽略了全部 `active-features.json`（正确：它是脚本派生的只读
 * 投影，H3A-009 合同禁止它被 Git 追踪，pre-commit hook 也挡手改），而 AGENTS.md
 * 「开工流程」第 2 步逐字让 agent「读当前 sprint 的 active-features.json」。
 * 两条规则都在仓库里、都被当成权威 —— 于是新 clone 上那个文件根本不存在，
 * 第 2 步对**第一次进来的 agent** 直接断掉：派生态发现不可复现。
 *
 * ## 收敛方向（本文件门控的那件事）
 * 不把投影入库（那会造出第二份事实源，正是 H3A-009 要挡的），而是：
 *   ① 投影可被**机械重建**：`pnpm harness active-features` 从权威
 *      `feature_list.json` 重生成，且输出**确定性**——同一份权威 ⇒ 同样的字节。
 *   ② 凡指示 agent「读」这个投影的指令文件，必须在同一行/同一文件里点名那条
 *      重建命令，否则干净 clone 上照做就是断的。
 *
 * 纯函数、无 IO：真实文件读取与 git 查询在 `active-features.ts` /
 * `lint-startup-discovery.test.ts`。
 */
import type { Feature } from "./types";

/** 派生视图的文件名。指令文档、.gitignore、H3A-009 投影清单说的都是这一个文件。 */
export const ACTIVE_FEATURES_BASENAME = "active-features.json";

/** 重建这份投影的唯一命令。指令文档里出现的命令字面量必须与它一致。 */
export const ACTIVE_FEATURES_REGEN_CMD = "pnpm harness active-features";

export interface ActiveFeaturesView {
  phase: string;
  sprint: string;
  source: string;
  note: string;
  features: Feature[];
}

/**
 * 从权威清单派生出 sprint 工作集视图。
 *
 * ⚠ **确定性**：这里刻意不写 `generated_at: new Date()`。
 * 带挂钟的投影每跑一次就换一次字节，既没法和权威源做逐字等价比对，也让
 * 「这份投影是不是最新的」只能靠人读时间戳猜。#401 验收第二条要求的正是：
 * 同一份 feature_list.json ⇒ 同样的投影字节。想知道新不新，重跑一次命令即可。
 */
export function buildActiveFeaturesView(
  phaseId: string,
  sprintId: string,
  sprintFeatures: readonly Feature[],
): ActiveFeaturesView {
  return {
    phase: phaseId,
    sprint: sprintId,
    source: `phases/phase-${phaseId}-*/feature_list.json`,
    note:
      `派生视图,只读,不入库。重建:${ACTIVE_FEATURES_REGEN_CMD}。` +
      `修改归属请改阶段 feature_list.json 的 sprint 字段后重新生成。`,
    features: [...sprintFeatures],
  };
}

export function renderActiveFeaturesView(view: ActiveFeaturesView): string {
  return JSON.stringify(view, null, 2) + "\n";
}

/** 权威清单里全部 in_progress 的 feature，按 id 排序（结果稳定，便于逐字比对）。 */
export function inProgressFeatures(features: readonly Feature[]): Feature[] {
  return features.filter((f) => f.status === "in_progress").sort((a, b) => a.id.localeCompare(b.id));
}

export interface StartupDoc {
  /** 相对仓库根的路径，只用于报错定位。 */
  path: string;
  text: string;
}

export interface StartupDocFinding {
  code: "STARTUP-PROJECTION-UNREACHABLE";
  severity: "FAIL";
  path: string;
  line: number;
  message: string;
}

/**
 * 判「读投影」的标记。取"读/查看"与 shell 里的 `cat `——本仓指令文档要么是中文
 * 祈使句，要么是可复制的命令块，两类都在这里。
 *
 * ⚠ 先剔掉「只读」再找「读」：本仓每张纪律表都写着「它是脚本派生的**只读**视图，
 * 禁止手改」，那是**禁止写**的告诫，不是叫人去读。不剔掉的话这条门会对着一堆
 * 与开工无关的句子发红，红得没道理的门迟早被当噪声绕过。
 */
const WRITE_ONLY_NOISE = /只读/g;
const READ_MARKERS = ["读", "查看", "cat "] as const;

function mentionsRegenCommand(text: string): boolean {
  return text.includes(ACTIVE_FEATURES_REGEN_CMD);
}

/**
 * 指令文档审计：任何**指示读取**派生投影的文件，必须自己点名重建命令。
 *
 * 判定放在文件级而不是行级：文档常把「跑命令」和「读结果」分成上下两行写，
 * 逐行要求会逼出复读机式的重复。但**报错**指到具体那一行，方便改。
 */
export function auditStartupDocs(docs: readonly StartupDoc[]): StartupDocFinding[] {
  const findings: StartupDocFinding[] = [];
  for (const doc of docs) {
    if (mentionsRegenCommand(doc.text)) continue;
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.includes(ACTIVE_FEATURES_BASENAME)) continue;
      const probe = line.replace(WRITE_ONLY_NOISE, "");
      if (!READ_MARKERS.some((m) => probe.includes(m))) continue;
      findings.push({
        code: "STARTUP-PROJECTION-UNREACHABLE",
        severity: "FAIL",
        path: doc.path,
        line: i + 1,
        message:
          `${doc.path}:${i + 1} 指示读取 ${ACTIVE_FEATURES_BASENAME}，但全文没有点名重建命令 ` +
          `\`${ACTIVE_FEATURES_REGEN_CMD}\`——该文件被 .gitignore 忽略（H3A-009 投影不入库），` +
          `干净 clone 上照这句做会读到一个不存在的文件`,
      });
      break; // 一个文件报一处即可，改法是同一个
    }
  }
  return findings;
}
