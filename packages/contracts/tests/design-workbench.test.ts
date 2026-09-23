/**
 * `design-workbench` 契约束（UC-17.8 B4.1）——三件事：
 *   1. `DesignProject` 形状正反例：`.strict()` 拒多余键、`ownerName` 可空、`chat` turn 边界。
 *   2. 常量导出：`DESIGN_PROJECT_INITIAL_CRITERIA` / `DESIGN_PROJECT_INITIAL_FRAMES` 是三值/三值。
 *   3. `operations` 的 `in`/`out` 边界：`name` 长度、`inboxCode` 前缀、错误码闭集。
 */
import { describe, expect, it } from "vitest";
import * as dw from "../src/design-workbench";
import * as ai from "../src/design-ai-collab";

describe("常量", () => {
  it("验收标准固定三条", () => {
    expect(dw.DESIGN_PROJECT_INITIAL_CRITERIA).toHaveLength(3);
  });
  it("画布页默认三页", () => {
    // 2026-09-08 人类实测：新建项目不再预填「草稿页 1/2/3」——页数由模型按产品定。
    expect(dw.DESIGN_PROJECT_INITIAL_FRAMES).toEqual([]);
  });
  it("引导语与回执非空", () => {
    expect(dw.DESIGN_WORKBENCH_CHAT_INTRO.length).toBeGreaterThan(0);
    expect(dw.DESIGN_WORKBENCH_CHAT_REPLY.length).toBeGreaterThan(0);
  });
});

const project: dw.DesignProject = {
  id: "dp-1",
  name: "反馈导出流程重设计",
  template: "wireframe",
  theme: "dark",
  accent: "neutral",
  tokens: { brand: null, font: "sans" },
  tags: [],
  share: null,
  refImages: [],
  problem: "导出按钮点击无响应，需要重新设计交互反馈",
  criteria: [...dw.DESIGN_PROJECT_INITIAL_CRITERIA],
  frames: [...dw.DESIGN_PROJECT_INITIAL_FRAMES],
  prototype: [],
  frameNotes: [],
  githubIssueUrl: null,
  githubIssueNumber: null,
  pushed: false,
  pushedAt: null,
  linkedFeedbackId: "fb-1",
  chat: [],
  ownerId: "u-1",
  ownerName: "李四",
  createdAt: "2026-09-04T08:00:00.000Z",
  updatedAt: "2026-09-04T08:00:00.000Z",
};

describe("迭代 30 字数上限是单源常量", () => {
  it("对话正文与 problem 都按 DESIGN_TEXT_MAX_CHARS 卡，界面拿得到同一个数", () => {
    /*
     * ⭐ 反证锚点：把任何一处改回字面量 4000 而常量改成别的值 ⇒ 这条红。
     * 前端要在**发送之前**就说得出这个数；抄一份到输入框旁边，就是第二份事实源。
     */
    const n = dw.DESIGN_TEXT_MAX_CHARS;
    expect(n).toBeGreaterThan(0);
    const turn = (len: number) => ({ role: "user" as const, text: "x".repeat(len), at: "2026-09-22T00:00:00.000Z" });
    expect(dw.DesignProjectChatTurn.safeParse(turn(n)).success).toBe(true);
    expect(dw.DesignProjectChatTurn.safeParse(turn(n + 1)).success).toBe(false);
    expect(dw.operations.appendProjectChat.in.safeParse({ projectId: "p1", text: "x".repeat(n) }).success).toBe(true);
    expect(dw.operations.appendProjectChat.in.safeParse({ projectId: "p1", text: "x".repeat(n + 1) }).success).toBe(false);
  });
});

