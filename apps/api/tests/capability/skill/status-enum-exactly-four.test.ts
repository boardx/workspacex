/**
 * F61 · 四态状态机（`contracts/skills/domain.md` I-1 / 裁决 O-11）+ 安全扫描自动门禁。
 *
 * I-1 自带断言方式，逐字：
 *   「断言枚举成员集合与契约一致 **且未声明的值不能通过**
 *    （⚠ 不写 `toHaveLength(4)`，见 coding-standards 修订 E-4）；
 *    全仓 grep `已发布` 在 skill 域为 0 命中」
 *
 * ⇒ 本文件三组断言：**集合相等** / **第五个进不来** / **`已发布` 零命中**，
 *   外加 D08 的钉子与「扫描不过状态机不许前进」那条反向断言。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  D08_UNRESOLVED,
  FORBIDDEN_STATUS_LITERALS,
  SKILL_STATUSES,
  allowedNextStatuses,
  canArchive,
  canTransition,
  isSkillStatus,
  rejectedToDraftLosesDistinction,
} from "../../../src/domain/skill/skill-status";
import { advanceSkillStatus } from "../../../src/application/skill/advance-skill-status";
import type { GateState } from "../../../src/domain/skill/security-gate";
import { collectAudit } from "../../support/skill-fakes";

const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));
const SKILL_DOMAIN = fileURLToPath(new URL("../../../src/domain/skill", import.meta.url));
const SKILL_APP = fileURLToPath(new URL("../../../src/application/skill", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

/** 去掉注释：规则的**解释**里必然出现被禁的词，把它算成命中会让门控点红自己。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("Skill.status 恰为四态（I-1 / O-11）", () => {
  it("集合相等：既不多一个，也不少一个", () => {
    // 集合比较，而不是长度比较。`toHaveLength(4)` 在
    // {草稿, 待审核, 已启用, 已发布} 上同样是绿的。
    expect(new Set(SKILL_STATUSES)).toEqual(new Set(["草稿", "待审核", "已启用", "已停用"]));
  });

  it("未声明的值进不来（判据的另一半）", () => {
    for (const rejected of ["已发布", "被退回", "已归档", "draft", ""]) {
      expect(isSkillStatus(rejected), `${rejected} 不该被接受为状态`).toBe(false);
    }
    for (const accepted of SKILL_STATUSES) expect(isSkillStatus(accepted)).toBe(true);
  });

  it("`已归档` 不是第五态，而是「已停用」的子类", () => {
    expect(canArchive("已停用")).toBe(true);
    for (const s of ["草稿", "待审核", "已启用"] as const) expect(canArchive(s)).toBe(false);
  });

  it("`已发布` 在 skill 域源码里零命中（注释与「禁令自身的声明」除外）", () => {
    const files = [...walk(SKILL_DOMAIN), ...walk(SKILL_APP)];
    expect(files.length, "扫到 0 个文件——这条断言会空转").toBeGreaterThan(4);

    // 唯一豁免：`FORBIDDEN_STATUS_LITERALS` 那一行。**声明一条禁令不是违反它**——
    // 同 lint-no-builtin-capabilities 对注释的豁免，理由一样：让规则自己点红自己，
    // 结果是把规则删掉。豁免范围写死成「含该常量名的行」，并在下一条断言里数它有几行。
    const isBanDeclaration = (line: string) => line.includes("FORBIDDEN_STATUS_LITERALS");

    const offenders: string[] = [];
    let exemptLines = 0;
    for (const f of files) {
      const lines = stripComments(readFileSync(f, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const lit of FORBIDDEN_STATUS_LITERALS) {
          if (!line.includes(lit)) continue;
          if (isBanDeclaration(line)) {
            exemptLines += 1;
            continue;
          }
          offenders.push(`${f}:${i + 1} 含 ${lit}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // 豁免恰一行：多出来的每一行都是一次「把禁词塞进常量名旁边」的机会。
    expect(exemptLines, "禁令声明不止一行——豁免正在被当成后门用").toBe(1);
  });
});

describe("状态机：没写在表里的迁移就是不允许的迁移", () => {
  it("`草稿 → 已启用` 这条直达边不存在", () => {
    // 契约的 SKILLS_FORBIDDEN_ROUTES：「一条直达的启用路由就是那条绕过路径本身」。
    expect(canTransition("草稿", "已启用")).toBe(false);
    expect(allowedNextStatuses("草稿")).toEqual(["待审核"]);
  });

  it("`已启用` 的唯一前驱是 `待审核`", () => {
    const predecessors = SKILL_STATUSES.filter((s) => canTransition(s, "已启用"));
    expect(new Set(predecessors)).toEqual(new Set(["待审核", "已停用"]));
    // `已停用 → 已启用` 是 restoreSkill（恢复），不是首次启用：它不经门禁，
    // 因为门禁记录在停用前就已经存在。首次启用的唯一前驱仍是 `待审核`。
    expect(canTransition("草稿", "已启用")).toBe(false);
  });

  it("四态的已知代价被写成事实，而不是被忽略（D08 争点）", () => {
    const { to, lostDistinction } = rejectedToDraftLosesDistinction();
    expect(to).toBe("草稿");
    expect(lostDistinction).toContain("不可区分");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 反向断言之三：**扫描不过则状态机不许前进**
 * ──────────────────────────────────────────────────────────────────────── */

const CLEAN_SCAN: GateState = {
  scan: { verdict: "pass", findings: [] },
  methodologyReview: { approved: true },
  acknowledgedRiskItemIds: [],
};

