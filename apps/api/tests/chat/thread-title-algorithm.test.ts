/**
 * 会话级标题算法（`domain/chat/thread-title-algorithm.ts`）—— **纯函数**门控。
 *
 * 逐字断言只钉在这一层，理由与 `generate-thread-title.test.ts` 头注的第 ③ 条同一件事：
 * 模型输出不确定，真实栈那条路径只能断言「非空且不等于新对话」这种弱条件；本算法的三件
 * 判定（什么时候算 / 拿什么算 / 算完要不要落地）全是纯函数，可以逐条钉死。
 *
 * 每一组断言对应一个**实测见过的失败形状**，不是为覆盖率凑的：
 *   ① 「你好」开头的会话不能在第 1 档被命名成「你好」，且必须留给后面的档位捞回来；
 *   ② 同一档不重算、档位不回退——否则侧栏名字每说一句抖一次；
 *   ③ 用户手动改过的名字，任何档位都不覆盖；
 *   ④ 摘要按优先级取材并封顶，不是整段 transcript。
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_PER_MESSAGE_MAX,
  EVIDENCE_TOTAL_MAX,
  TITLE_REFRESH_LADDER,
  buildTitleEvidence,
  isLowInformation,
  planTitleRefresh,
  shouldReplaceTitle,
  type TitleEvidenceMessage,
} from "../../src/domain/chat/thread-title-algorithm";

const human = (body: string): TitleEvidenceMessage => ({ role: "human", body });
const agent = (body: string): TitleEvidenceMessage => ({ role: "agent", body });

describe("isLowInformation —— 判的是「整条就是寒暄」，不是「短」", () => {
  it.each(["你好", "你好！", "  你好 呀  ", "Hi", "hello!!", "在吗？", "你可以做什么?", "测试", "?", ""])(
    "%j 判为低信息量",
    (text) => expect(isLowInformation(text)).toBe(true),
  );

  it.each([
    "你好，帮我把登录接口的超时改成 30 秒", // ⚠ 用 includes 判寒暄就会错杀这一条
    "改 K8s 探针",
    "分析这个公司出报告",
  ])("%j 不是低信息量", (text) => expect(isLowInformation(text)).toBe(false));
});

describe("planTitleRefresh —— 什么时候算", () => {
  const fresh = { source: "default" as const, stage: 0 };

  it("第一条人类消息就起名（#2094 的既有行为不退化）", () => {
    expect(planTitleRefresh({ ...fresh, humanMessageCount: 1 }))
      .toMatchObject({ refresh: true, stage: 1 });
  });

  it("同一档不重算：第 2、3 条消息一次模型往返都不发", () => {
    for (const n of [2, 3]) {
      expect(planTitleRefresh({ source: "auto", stage: 1, humanMessageCount: n }))
        .toMatchObject({ refresh: false, reason: "not-at-checkpoint" });
    }
  });

  it("到下一档才重算，且档位单调推进", () => {
    expect(planTitleRefresh({ source: "auto", stage: 1, humanMessageCount: 4 }))
      .toMatchObject({ refresh: true, stage: 2 });
    // 已经在更高档位（并发下高档先落地）⇒ 低档那次不回退。
    expect(planTitleRefresh({ source: "auto", stage: 2, humanMessageCount: 4 }))
      .toMatchObject({ refresh: false });
  });

  it("一条线程一生最多重算 TITLE_REFRESH_LADDER.length 次", () => {
    const last = TITLE_REFRESH_LADDER.length;
    expect(planTitleRefresh({ source: "auto", stage: last, humanMessageCount: 500 }))
      .toMatchObject({ refresh: false, reason: "ladder-exhausted" });
  });

  it("用户改过名 ⇒ 任何档位都不算", () => {
    expect(planTitleRefresh({ source: "user", stage: 0, humanMessageCount: 4 }))
      .toMatchObject({ refresh: false, reason: "user-owned" });
  });
});

describe("buildTitleEvidence —— 拿什么算", () => {
  it("丢掉寒暄，保留首条有信息量的消息（意图锚）与最近几条", () => {
    const evidence = buildTitleEvidence(
      [human("你好"), human("帮我看下 A 轮的尽调清单"), agent("好的"), human("重点是财务口径")],
      3,
    );
    expect(evidence).toBe("用户：帮我看下 A 轮的尽调清单\n用户：重点是财务口径");
  });

  it("首条助手回复只取一条，用来消歧", () => {
    const evidence = buildTitleEvidence([human("帮我看看这个"), agent("这份 2026 年报的收入结构是…")], 1);
    expect(evidence).toBe("用户：帮我看看这个\n助手：这份 2026 年报的收入结构是…");
  });

  it("全是寒暄 ⇒ null（没有可用输入，不编一个标题）", () => {
    expect(buildTitleEvidence([human("你好"), agent("你好，有什么可以帮你"), human("在吗")], 3)).toBeNull();
  });

  it("单条按码点截断、总量不超预算", () => {
    const long = "指".repeat(EVIDENCE_PER_MESSAGE_MAX * 2);
    const evidence = buildTitleEvidence(Array.from({ length: 30 }, () => human(long)), 5);
    expect(evidence).not.toBeNull();
    expect(Array.from(evidence as string).length).toBeLessThanOrEqual(EVIDENCE_TOTAL_MAX + 30 * 4);
    for (const line of (evidence as string).split("\n")) {
      expect(Array.from(line.replace(/^用户：/u, "")).length).toBeLessThanOrEqual(EVIDENCE_PER_MESSAGE_MAX);
    }
  });

  it("emoji 不被劈成半个字（按码点截断，不是 code unit）", () => {
    const evidence = buildTitleEvidence([human("排查告警 " + "🙂".repeat(EVIDENCE_PER_MESSAGE_MAX + 10))], 1);
    expect(evidence).not.toContain("�");
    expect(Array.from(evidence as string)).not.toContain("\uD83D");
  });
});

describe("shouldReplaceTitle —— 算完要不要落地（防抖）", () => {
  it("用户起的名字永不覆盖", () => {
    expect(shouldReplaceTitle("我的尽调", "A 轮尽调清单复核", "user")).toBe(false);
  });

  it("默认名一律让位", () => {
    expect(shouldReplaceTitle("新对话", "A 轮尽调清单复核", "default")).toBe(true);
  });

  it("候选为空 / 仍是寒暄 ⇒ 保留现状", () => {
    expect(shouldReplaceTitle("新对话", null, "default")).toBe(false);
    expect(shouldReplaceTitle("新对话", "你好", "default")).toBe(false);
  });

  it("与现名等价或增量不足 ⇒ 不写（侧栏名字不为此抖一次）", () => {
    expect(shouldReplaceTitle("登录超时排查", "登录超时排查", "auto")).toBe(false);
    expect(shouldReplaceTitle("登录超时", "登录超时问题", "auto")).toBe(false);
  });

  it("换了题 ⇒ 改写", () => {
    expect(shouldReplaceTitle("登录超时", "迁移到新的鉴权网关", "auto")).toBe(true);
  });
});