describe("DesignProject -- 正例", () => {
  it("基本形状", () => {
    expect(dw.DesignProject.safeParse(project).success).toBe(true);
  });
  it("problem 可空字符串", () => {
    expect(dw.DesignProject.safeParse({ ...project, problem: "" }).success).toBe(true);
  });
  it("linkedFeedbackId 为 null（不是深化出来的项目）", () => {
    expect(dw.DesignProject.safeParse({ ...project, linkedFeedbackId: null }).success).toBe(true);
  });
  it("ownerName 为 null（owner 已不可查）", () => {
    expect(dw.DesignProject.safeParse({ ...project, ownerName: null }).success).toBe(true);
  });
  it("已推送：pushed=true 且 pushedAt 非 null", () => {
    expect(
      dw.DesignProject.safeParse({ ...project, pushed: true, pushedAt: "2026-09-04T09:00:00.000Z" }).success,
    ).toBe(true);
  });
  it("chat 带有效轮次", () => {
    expect(
      dw.DesignProject.safeParse({
        ...project,
        chat: [
          { role: "user", text: "先做移动端", at: "2026-09-04T08:01:00.000Z" },
          { role: "ai", text: dw.DESIGN_WORKBENCH_CHAT_REPLY, at: "2026-09-04T08:01:01.000Z" },
        ],
      }).success,
    ).toBe(true);
  });
  it("三种模板都合法", () => {
    for (const template of ["mobile", "ui", "wireframe"] as const) {
      expect(dw.DesignProject.safeParse({ ...project, template }).success, template).toBe(true);
    }
  });
});

describe("DesignProject -- 反例", () => {
  it("strict：多一个未声明的键即拒", () => {
    // ⚠ 探针要用一个**永远不会**成为真字段的名字。原来用的是 `tags`，迭代 13 把它加成了
    //   真字段，这条于是转红——那是它该有的反应（它证明 strict 真的在判），但如果当时
    //   顺手把断言改成 `toBe(true)`，这条就变成一条什么都不守的测试了。
    expect(dw.DesignProject.safeParse({ ...project, __definitelyNotAField: 1 }).success).toBe(false);
    // 而 `tags` 现在是真字段：给合法值要能过。
    expect(dw.DesignProject.safeParse({ ...project, tags: ["后台"] }).success).toBe(true);
  });

  it("tags：最多 8 个，单个最长 20 字", () => {
    const ok = Array.from({ length: dw.DESIGN_PROJECT_MAX_TAGS }, (_, i) => `t${i}`);
    expect(dw.DesignProject.safeParse({ ...project, tags: ok }).success).toBe(true);
    expect(dw.DesignProject.safeParse({ ...project, tags: [...ok, "t8"] }).success).toBe(false);
    expect(dw.DesignProject.safeParse({ ...project, tags: ["x".repeat(dw.DESIGN_PROJECT_TAG_MAX_CHARS + 1)] }).success).toBe(false);
    expect(dw.DesignProject.safeParse({ ...project, tags: [""] }).success).toBe(false);
  });
  it("name 为空拒；超过 200 字拒", () => {
    expect(dw.DesignProject.safeParse({ ...project, name: "" }).success).toBe(false);
    expect(dw.DesignProject.safeParse({ ...project, name: "x".repeat(201) }).success).toBe(false);
  });
  it("template 不在闭集里即拒", () => {
    expect(dw.DesignProject.safeParse({ ...project, template: "canvas" }).success).toBe(false);
  });
  it("chat turn 缺字段或 role 不在枚举里即拒", () => {
    expect(
      dw.DesignProject.safeParse({ ...project, chat: [{ role: "bot", text: "x", at: "2026-09-04T08:00:00.000Z" }] })
        .success,
    ).toBe(false);
    expect(
      dw.DesignProject.safeParse({ ...project, chat: [{ role: "user", text: "" , at: "2026-09-04T08:00:00.000Z" }] })
        .success,
    ).toBe(false);
  });
  it("缺任何一个必填键即拒（linkedFeedbackId 必须显式给 null，不能省略）", () => {
    const { linkedFeedbackId: _omit, ...rest } = project;
    expect(dw.DesignProject.safeParse(rest).success).toBe(false);
  });
});

