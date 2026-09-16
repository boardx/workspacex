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

/** v4 = 公开信息检索 + 竞对对比（SWOT／波特五力）+ 投资风险识别四类 + Excel 两张新 sheet（issue #3713）。 */
const EXPECTED_VERSION_ID = "skill-team1-ic-review-standard-v4";
const EXPECTED_DIGEST = "6a7b52c66cd019a13a4041e46feabe158f65732deebd719c95b8e3a863e6de55";

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

  it("Excel 仍是最后一步，且装得下新内容（issue #3713）", () => {
    expect(IC_REVIEW_SKILL_MD).toContain("任务八：同步产出 Excel 结果文件");
    expect(IC_REVIEW_SKILL_MD).toContain("「竞对对比」");
    expect(IC_REVIEW_SKILL_MD).toContain("「风险清单」");
    // 任务八之后不得再有任务标题——Excel 必须是最后一个任务。
    expect(IC_REVIEW_SKILL_MD.split("\n## 任务").pop()).toContain("八：");
  });

  it("公开信息 / 竞对 / 风险三段与防编造条款都在正文里（issue #3713）", () => {
    expect(IC_REVIEW_SKILL_MD).toContain("任务四：公开信息检索与行业画像");
    expect(IC_REVIEW_SKILL_MD).toContain("任务五：竞对对比与框架分析");
    expect(IC_REVIEW_SKILL_MD).toContain("任务六：投资风险识别");
    expect(IC_REVIEW_SKILL_MD).toContain("来源四要素");
    expect(IC_REVIEW_SKILL_MD).toContain("未检索到");
    expect(IC_REVIEW_SKILL_MD).toContain("不许编造竞对财务数据");
    expect(IC_REVIEW_SKILL_MD).toContain("证据不足");
    expect(IC_REVIEW_SKILL_MD).toContain("外部冲突");
    // 边界不因新增风险识别而破。
    expect(IC_REVIEW_SKILL_MD).toContain("不给投资建议");
  });

  it("项目类型判定与适用范围真的在正文里（issue #3710）", () => {
    expect(IC_REVIEW_SKILL_MD).toContain("任务零");
    expect(IC_REVIEW_SKILL_MD).toContain("无法判定");
    expect(IC_REVIEW_SKILL_MD).toContain("仅并购类适用");
    expect(IC_REVIEW_SKILL_MD).toContain("仅融资类适用");
  });
});