describe("安全扫描是自动门禁：不过就不许前进", () => {
  it("没跑过扫描 ⇒ `草稿 → 待审核` 被拒，状态原地不动", async () => {
    const audit = collectAudit();
    const r = await advanceSkillStatus(
      {
        skillId: "s1",
        principalId: "u1",
        from: "草稿",
        to: "待审核",
        gates: { ...CLEAN_SCAN, scan: null },
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SECURITY_SCAN_REJECTED");
    expect(r.status, "被拒时状态必须原地不动").toBe("草稿");
    expect(r.reason).toContain("并列");
  });

  it("扫描判 reject ⇒ 被拒，理由带上风险项类别", async () => {
    const audit = collectAudit();
    const r = await advanceSkillStatus(
      {
        skillId: "s1",
        principalId: "u1",
        from: "草稿",
        to: "待审核",
        gates: {
          ...CLEAN_SCAN,
          scan: {
            verdict: "reject",
            findings: [{ riskItemId: "r1", kind: "prompt-injection", detail: "模板里有越狱片段" }],
          },
        },
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SECURITY_SCAN_REJECTED");
    expect(r.reason).toContain("prompt-injection");
  });

  it("`risk-pending-confirm` 不是错误：可以进人工审核", async () => {
    const audit = collectAudit();
    const r = await advanceSkillStatus(
      {
        skillId: "s1",
        principalId: "u1",
        from: "草稿",
        to: "待审核",
        gates: {
          ...CLEAN_SCAN,
          scan: {
            verdict: "risk-pending-confirm",
            findings: [{ riskItemId: "r1", kind: "scope-elevation", detail: "申请了较宽的范围" }],
          },
        },
      },
      { audit },
    );
    // 把它当失败会让「有一条中风险」与「扫描判拒」在界面上成为同一件事。
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("风险项未逐条确认 ⇒ 不许启用（`GATE_NOT_PASSED`）", async () => {
    const audit = collectAudit();
    const r = await advanceSkillStatus(
      {
        skillId: "s1",
        principalId: "u1",
        from: "待审核",
        to: "已启用",
        gates: {
          scan: {
            verdict: "risk-pending-confirm",
            findings: [{ riskItemId: "r1", kind: "data-exfiltration", detail: "输出含原文片段" }],
          },
          methodologyReview: { approved: true },
          acknowledgedRiskItemIds: [],
        },
      },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("GATE_NOT_PASSED");
    expect(r.status).toBe("待审核");
  });

  it("绕过尝试（直接置已启用）⇒ 拒 **且写安全审计**（I-23）", async () => {
    const audit = collectAudit();
    const r = await advanceSkillStatus(
      { skillId: "s1", principalId: "u1", from: "草稿", to: "已启用", gates: CLEAN_SCAN },
      { audit },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("GATE_NOT_PASSED");
    // 一次没有留痕的拒绝，事后与「从未发生」不可区分。
    expect(audit.events.map((e) => e.kind)).toContain("skill-gate-bypass-attempt");
    expect(r.auditWritten).toBe(true);
  });

  it("两道门禁齐全且均通过 ⇒ 才放行（不过火：门控不能恒拒）", async () => {
    const audit = collectAudit();
    const r = await advanceSkillStatus(
      { skillId: "s1", principalId: "u1", from: "待审核", to: "已启用", gates: CLEAN_SCAN },
      { audit },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(audit.events).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * D08 的钉子：这份实现按 domain.md 落，契约侧未改——**这是未裁决状态，不是共识**
 * ──────────────────────────────────────────────────────────────────────── */

describe("D08 仍未裁决，且两侧取值与真实源文件逐字一致", () => {
  it("domain.md I-1 的四个取值与本实现相同", () => {
    const md = readFileSync(
      join(REPO, "phases/phase-01-run-a-project/contracts/skills/domain.md"),
      "utf8",
    );
    // I-1 那一行逐字写着这四个。它一旦被人改成五个，这条断言先红。
    expect(md).toContain("`{草稿, 待审核, 已启用, 已停用}`");
    expect(D08_UNRESOLVED.domainMdValues).toEqual(SKILL_STATUSES);
  });

  it("契约侧确实是五值，且 agent 没有动它", () => {
    const src = readFileSync(join(REPO, "packages/contracts/src/skills.ts"), "utf8");
    expect(src).toContain(
      'export const SkillStatus = z.enum(["草稿", "待审核", "被退回", "已启用", "已停用"]);',
    );
    expect(D08_UNRESOLVED.contractValues).toEqual([
      "草稿",
      "待审核",
      "被退回",
      "已启用",
      "已停用",
    ]);
  });

  it("两侧不同 ⇒ 分歧必须仍在登记簿里（谁删谁负责收敛）", () => {
    // ⚠ 先放宽成 `readonly string[]` 再比：直接比两个 `as const` 的 `.length`，
    //   TypeScript 会判「`5` 与 `4` 无重叠」而**编译期就红**。
    //   那其实是件好事——它说明分歧连类型层都看得见——但它会让这条**运行时**断言
    //   编译不过，于是 D08 被裁决收敛之后没有任何东西会提醒这里该删。
    const contract: readonly string[] = D08_UNRESOLVED.contractValues;
    const domainMd: readonly string[] = D08_UNRESOLVED.domainMdValues;
    expect(contract.length !== domainMd.length, "两侧已经相同了？那 D08 应当被人裁决并从登记簿删除").toBe(true);

    const ledger = readFileSync(join(REPO, D08_UNRESOLVED.ledger), "utf8");
    expect(ledger, "D08 从登记簿消失，但两侧仍不一致——收敛没做完").toContain("D08:");
    expect(ledger).toContain("Skill 状态机是四态还是五态");
  });
});
