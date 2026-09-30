/**
 * 同一事实不得声明在两处 —— 批次 2 工作流的中文显示名 / 阶段名是派生副本，这里逐条核对单一事实源：
 *   · 工作流中文名 ⇐ requirements/work-stack-v2/workflows/W*.md 标题括号内名字
 *   · 工作流 key / 稳定编号 ⇐ API `definitions/{shared,operations}/w*.ts`
 *   · 阶段名 ⇐ 同一批 Definition 的 stage(...) 阶段 id；带门的阶段（gate(...) 的 stageId）名字必须带「（审批）」
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBuiltinWorkflow, gateDisplayTitle, stageDisplayName } from "@/lib/workflow-display-copy";

const ROOT = join(__dirname, "../../..");
const DEFS = join(ROOT, "apps/api/src/domain/work-content/definitions");
const DOCS = join(ROOT, "requirements/work-stack-v2/workflows");

interface ParsedDef { workflowId: string; key: string; stageIds: string[]; gates: { gateId: string; stageId: string }[] }

function parsedDefinitions(): ParsedDef[] {
  const out: ParsedDef[] = [];
  for (const dir of ["shared", "operations"]) {
    for (const f of readdirSync(join(DEFS, dir)).filter((n) => /^w\d{3}\.ts$/.test(n))) {
      const text = readFileSync(join(DEFS, dir, f), "utf8");
      out.push({
        workflowId: /workflowId:\s*"(W\d{3})"/.exec(text)![1]!,
        key: /key:\s*"([a-z-]+)"/.exec(text)![1]!,
        stageIds: [...text.matchAll(/stage\("([a-z_]+)"/g)].map((m) => m[1]!),
        gates: [...text.matchAll(/gate\("(H\d)",\s*"([a-z_]+)"/g)].map((m) => ({ gateId: m[1]!, stageId: m[2]! })),
      });
    }
  }
  return out;
}

describe("批次 2 显示名 = 单一事实源", () => {
  const defs = parsedDefinitions();

  it("七个 Definition 都被解析到", () => {
    expect(defs.map((d) => d.workflowId).sort()).toEqual(["W003", "W004", "W007", "W052", "W053", "W055", "W056"]);
  });

  it("工作流中文名与实体文档标题括号内名字逐条相等，key / 编号与 Definition 一致", () => {
    for (const d of defs) {
      const file = readdirSync(DOCS).find((n) => n.startsWith(`${d.workflowId}-`))!;
      const head = readFileSync(join(DOCS, file), "utf8").split("\n")[0]!;
      const zh = /^# W\d{3} — .*?（([^）]+)）/.exec(head)?.[1];
      expect(zh, `${file} 标题缺中文名`).toBeTruthy();
      const hit = findBuiltinWorkflow(d.key);
      expect(hit?.workflowId).toBe(d.workflowId);
      expect(hit?.name).toBe(zh);
    }
  });

  it("每个阶段 id 都有中文阶段名（不落到「步骤 N」兜底）；带门阶段名带「（审批）」且门标题不落「审批事项」", () => {
    for (const d of defs) {
      for (const id of d.stageIds) expect(stageDisplayName(id, id, 0), `${d.workflowId}/${id}`).not.toMatch(/^步骤 \d+$/);
      expect(d.gates.length, d.workflowId).toBeGreaterThan(0);
      for (const g of d.gates) {
        const title = gateDisplayTitle({ stageId: g.stageId, summary: g.stageId }, d.key);
        // `decide`（W003 H1/W055 H4）沿用已有的通用名「做出决策」；其余门阶段必须带「（审批）」。
        if (g.stageId !== "decide") expect(title.stage, `${d.workflowId}/${g.gateId}/${g.stageId}`).toMatch(/（审批）$/);
        expect(title.stage).not.toBe("审批事项");
        expect(title.workflow).not.toBeNull();
      }
    }
  });
});
