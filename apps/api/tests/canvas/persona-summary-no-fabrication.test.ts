/**
 * `buildPersonaLanding`（`domain/canvas/persona-summary.ts`）—— 「canvas 模板要能在
 * chat 里用起来」这句人类原话落地的核心不变量：**不编造**。
 *
 * 反证式覆盖：
 *   ① 有真实标签化内容 ⇒ 只有那几条逐字进画像，别的字段/分区维持占位；
 *   ② 一条都没有 ⇒ `sufficient: false`，落地内容明说「信息不足」，不是一份
 *      看起来完整、其实是空模板套壳的假画像。
 */
import { describe, expect, it } from "vitest";
import { buildPersonaLanding } from "../../src/domain/canvas/persona-summary";

describe("buildPersonaLanding · 不编造", () => {
  it("①线程正文里有 persona 模板自己的字段/分区语法 ⇒ 逐字采纳，标题用姓名", () => {
    const rawText = [
      "以下是我们这次访谈的记录，仅供参考。",
      "姓名: 陈静",
      "职位: 生产计划员",
      "",
      "## 目标和需求",
      "- 确保订单准时交付率稳定在95%以上",
      "- 减少因插单导致的计划重排次数",
    ].join("\n");

    const draft = buildPersonaLanding(rawText);

    expect(draft.sufficient).toBe(true);
    expect(draft.title).toBe("用户画像 · 陈静");
    expect(draft.payloadRef).toContain("```persona");
    expect(draft.payloadRef).toContain("姓名: 陈静");
    expect(draft.payloadRef).toContain("职位: 生产计划员");
    expect(draft.payloadRef).toContain("## 目标和需求");
    expect(draft.payloadRef).toContain("确保订单准时交付率稳定在95%以上");
    // 没写过的字段不能凭空出现真值——只应留在占位符状态，round-trip 序列化把
    // 未填字段整行省略（同 `persona.ts` 既有测试 "Placeholder fields are omitted"）。
    expect(draft.payloadRef).not.toContain("性别:");
    expect(draft.payloadRef).not.toContain("年龄:");
    // 没提过的分区不能凭空长出要点。
    expect(draft.payloadRef).not.toContain("痛点和挑战");
  });

  it("②自由聊天、没有任何 persona 字段/分区语法 ⇒ 如实报告信息不足，不虚构画像", () => {
    const rawText = [
      "早上好，今天的会议几点开始？",
      "我觉得这个方案还需要再讨论一下。",
      "好的，那我们下午两点再聊。",
    ].join("\n");

    const draft = buildPersonaLanding(rawText);

    expect(draft.sufficient).toBe(false);
    expect(draft.title).toBe("用户画像（信息不足）");
    expect(draft.payloadRef).toContain("信息不足");
    expect(draft.payloadRef).toContain("不代表任何真实用户信息");
    // 占位产物依然是合法的 persona 围栏（右栏/画布仍然能渲染出一个空模板）。
    expect(draft.payloadRef).toContain("```persona");
  });

  it("③空字符串（线程一条消息都还没有）同样落到信息不足分支，不抛异常", () => {
    const draft = buildPersonaLanding("");
    expect(draft.sufficient).toBe(false);
    expect(draft.title).toBe("用户画像（信息不足）");
  });

  it("④只匹配 persona 自己的字段名——不认识的字段名不会被当成画像信息", () => {
    const rawText = "订单号: A-10086\n负责人: 王芳\n";
    const draft = buildPersonaLanding(rawText);
    // “订单号”“负责人”都不在 PERSONA_FIELDS 里，不应被采纳为“找到了信息”。
    expect(draft.sufficient).toBe(false);
  });

  it("⑤同一字段被后写的值覆盖——不是各自都进画像（避免同名字段重复计数误判 sufficient）", () => {
    const rawText = "姓名: 张三\n\n姓名: 李四\n";
    const draft = buildPersonaLanding(rawText);
    expect(draft.sufficient).toBe(true);
    expect(draft.payloadRef).toContain("姓名: 李四");
    expect(draft.payloadRef).not.toContain("张三");
  });
});