describe("createProject.in", () => {
  const schema = dw.operations.createProject.in;
  it("最小合法输入", () => {
    expect(schema.safeParse({ name: "新项目", template: "ui" }).success).toBe(true);
  });
  it("带 problem 与 linkedFeedbackId", () => {
    expect(
      schema.safeParse({ name: "新项目", template: "mobile", problem: "背景", linkedFeedbackId: "fb-9" }).success,
    ).toBe(true);
  });
  it("name 为空拒；缺 template 拒", () => {
    expect(schema.safeParse({ name: "", template: "ui" }).success).toBe(false);
    expect(schema.safeParse({ name: "x" }).success).toBe(false);
  });
  it("不接受 criteria/frames/chat（服务端填，前端传了即拒）", () => {
    expect(schema.safeParse({ name: "x", template: "ui", criteria: [] }).success).toBe(false);
    expect(schema.safeParse({ name: "x", template: "ui", frames: [] }).success).toBe(false);
    expect(schema.safeParse({ name: "x", template: "ui", chat: [] }).success).toBe(false);
  });
});

describe("listMyProjects.in", () => {
  const schema = dw.operations.listMyProjects.in;
  it("空 query 合法", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });
  it("q 超过 200 字拒", () => {
    expect(schema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("updateProject.in", () => {
  const schema = dw.operations.updateProject.in;
  it("只改 name", () => {
    expect(schema.safeParse({ projectId: "dp-1", name: "改名了" }).success).toBe(true);
  });
  it("不接受 criteria/frames/chat", () => {
    expect(schema.safeParse({ projectId: "dp-1", criteria: [] }).success).toBe(false);
  });
  it("name 传空字符串拒（即便是可选字段，传了就要满足 min(1)）", () => {
    expect(schema.safeParse({ projectId: "dp-1", name: "" }).success).toBe(false);
  });
});

describe("appendProjectChat.in", () => {
  const schema = dw.operations.appendProjectChat.in;
  it("合法输入", () => {
    expect(schema.safeParse({ projectId: "dp-1", text: "先做移动端" }).success).toBe(true);
  });
  it("text 为空拒；超过 4000 字拒", () => {
    expect(schema.safeParse({ projectId: "dp-1", text: "" }).success).toBe(false);
    expect(schema.safeParse({ projectId: "dp-1", text: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("pushToInbox", () => {
  it("in：note 可选", () => {
    const schema = dw.operations.pushToInbox.in;
    expect(schema.safeParse({ projectId: "dp-1" }).success).toBe(true);
    expect(schema.safeParse({ projectId: "dp-1", note: "给工程的说明" }).success).toBe(true);
  });
  it("out：inboxCode 必须是 D-n 形状", () => {
    const schema = dw.operations.pushToInbox.out;
    expect(schema.safeParse({ project, inboxCode: "D-2" }).success).toBe(true);
    expect(schema.safeParse({ project, inboxCode: "B-2" }).success).toBe(false);
    expect(schema.safeParse({ project, inboxCode: "D2" }).success).toBe(false);
  });
  it("错误码里没有 ALREADY_PUSHED（幂等 = upsert，见文件头）", () => {
    expect(dw.DesignWorkbenchError.options).not.toContain("ALREADY_PUSHED");
  });
});

describe("deepenFeedback", () => {
  it("in：只接 feedbackId，多传别的字段拒（不接受调用方拼 name/problem/template）", () => {
    const schema = dw.operations.deepenFeedback.in;
    expect(schema.safeParse({ feedbackId: "fb-1" }).success).toBe(true);
    expect(schema.safeParse({ feedbackId: "fb-1", name: "自己拼的标题" }).success).toBe(false);
  });
  it("out：project + created 布尔（幂等命中已存在项目时 created=false）", () => {
    const schema = dw.operations.deepenFeedback.out;
    expect(schema.safeParse({ project, created: true }).success).toBe(true);
    expect(schema.safeParse({ project, created: false }).success).toBe(true);
    expect(schema.safeParse({ project }).success).toBe(false);
  });
  it("错误码里没有 NOT_PROJECT_OWNER：命中已有项目时不判断请求者是不是 owner", () => {
    expect([...dw.operations.deepenFeedback.err]).not.toContain("NOT_PROJECT_OWNER");
  });
  it("route 挂在 /feedback 命名空间下（B4.4 backlog 原文路径）", () => {
    expect(dw.operations.deepenFeedback.path).toBe("/feedback/:feedbackId/deepen");
  });
});

describe("错误码闭集：每个操作的 err 都在 DesignWorkbenchError 里", () => {
  it("逐操作校验", () => {
    for (const op of Object.values(dw.operations)) {
      for (const e of op.err) expect(dw.DesignWorkbenchError.options).toContain(e);
    }
  });
  it("NOT_PROJECT_OWNER 存在（仅 owner 可改/删/推送/发消息）", () => {
    expect(dw.DesignWorkbenchError.options).toContain("NOT_PROJECT_OWNER");
  });
});

/**
 * 2026-09-07 用户实测事故：设计协作发消息只回一句「稍后会更新原型画布」，画布永远空着。
 * 那句话是模型不可用时的退路文案，而它承诺了一件不会发生的事——没有任何后台任务在排队。
 * 退路现在必须带上**为什么**，并且这个绑定是机械的：说了 fallback 就必须给原因，
 * 说了 model 就不许挂原因。
 */
describe("退路必须说明原因（DesignChatReply）", () => {
  const base = { applied: [], suggestions: [] } as const;
  it("source=fallback 必须带 fallbackReason", () => {
    expect(ai.DesignChatReply.safeParse({ ...base, source: "fallback" }).success).toBe(false);
    expect(ai.DesignChatReply.safeParse({ ...base, source: "fallback", fallbackReason: "MODEL_NOT_CONFIGURED" }).success).toBe(true);
  });
  it("迭代 12：闭集含 MODEL_OUTPUT_TRUNCATED，且与 MODEL_BAD_JSON 是两个成员", () => {
    // 「输出被长度截断」与「输出不合语法」此前落成同一个原因，屏上给用户的下一步却不同。
    expect(ai.DesignChatFallbackReason.options).toContain("MODEL_OUTPUT_TRUNCATED");
    expect(ai.DesignChatFallbackReason.options).toContain("MODEL_BAD_JSON");
    expect(ai.DesignChatReply.safeParse({ ...base, source: "fallback", fallbackReason: "MODEL_OUTPUT_TRUNCATED" }).success).toBe(true);
  });
  it("source=model 不许带 fallbackReason", () => {
    expect(ai.DesignChatReply.safeParse({ ...base, source: "model" }).success).toBe(true);
    expect(ai.DesignChatReply.safeParse({ ...base, source: "model", fallbackReason: "MODEL_CALL_FAILED" }).success).toBe(false);
  });
  it("原因是闭集，未知值拒绝", () => {
    expect(ai.DesignChatReply.safeParse({ ...base, source: "fallback", fallbackReason: "WHATEVER" }).success).toBe(false);
    expect(ai.DesignChatFallbackReason.options).toEqual([
      "MODEL_NOT_CONFIGURED", "MODEL_CALL_FAILED", "MODEL_TIMEOUT", "MODEL_EMPTY_OUTPUT", "MODEL_BAD_JSON", "MODEL_NO_REPLY_TEXT",
      "MODEL_OUTPUT_TRUNCATED",
    ]);
  });
  it("退路文案不再承诺「稍后会更新」——它不会兑现", () => {
    expect(dw.DESIGN_WORKBENCH_CHAT_REPLY).not.toMatch(/稍后会更新/);
  });
});

/**
 * 迭代 13（delta `design-chat-inputs` §2）—— 导入线程的语义是**一次性摘要**，不是订阅。
 *
 * 这一组守的是契约**形状**上的那半边：`imported` 里只有"当时读到了什么"，没有任何
 * 能让后续读路径回头再读一次线程的东西（取舍 ③=A）。行为那半边由
 * `apps/api/tests/design-workbench/project-lifecycle.test.ts` 的 V57 断。
 */
describe("迭代 13：从对话导入的契约形状", () => {
  it("imported 只记「当时读到了什么」，不含任何订阅/挂靠开关", () => {
    const ok = { threadId: "th-1", title: "会员下单那条线", messageCount: 3, at: "2026-09-08T03:00:00.000Z" };
    expect(dw.ImportedThread.safeParse(ok).success).toBe(true);
    // ⭐ 反证锚点：给它加一个 `subscribed` / `live` 之类的开关 ⇒ 这条红。`.strict()` 在这里
    //    不是形式主义：多一个这样的字段就是把 §2.1 的 B 方案（长期挂靠）从后门放进来。
    expect(dw.ImportedThread.safeParse({ ...ok, subscribed: true }).success).toBe(false);
  });

  it("留痕那条对话记录的 source 是 system，与 fallback 分得开", () => {
    // `fallback` 的含义是「模型本该说话却没说成」；导入留痕压根不是模型的回合。
    expect(ai.AiReplySource.options).toContain("system");
    const turn = { role: "ai", text: "从线程《X》导入了 3 条消息作为背景。", at: "2026-09-08T03:00:00.000Z", source: "system" } as const;
    expect(dw.DesignProjectChatTurn.safeParse(turn).success).toBe(true);
  });

  it("importThread 的错误闭集里没有「线程看不见」——那是 chat 束的裸 404，连码都不给", () => {
    // 给它一个专属错误码，等于告诉调用方「这条线程存在但你不能看」，而 chat 束 I-3
    // 要求「看不见」与「不存在」在响应上分不开。
    expect([...dw.operations.importThread.err]).toEqual(["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"]);
    for (const code of dw.operations.importThread.err) {
      expect(dw.DesignWorkbenchError.options).toContain(code);
    }
  });
});

/* ─────────── 迭代 17：强调色档位的对比度门 ─────────── */

/** HSL 三元组字符串（"221 83% 41%"，与 globals.css 里 token 的写法同形）→ 相对亮度。 */
function relativeLuminance(hsl: string): number {
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(hsl.trim());
  if (m === null) throw new Error(`不是合法的 HSL 三元组：「${hsl}」`);
  const h = Number(m[1]) / 360;
  const sat = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const mm = l - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const rgb = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg]!.map((v) => v + mm);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("迭代 17：强调色是闭集，且每一档的对比度都验过", () => {
  it("每个档位（neutral 除外）都在 PROTOTYPE_ACCENTS 里有两套值，一个不漏", () => {
    // ⭐ 反证锚点：契约加了一个新档位却忘了给值 ⇒ 这条红（画布会渲染成"没有强调色"）。
    for (const a of dw.PrototypeAccent.options) {
      if (a === "neutral") continue;
      const tokens = dw.PROTOTYPE_ACCENTS[a];
      expect(tokens, `档位 ${a} 没有取值`).toBeDefined();
      expect(tokens.light.primary.length).toBeGreaterThan(0);
      expect(tokens.dark.primary.length).toBeGreaterThan(0);
    }
    expect(Object.keys(dw.PROTOTYPE_ACCENTS).sort()).toEqual(
      dw.PrototypeAccent.options.filter((a) => a !== "neutral").slice().sort(),
    );
  });

  it("按钮上的字读得出来：每一档的底色 ↔ 字色对比度 ≥ 4.5:1（浅色与深色画布各一套）", () => {
    /*
     * ⭐ 反证锚点：把任何一档的 `light.foreground` 改成和底色相近的值 ⇒ 这条红。
     *
     * 对比度是这套原语能看起来像成品的**前提**，不是锦上添花：按钮上的字读不清，
     * 再好的布局也白搭。档位存在的理由正是"每个取值都能被一次性验过并钉住"——
     * 换成自由色值，这条门就写不出来。
     */
    const bad: string[] = [];
    for (const [name, tokens] of Object.entries(dw.PROTOTYPE_ACCENTS)) {
      for (const theme of ["light", "dark"] as const) {
        const { primary, foreground } = tokens[theme];
        const ratio = contrast(primary, foreground);
        if (ratio < 4.5) bad.push(`${name}.${theme} = ${ratio.toFixed(2)}:1`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("迭代 19：线框图的灰阶走**同一条**对比度门（低保真不是「可以读不清」的借口）", () => {
    /*
     * ⭐ 反证锚点：把 dark 那套改回和 light 一样的灰 46% ⇒ 这条红。
     * 实测那个值当文字压在深色卡片上只有 3.65:1——而这些 token 正是被当文字用的
     * （底部导航当前项、info badge、列表勾）。
     */
    for (const theme of ["light", "dark"] as const) {
      const { primary, foreground } = dw.PROTOTYPE_WIREFRAME[theme];
      expect(contrast(primary, foreground), `线框图 ${theme} 的底色↔字色`).toBeGreaterThanOrEqual(4.5);
    }
    // 深色画布上的灰要更亮——与强调色同一条取向（照搬一套过去就会读不清）。
    expect(relativeLuminance(dw.PROTOTYPE_WIREFRAME.dark.primary))
      .toBeGreaterThan(relativeLuminance(dw.PROTOTYPE_WIREFRAME.light.primary));
  });

  it("浅色画布用深色块配白字、深色画布用亮色块配近黑字——不是同一套值照搬", () => {
    // 照搬一套到另一套，表现就是"在其中一种画布上一片糊"。这条钉住取向本身。
    for (const [name, tokens] of Object.entries(dw.PROTOTYPE_ACCENTS)) {
      const light = relativeLuminance(tokens.light.primary);
      const dark = relativeLuminance(tokens.dark.primary);
      expect(dark, `${name}：深色画布上的强调色该比浅色画布上的更亮`).toBeGreaterThan(light);
    }
  });
});

/* ───────────── 迭代 22：发布与分享——对外投影的字段闭集就是隐私边界 ───────────── */

describe("分享出去的那一份，字段是一个被钉死的闭集", () => {
  it("SharedDesign 的字段逐个列举——加一个字段而不动这里 ⇒ 红", () => {
    /*
     * ⭐ 反证锚点：把 `chat` 加进 `SharedDesign` ⇒ 这条红。
     *
     * 这条断言是「分享不会把对话带出去」这句承诺的**唯一**机械落点。没有它，那句话
     * 就只是文件头注里的一段中文——而本仓的结论是「没有脚本的规范条目视为未落地」。
     * 用 `omit` 派生会让新字段**默认跟着漏出去**；对一条公网可达的投影，默认方向必须反过来。
     */
    expect(Object.keys(dw.SharedDesign.shape).sort()).toEqual(
      [
        "accent", "criteria", "frameLinks", "frameNotes", "frames", "name",
        "ownerName", "problem", "prototype", "publishedAt", "template", "theme", "tokens",
      ].sort(),
    );
  });

  it("这些字段一个都不许在里面：对话、参考图、owner id、来源反馈、issue、推送态", () => {
    const leak = ["chat", "refImages", "ownerId", "id", "linkedFeedbackId", "githubIssueUrl", "githubIssueNumber", "pushed", "pushedAt", "tags", "share"];
    for (const k of leak) {
      expect(Object.keys(dw.SharedDesign.shape), `${k} 不该随分享链接出去`).not.toContain(k);
    }
  });

  it("scope 是闭集两档，默认那档是保守的那一档", () => {
    expect(dw.DesignShareScope.options).toEqual(["prototype", "full"]);
    // 契约层不写默认值（默认在用例层：从未发布过 ⇒ prototype），这里钉住"保守的那档排在前面"
    // 只是为了让 UI 的选项顺序有据可依；真正的默认由 `share-project.test.ts` 守。
    expect(dw.DesignShareScope.options[0]).toBe("prototype");
  });

  it("公开读操作是本束唯一一条 GET /public/... 路由，且错误闭集只有一个码", () => {
    expect(dw.operations.getSharedDesign.path.startsWith("/public/")).toBe(true);
    // ⭐ 反证锚点：给它加一个能区分"不存在 / 已取消发布"的第二个错误码 ⇒ 这条红。
    // 那正是给试令牌的人一个进度条。
    expect(dw.operations.getSharedDesign.err).toEqual(["SHARE_NOT_FOUND"]);
    const publicPaths = Object.values(dw.operations).filter((o) => o.path.startsWith("/public/"));
    expect(publicPaths).toHaveLength(1);
  });

  it("发布与取消发布走同一条路径的两个动词——一个项目只有一条链接", () => {
    expect(dw.operations.publishProject.path).toBe(dw.operations.unpublishProject.path);
    expect(dw.operations.publishProject.method).toBe("POST");
    expect(dw.operations.unpublishProject.method).toBe("DELETE");
  });
});

/* ─────────────── 对标 R1（#3933）：设计 token——任意品牌色与字体 ─────────────── */
describe("DesignTokens：品牌色与字体", () => {
  it("缺省值 = 这个字段之前的行为（不覆盖强调色、跟随产品字体）；老数据没有这个字段也能读", () => {
    expect(dw.DesignTokens.parse({})).toEqual({ brand: null, font: "sans" });
    expect(dw.DEFAULT_DESIGN_TOKENS).toEqual({ brand: null, font: "sans" });
    const legacy = dw.DesignProject.innerType().shape.tokens.parse(undefined);
    expect(legacy).toEqual(dw.DEFAULT_DESIGN_TOKENS);
  });

  it("品牌色只收 #RRGGBB；字体只收四档；多余的键拒", () => {
    expect(dw.BrandColor.safeParse("#FF5A1F").success).toBe(true);
    for (const bad of ["FF5A1F", "#F5A", "#FF5A1FAA", "orange", "#GG5A1F"]) expect(dw.BrandColor.safeParse(bad).success, bad).toBe(false);
    expect(dw.DesignTokens.safeParse({ font: "comic" }).success).toBe(false);
    expect(dw.DesignTokens.safeParse({ brand: null, font: "sans", sparkle: true }).success).toBe(false);
  });

  it("updateProject 收 token 的部分键（按键合并由仓储做），给 brand: null 是清掉", () => {
    const inSchema = dw.operations.updateProject.in;
    expect(inSchema.safeParse({ projectId: "p", tokens: { font: "serif" } }).success).toBe(true);
    expect(inSchema.safeParse({ projectId: "p", tokens: { brand: null } }).success).toBe(true);
    expect(inSchema.safeParse({ projectId: "p", tokens: { brand: "red" } }).success).toBe(false);
  });

  it("品牌色的底色逐字就是品牌色本身：#FF5A1F 回转成 rgb(255,90,31)", () => {
    const { primary } = dw.brandAccentTokens("#FF5A1F");
    const [h, sPct, lPct] = primary.split(" ").map((x) => Number.parseFloat(x));
    // 标准 HSL → RGB（与浏览器解析 `hsl()` 同一套公式）
    const sat = sPct! / 100; const lig = lPct! / 100;
    const k = (n: number) => (n + h! / 30) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    const f = (n: number) => Math.round(255 * (lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    expect([f(0), f(8), f(4)]).toEqual([255, 90, 31]);
  });

  it("⭐ 机械门：任意品牌色上的字对比度 ≥ 4.5（全色域每 17 级取样，4913 个色）", () => {
    /*
     * 反证锚点：把 `BRAND_FOREGROUND_DARK` 换回近黑 #111317 ⇒ 这条红（亮度 ≈ 0.18 的中间色上只有 ≈ 4.3）。
     * 这正是「放开任意品牌色」的代价——前景色不收用户输入，就得在这里证明它永远读得清。
     */
    const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
    let worst = { color: "", ratio: Infinity };
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      const color = `#${hex(r)}${hex(g)}${hex(b)}`;
      const fg = dw.brandAccentTokens(color).foreground === "0 0% 100%" ? dw.BRAND_FOREGROUND_LIGHT : dw.BRAND_FOREGROUND_DARK;
      const ratio = dw.contrastRatio(color, fg);
      if (ratio < worst.ratio) worst = { color, ratio };
    }
    expect(worst.ratio, `最差的是 ${worst.color}`).toBeGreaterThanOrEqual(4.5);
  });

  it("每档字体都有字体栈，sans 跟随产品字体（inherit）", () => {
    for (const f of dw.PrototypeFont.options) expect(dw.PROTOTYPE_FONT_STACKS[f]).toBeTruthy();
    expect(dw.PROTOTYPE_FONT_STACKS.sans).toBe("inherit");
    expect(dw.PROTOTYPE_FONT_STACKS.serif).toMatch(/serif$/);
  });
});
