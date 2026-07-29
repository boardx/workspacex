// design-signoff —— ADR-020 的开工门控。
//
// ADR-003 定了「UI 未确认不得进入代码开发」。ADR-020 把签核对象从「UI 一件」
// 扩成「契约束四件套」，并写明 `new-sprint` 的拒绝条件相应扩展：
//   **一个 feature 可以开工，当且仅当：它所属的契约束已签 ∧ 阶段一致性复核已通过。**
//
// ⚠ 这个文件是那句话的可执行形式。在它存在之前，ADR-020 里那条是**只写没做**的——
//   本项目的纪律是「没有脚本的规范条目视为未落地」，那就包括我自己写的 ADR。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findPhaseDir } from "./paths";

export type SignoffStatus = "pending" | "confirmed" | "missing";

/** 只在首个 frontmatter 块内找 status，避免正文里的 "status:" 误命中（同 ui-signoff 的做法） */
function readStatus(path: string): SignoffStatus {
  if (!existsSync(path)) return "missing";
  const body = readFileSync(path, "utf8");
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";
  const m = /^\s*status:\s*(\S+)/m.exec(block);
  return m && m[1] === "confirmed" ? "confirmed" : "pending";
}

export interface BundleSignoff {
  bundle: string;
  status: SignoffStatus;
  /** 该束覆盖的 feature id，从 coverage.md 头部「覆盖 feature：…」抽取 */
  features: string[];
}

/** 读某阶段全部契约束的签核状态。没有 contracts/ 目录 → 空数组（该阶段还没做契约设计） */
export function readBundleSignoffs(phaseId: string): BundleSignoff[] {
  const contractsDir = join(findPhaseDir(phaseId), "contracts");
  if (!existsSync(contractsDir)) return [];
  return readdirSync(contractsDir)
    .filter((n) => statSync(join(contractsDir, n)).isDirectory())
    .map((bundle) => {
      const covPath = join(contractsDir, bundle, "coverage.md");
      // ⚠ 整行抓取再抽 F 编号——头部常写成
      //   「覆盖 feature：F01 F02 F03（uc-0-3）· F15 F16 F17（uc-0-5）」，
      //   只匹配连续 F 编号会在「（」处截断（verify-uc-coverage 第一版就栽过）。
      const line = existsSync(covPath)
        ? /覆盖 feature[：:]([^\n]+)/.exec(readFileSync(covPath, "utf8"))?.[1] ?? ""
        : "";
      return {
        bundle,
        status: readStatus(join(contractsDir, bundle, "design-signoff.md")),
        features: line.match(/F\d+/g) ?? [],
      };
    });
}

export function readCoherenceStatus(phaseId: string): SignoffStatus {
  return readStatus(join(findPhaseDir(phaseId), "design-coherence.md"));
}

/**
 * 开工门控（ADR-020）。要开的 feature 里只要有一个所属束未签，或阶段一致性复核未过，就拒绝。
 *
 * ⚠ 不做契约设计的阶段（没有 contracts/ 目录）**直接放行**——
 *   ADR-020 是 2026-07-28 引入的，此前的阶段不该被追溯拦住。
 *   一旦某阶段建了 contracts/，就说明它选择了这套流程，门控随之生效。
 */
export function assertDesignSignedOff(phaseId: string, featureIds: string[]): void {
  const bundles = readBundleSignoffs(phaseId);
  if (bundles.length === 0) return; // 该阶段未采用契约束流程

  const problems: string[] = [];

  // ① 每个要开的 feature 都得属于某个已签的束
  for (const fid of featureIds) {
    const owner = bundles.find((b) => b.features.includes(fid));
    if (!owner) {
      problems.push(
        `  · ${fid} 不属于任何契约束 —— 无法确认它的设计被评审过。` +
          `请把它写进某个束的 coverage.md 头部「覆盖 feature：…」`,
      );
      continue;
    }
    if (owner.status !== "confirmed") {
      problems.push(
        `  · ${fid} 所属的契约束「${owner.bundle}」尚未签核（status: ${owner.status}）` +
          `→ phases/*/contracts/${owner.bundle}/design-signoff.md`,
      );
    }
  }

  // ② 阶段一致性复核
  const coherence = readCoherenceStatus(phaseId);
  if (coherence !== "confirmed") {
    problems.push(
      `  · 阶段一致性复核尚未通过（status: ${coherence}）→ phases/*/design-coherence.md\n` +
        `    它查的是**跨束的**交叉约束——单束都签了不代表它们之间不打架。`,
    );
  }

  if (problems.length === 0) return;

  throw new Error(
    `设计签核未完成，拒绝开 sprint（ADR-020）：\n${problems.join("\n")}\n\n` +
      `⚠ 签核是**人的动作**：由人类把 design-signoff.md / design-coherence.md 的 status 改为 confirmed，\n` +
      `  填 confirmed_by / confirmed_at。agent 不得代劳。\n` +
      `  为什么设这道门：后端契约会在画界面时被顺手创造出来却无人评审——\n` +
      `  mock 是手写的，它对自己永远自洽，界面跑得通不等于契约成立。`,
  );
}
