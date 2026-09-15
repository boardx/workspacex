/**
 * A10（`docs/agents/team2-acceptance-rubric.md`）—— 交接文档必须**点名已知缺口**，
 * 不许把做不到的地方隐去。
 *
 * 为什么这需要机械门控：省略是无声的。一份只写「做了什么」的文档，读起来完全正常，
 * 接手的人要到撞上才知道缺什么——本仓 `static-trace-vs-live-fact.md` 记过这个形状
 * 「痕迹写得越诚实越具体，读起来越像权威」。缺口不写进去，下一个人会假设它在。
 *
 * 另一半同样重要：**验收标准自己不许引用不存在的检查**。一份声称「由 X 测试守住」
 * 而 X 根本没有的标准，比没有标准更坏——它让人以为有门控。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/**
 * 去掉换行与行首缩进再匹配：一句话被 Markdown 折行拆开（「…的审计\n  追溯。」）不该
 * 让语义断言变红。否则下一个人会为了过检查去改排版，而不是去改内容——那就本末倒置了。
 */
const flat = (text: string) => text.replace(/\s*\n\s*/g, "");
const mvpDoc = flat(read("docs/agents/team2-postinvest-rating-mvp.md"));
const rubricRaw = read("docs/agents/team2-acceptance-rubric.md");
const rubric = flat(rubricRaw);

describe("team2 交接文档的诚实度", () => {
  it("点名阶段三整体不做，并逐项说明缺了什么", () => {
    expect(mvpDoc).toContain("阶段三");
    for (const gap of ["版本链", "draft → confirmed", "审计追溯"]) {
      expect(mvpDoc).toContain(gap);
    }
  });

  it("点名 m4a 不支持及原因，而不是让人上传了才发现被拒", () => {
    expect(mvpDoc).toContain("m4a");
    expect(mvpDoc).toContain("uploadArtifact");
  });

  it("点名部署仍需人的那一步——不写就会被当成已经自动化", () => {
    expect(mvpDoc).toContain("backfill-team2-agent.ts");
    expect(mvpDoc).toContain("deploy.sh");
  });

  it("记录了「不落库」是人类的决定，以及改主意时该走哪条路", () => {
    expect(mvpDoc).toContain("人类拍板");
    expect(mvpDoc).toContain("design-signoff.md");
  });
});

describe("验收标准自身", () => {
  it("开篇就写明这 10 分不等于 UC-16.1 的完成度", () => {
    expect(rubric).toContain("不等于 UC-16.1 的完成度");
  });

  it("恰好十条评分项（功能性 F1–F6 + 可用性 U1–U4），每条都有现状与分数", () => {
    const rows = rubricRaw.split("\n").filter((l) => /^\| (?:F|U)\d+ \|/.test(l));
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect(cells[3]).not.toBe("");   // 现状一栏不许空着
      expect(cells[4]).not.toBe("");   // 分数一栏不许空着
    }
  });

  it("「提示词里写了」不算分——这条一旦被删掉，整份标准就退回自我说服", () => {
    expect(rubric).toContain("L1 不得分");
    expect(rubric).toContain("不等于它做了");
  });

  it("写明当前瓶颈不在实现者这边，且说清卡在哪一步", () => {
    expect(rubric).toContain("devapp-install-trusted-scripts");
    expect(rubric).toContain("backfill-team2-agent.ts");
  });

  it("标准引用的每一个测试文件都真实存在——不许引用不存在的门控", () => {
    // 覆盖两种落点：workspace 包里的 `apps/*/tests/…` 与控制平面的 `.harness/…`。
    const cited = [...rubricRaw.matchAll(/`((?:apps\/[a-z]+\/|\.harness\/)[\w/.-]+\.test\.tsx?)`/g)]
      .map((m) => m[1]!);

    const missing = cited.filter((rel) => !existsSync(join(ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it("写明打分不由实现者做", () => {
    expect(rubric).toContain("打分不由实现者做");
    expect(rubric).toContain("feature-evaluator");
  });
});
