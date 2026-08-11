/**
 * generated-drift-gate.ts —— PROP-HARNESS-MODEL-001 Epic E2（HMV2-016）：
 * Generated drift gate。
 *
 * P6 原文："所有 generated 文件带来源和 revision，由 drift gate 检查"；
 * §12 templates doctor 检查第 9 条："generated 文件未手改"。
 *
 * 判定策略是 **presence-based**：凡带 HMV2-015 元数据头的文件（不管在哪个
 * 目录）都进入校验——头畸形报 malformed-header，正文哈希对不上报
 * content-drift。没带头的文件不进入本 gate（仓库里绝大多数 .md/.yaml 本来
 * 就是人写的，不是生成物）。
 *
 * 如实标注不覆盖的部分（不是遗漏，同 terminology-doctor 的先例）：
 *   - "该有头而没有"（某目录约定必须全是生成物，却混进了无头文件）需要一份
 *     "哪些目录是生成物目录"的约定——今天仓库里还没有任何 renderer 真实落盘
 *     的目录（HMV2-017 CLI 未建），先做 presence-based 这一半；目录约定留给
 *     017 落盘时一起定，届时在这里加 requiredDirs 参数即可。
 *   - 不校验 sourceRevision 指向的 commit 是否真实存在于 git 历史（同
 *     H3A-015 的取舍：那需要真实 git IO，形状检查已能挡住绝大多数手改）。
 *
 * 纯函数、无 IO；文件读取由调用方（templates-doctor.ts）负责。
 */
import { parseGeneratedHeader, verifyContentHash } from "./generated-metadata";

export interface ScannedFile {
  /** 相对仓库根路径。 */
  path: string;
  content: string;
}

export type DriftFindingKind = "malformed-header" | "content-drift";

export interface DriftFinding {
  code: "HMV2016-MALFORMED-HEADER" | "HMV2016-CONTENT-DRIFT";
  kind: DriftFindingKind;
  path: string;
  message: string;
}

export interface DriftReport {
  /** 进入校验的文件数（= 带头或疑似带头的文件数）。 */
  stampedFilesChecked: number;
  findings: DriftFinding[];
}

export function findGeneratedDrift(files: ScannedFile[]): DriftReport {
  const findings: DriftFinding[] = [];
  let stampedFilesChecked = 0;

  for (const f of files) {
    const { parsed, issues } = parseGeneratedHeader(f.path, f.content);

    if (issues.length > 0) {
      // 有头但残缺/畸形——半个头 = 有人手动动过头部，必须报。
      stampedFilesChecked++;
      for (const issue of issues) {
        findings.push({
          code: "HMV2016-MALFORMED-HEADER",
          kind: "malformed-header",
          path: f.path,
          message: issue.message,
        });
      }
      continue;
    }
    if (parsed === null) continue; // 无头文件：不是生成物，不归本 gate 管。

    stampedFilesChecked++;
    const hash = verifyContentHash(parsed);
    if (!hash.ok) {
      findings.push({
        code: "HMV2016-CONTENT-DRIFT",
        kind: "content-drift",
        path: f.path,
        message:
          `正文与元数据头声明的 content-hash 不符（声明 ${hash.declared}，实测 ${hash.actual}）——` +
          "生成物被手改，或头被伪造。生成物只能由 renderer 重新渲染，不许手编",
      });
    }
  }

  return { stampedFilesChecked, findings };
}
