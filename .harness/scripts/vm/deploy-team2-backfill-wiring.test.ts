/**
 * A9（`docs/agents/team2-acceptance-rubric.md`）—— 「部署即可用」的接线被机械核对。
 *
 * 这条链路有三处只要断一处就会静默失效，而且失效的表现都是「页面说本组织没有这个
 * Agent」，看不出是哪一环：
 *   ① `deploy.sh` 根本没调用补种脚本 → 部署了但没种；
 *   ② 模板的展示名与前端查找用的名字不是同一个字面量 → 种了但查不到；
 *   ③ advisory lock key 与另一个系统 agent 撞上 → 两个模板互相排队。
 *
 * 这些都不需要数据库就能断言——它们是接线，不是行为。真正写库的那一步
 * （`ensureSystemAgent`）由 `apps/api/tests/agent-runtime/` 既有的真栈用例覆盖。
 *
 * ⚠ 本文件刻意放在 `.harness/scripts/vm/`（跟着 deploy.sh 的其他门控走）而不是
 *   `apps/api/tests/`：后者的 globalSetup 无条件要求 docker 起 pgvector 容器，而这组
 *   断言一行 SQL 都不跑。把不需要 DB 的检查挂在需要 DB 的套件下，等于让它在任何拿不到
 *   容器的环境里都跑不了——那正是「有检查等于没检查」。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEAM2_AGENT_STABLE_NAME, TEAM2_AGENT_TEMPLATE } from "../../../apps/api/scripts/backfill-team2-agent";
import { RATING_AGENT } from "../../../apps/web/lib/postinvest-rating/agent-directory";
import { buildRatingPrompt } from "../../../apps/web/lib/postinvest-rating/rating-prompt";

const ROOT = resolve(import.meta.dirname, "../../..");
const deployScript = readFileSync(join(ROOT, ".harness/scripts/vm/deploy.sh"), "utf8");

describe("team2 补种脚本的部署接线", () => {
  it("deploy.sh 真的调用了补种脚本——不调用就是部署了但没种", () => {
    expect(deployScript).toContain("scripts/backfill-team2-agent.ts");
  });

  it("补种步骤排在其他 agent 补种之后，与它们同属一段", () => {
    // 参照物原本是 team3 的补种步骤，team3 于 2026-09-22 整体下线后改用 deep-research
    // ——它是这一段里最靠前且不会被删的那个系统 agent。
    const priorAt = deployScript.indexOf("scripts/backfill-deep-research-agent.ts");
    const team2At = deployScript.indexOf("scripts/backfill-team2-agent.ts");
    expect(priorAt).toBeGreaterThan(-1);
    expect(team2At).toBeGreaterThan(priorAt);
  });

  it("展示名与前端查找用的名字是同一个字面量——否则种了也查不到", () => {
    // 前端按 `capability_listings.name` 查（rating-agent-launcher.tsx 的 listCapabilities）。
    expect(TEAM2_AGENT_TEMPLATE.name).toBe(RATING_AGENT.name);
  });

  it("instructions 就是任务书本身，不是另抄的一份", () => {
    expect(TEAM2_AGENT_TEMPLATE.instructions).toBe(buildRatingPrompt([]));
    expect(TEAM2_AGENT_TEMPLATE.instructions.length).toBeGreaterThan(500);
  });

  it("stable_name 是自己那一个——幂等去重靠它", () => {
    expect(TEAM2_AGENT_STABLE_NAME).toBe("team2-postinvest-rating");
    expect(TEAM2_AGENT_TEMPLATE.stableName).toBe(TEAM2_AGENT_STABLE_NAME);
  });

  it("advisory lock key 不与已下线的 team3 曾用的 0x7ea3 相撞", () => {
    // 那个 key 现在没人占，但换回它没有任何好处：留着这条断言，未来再有人挑 key
    // 时不会正好挑到一个历史上被用过、日志里还能搜到的数字。
    expect(TEAM2_AGENT_TEMPLATE.lockKey).not.toBe(0x7ea3);
    expect(Number.isInteger(TEAM2_AGENT_TEMPLATE.lockKey)).toBe(true);
  });

  it("capability_listings 的两个 NOT NULL 展示列非空（CHECK 会拒空值）", () => {
    expect(TEAM2_AGENT_TEMPLATE.abbr.trim()).not.toBe("");
    expect(TEAM2_AGENT_TEMPLATE.duty.trim()).not.toBe("");
    expect(TEAM2_AGENT_TEMPLATE.roleLabel.trim()).not.toBe("");
  });
});
