/**
 * `/agent/team4` 内置 Skill 正文的**内容钉版**。
 *
 * ## 这条测试防的是什么
 *
 * seeding（`ensure-platform-skill-catalog.ts` 的 `seedAdHocAgentSkill`）是 fail closed
 * 的：同一个 `POST_INVESTMENT_SKILL_VERSION_ID` 下如果内容摘要变了，它会抛错而不是静默
 * 用旧内容。但那个错只在 **API 进程启动时**出现、被 `main.ts` catch 成一行 `console.error`
 * ——仓库里、CI 里、PR 里没有任何东西会红。于是"改了方法论忘了升版本号"这件事的第一
 * 现场是线上启动日志，而症状是「Skill 内容还是旧的，模型行为没变」，极难往回追。
 *
 * 这条测试把那次失败提前到 PR：正文（包括它从 `@repo/maau-postinvest-report`
 * 渲染进来的阈值、公式、自检算例）任何一处实质变化，摘要就对不上，测试红，提示去升
 * `POST_INVESTMENT_SKILL_VERSION_ID`。
 *
 * ## 改了正文之后怎么做（两步，别只做一步）
 *
 * 1. 把 `POST_INVESTMENT_SKILL_VERSION_ID` 升一版（`-v1` → `-v2`）；
 * 2. 跑 `npx vitest run tests/team4-skill-content-pin.test.ts` 拿到新摘要，更新下面的
 *    `PINNED`（错误信息里会直接打印出来）。
 *
 * 只做第 2 步 = 把钉子拔了重新钉在新内容上，线上仍会停在旧版本内容——那正是这条
 * 测试要拦的事，所以断言里把版本号一起钉住。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPostInvestmentSkillContent } from "@/lib/post-investment/methodology";
import {
  POST_INVESTMENT_SKILL_ID,
  POST_INVESTMENT_SKILL_VERSION_ID,
} from "@/lib/post-investment/skill-identity";

/** 与 seeding 里算 `content_digest` 用的是同一个算法（sha256 over 正文）。 */
function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 当前钉住的版本号与正文摘要。改正文 ⇒ 两个一起改（见文件头注）。 */
const PINNED = {
  versionId: `${POST_INVESTMENT_SKILL_ID}-v1`,
  digest: "11a583c21ab95e559c050b10c1cbd9479ba47d9c759a2909bea5e7ebbfaf6648",
};

describe("team4 内置 Skill 内容钉版", () => {
  it("版本号没被悄悄改动", () => {
    expect(POST_INVESTMENT_SKILL_VERSION_ID).toBe(PINNED.versionId);
  });

  it("正文摘要与钉住的一致——不一致说明正文（或它渲染的契约阈值）变了，去升版本号", () => {
    const actual = digestOf(buildPostInvestmentSkillContent());
    expect(
      actual,
      `方法论正文变了。两步都要做：① 升 POST_INVESTMENT_SKILL_VERSION_ID；` +
      `② 把本文件的 PINNED.digest 更新为 ${actual}。只做②会让线上停在旧版本内容。`,
    ).toBe(PINNED.digest);
  });

  it("正文确实把契约里的判据/公式/自检算例渲染进去了（不是只在源码里写了 import）", () => {
    const body = buildPostInvestmentSkillContent();
    // 渲染函数漏插值时源码照样好看，只有渲染结果能证明模型真的会看到这些内容。
    expect(body).toContain("增收不增利");           // renderRiskCriteria()
    expect(body).toContain("现金跑道月数 = 货币资金"); // renderDerivedFormulas()
    expect(body).toContain("资本化率应为 80%");       // renderSelfChecks()
  });
});
