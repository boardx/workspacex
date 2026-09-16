/**
 * 「上会审阅」Skill 正文变了就必须升版本号——把这条从「线上静静失效」搬到「CI 会红」。
 *
 * ## 为什么需要这个测试（2026-09-16 真机事故）
 *
 * `ensure-platform-skill-catalog.ts` 的种子有一道 fail-closed 摘要门控：同一个版本 id
 * 而内容摘要不一致就抛错，提示先 bump 版本号。这道门是对的，但它**只在运行时抛**，
 * 而 `main.ts` 为了「一次数据库抖动不该让整个 API 起不来」把它包成了 never-throw——
 * 于是真实后果是：issue #3707 的任务五（同步产出 Excel）合进 main、CI 全绿、部署成功，
 * 而 devapp 上的 Agent 从头到尾没见过那段正文，库里仍是旧版本。用户问「为什么报告最后
 * 没有 Excel 下载」，答案是这一行版本号没改。
 *
 * 门控没错，错在它响的地方没人看。所以这里把同一条判据前移到 CI：正文摘要与版本号
 * 一起钉死，改了正文而没升版本号（或升了版本号而忘了更新摘要）都会在这里红。
 *
 * ⚠ 改动正文后怎么办：不是把下面的摘要改成新值了事——**先升
 * `apps/web/lib/ic-review/skill-identity.ts` 的版本号**，再把新摘要填进来。两者要一起改，
 * 这正是本测试要强制的那件事。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IC_REVIEW_SKILL_MD } from "../../scripts/ic-review-skill-content";
import { IC_REVIEW_SKILL_VERSION_ID } from "../../../web/lib/ic-review/skill-identity";

/** 与种子 `ensure-platform-skill-catalog.ts` 逐字同一种算法。 */
const digest = createHash("sha256").update(IC_REVIEW_SKILL_MD).digest("hex");

/** v3 = 项目类型（并购／融资）+ 条目适用范围 + 财务表现五项 + 对赌期三年（issue #3710）。 */
const EXPECTED_VERSION_ID = "skill-team1-ic-review-standard-v3";
const EXPECTED_DIGEST = "c2cb9878cdcacd97f78525c88848e8f338b2260b544b2256fdee10c35e20e79e";

describe("上会审阅 Skill：正文与版本号必须一起改", () => {
  it("版本号是当前登记的那个", () => {
    expect(IC_REVIEW_SKILL_VERSION_ID).toBe(EXPECTED_VERSION_ID);
  });

  it("正文摘要与版本号登记一致——不一致说明改了正文没升版本号", () => {
    expect(digest).toBe(EXPECTED_DIGEST);
  });

  it("任务五真的在正文里（防止只改了版本号、正文回退）", () => {
    expect(IC_REVIEW_SKILL_MD).toContain("任务五");
    expect(IC_REVIEW_SKILL_MD).toContain("xlsx-create");
    expect(IC_REVIEW_SKILL_MD).toContain("标准检查明细");
  });

  it("项目类型判定与适用范围真的在正文里（issue #3710）", () => {
    expect(IC_REVIEW_SKILL_MD).toContain("任务零");
    expect(IC_REVIEW_SKILL_MD).toContain("无法判定");
    expect(IC_REVIEW_SKILL_MD).toContain("仅并购类适用");
    expect(IC_REVIEW_SKILL_MD).toContain("仅融资类适用");
  });
});
