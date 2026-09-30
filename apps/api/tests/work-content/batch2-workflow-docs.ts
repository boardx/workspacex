/**
 * 批次 2 Workflow 实体文档（`requirements/work-stack-v2/workflows/W*.md`）的解析助手——测试共用，纯文件系统。
 * 文档是阶段表 / 评测用例的事实源；这里只读，不在测试里另抄一份。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPO = resolve(__dirname, "../../../..");
export const DOC_FILES: Record<string, string> = {
  W003: "W003-decision-to-execution.md",
  W004: "W004-weekly-executive-digest.md",
  W007: "W007-issue-to-resolution.md",
  W052: "W052-request-to-project.md",
  W053: "W053-weekly-pmo-review.md",
  W055: "W055-process-improvement.md",
  W056: "W056-incident-to-postmortem.md",
};

export function readDoc(id: string): string {
  return readFileSync(resolve(REPO, "requirements/work-stack-v2/workflows", DOC_FILES[id]!), "utf8");
}

export interface DocStageRow {
  rowId: string;
  stageId: string;
  skillCell: string;
  capCell: string;
  sideEffect: string;
  gateCell: string;
}

/** §5 阶段表逐行（`| 1 | intake |`、`| 2a | … |`、`| A1 | … |`、`| F1 | … |`）。 */
export function docStageRows(id: string): DocStageRow[] {
  const section = readDoc(id).split(/^## 5\./m)[1]!.split(/^## 6\./m)[0]!;
  const rows: DocStageRow[] = [];
  for (const line of section.split("\n")) {
    const m = /^\| ([AFB]?\d+[a-z]?) \| ([a-z_]+)/.exec(line);
    if (!m) continue;
    const cells = line.split("|").map((c) => c.trim());
    rows.push({
      rowId: m[1]!,
      stageId: m[2]!,
      skillCell: cells[3] ?? "",
      capCell: cells[4] ?? "",
      sideEffect: /^(none|read|write|external_send)/.exec(cells[6] ?? "")?.[1] ?? "",
      gateCell: cells[7] ?? "",
    });
  }
  return rows;
}

/** 门列里的 `**H<n>**`（粗体的 P<n> 是权限重查点，不是门）。 */
export function docGateId(row: DocStageRow): string | null {
  return /\*\*(H\d)\*\*/.exec(row.gateCell)?.[1] ?? null;
}

/**
 * 某阶段行的 Skill pin：Skill 格以 `S<nnn>` 开头才算（括号里提到的其它 Skill 只是输入说明，「—」开头的是平台阶段）。
 * 文档每个阶段至多一个 Skill，所以只取开头这一个。
 */
export function docSkills(row: DocStageRow): string[] {
  const m = /^(S\d{3})\b/.exec(row.skillCell);
  return m ? [m[1]!] : [];
}

/** 能力分类 token（`xxx.yyy` 小写点分）；「同 A1」类引用由调用方解析。 */
export function docCaps(row: DocStageRow): string[] {
  return [...new Set([...row.capCell.matchAll(/\b[a-z]+(?:\.[a-z_]+)+\b/g)].map((m) => m[0]))];
}

/** §14 评测表的用例编号（E1…En）。 */
export function docEvalCaseIds(id: string): string[] {
  const section = readDoc(id).split(/^## 14\./m)[1]!.split(/^## 15\./m)[0]!;
  return [...section.matchAll(/^\| (E\d+) \|/gm)].map((m) => m[1]!);
}

export function docHasG5Line(id: string): boolean {
  const section = readDoc(id).split(/^## 14\./m)[1]!.split(/^## 15\./m)[0]!;
  return /^G5 判据：/m.test(section);
}
