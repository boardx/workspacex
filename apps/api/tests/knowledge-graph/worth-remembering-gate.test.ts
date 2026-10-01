/**
 * S8（#4365）——「值得记」前置门控：规则（纯函数）+ 应用层（便宜模型可选、默认关）+ 抽取一轮里的接线。
 *
 * 最要紧的一条（#4365「门控不误杀目标、偏好、决定（黄金集回归）」）：S3 的本人意向句子与 decision-claim 测试里的决定句子
 * **一条都不许被跳过**——黄金集直接从那两个测试文件里读出来（不抄第二份：那边新增的句子自动进这里的回归）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gateExtraction, type WorthinessModelPort } from "../../src/application/knowledge-graph/extraction-gate";
import { ExtractionSloRecorder } from "../../src/application/knowledge-graph/extraction-slo-recorder";
import { runExtractionTick, type ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import type { KgExtractionJob, KgMessage } from "../../src/application/knowledge-graph/ports";
import { decisionLike } from "../../src/domain/knowledge-graph/decision-claim";
import { selfIntentLike } from "../../src/domain/knowledge-graph/self-intent-claim";
import { judgeWorthRemembering, protectionOf } from "../../src/domain/knowledge-graph/worth-remembering";
import { toOrgId } from "../../src/domain/org-id";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** 从测试文件里取出所有带汉字的字符串字面量（it.each 的表格、常量）。 */
function phrasesIn(file: string): string[] {
  const src = readFileSync(`${HERE}/${file}`, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`$\n]*)`/g)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\"/g, "\"");
    // 去掉 describe / it 的标题（带 ⇒ / %s / 全角括号或冒号）；其余带汉字的字面量——包括负例的原因词——都进黄金集（多测无害）。
    if (/\p{Script=Han}/u.test(s) && !/⇒|%s|（|：/.test(s)) out.add(s);
  }
  return [...out];
}

const SELF_INTENT_GOLDEN = phrasesIn("self-intent-claim.test.ts");
const DECISION_GOLDEN = phrasesIn("decision-claim.test.ts");

describe("#4365 黄金集：目标 / 偏好 / 决定永远不跳过", () => {
  it("黄金集确实读到了（防止正则悄悄读空，回归变成空跑）", () => {
    expect(SELF_INTENT_GOLDEN).toEqual(expect.arrayContaining([
      "我的目标是探索未来教育", "我想今年把英语考到雅思 7 分", "我希望团队周报每周五发出", "我更喜欢简洁的回答", "我倾向于先看数据再下结论",
    ]));
    expect(DECISION_GOLDEN).toEqual(expect.arrayContaining([
      "张三决定下周一上线 v2", "我决定关注在 211 高校", "预算定为 500 万", "会上敲定了排期", "这个方向确定了吗？", "v2 上线时间还没决定",
    ]));
    expect(SELF_INTENT_GOLDEN.length + DECISION_GOLDEN.length).toBeGreaterThan(50);
  });

  it.each([...SELF_INTENT_GOLDEN, ...DECISION_GOLDEN])("「%s」⇒ 不跳过", (phrase) => {
    expect(judgeWorthRemembering(phrase).verdict).toBe("extract");
  });

  it.each([
    ["我的目标是探索未来教育", "self_intent"],
    ["我更喜欢简洁的回答", "self_intent"],
    ["好的，我决定下周上线", "decision"],
    ["预算定为 500 万吗？", "decision"],
    ["谢谢，记住我不吃辣", "memory_instruction"],
    ["hi, I prefer short answers", "self_intent"],
    ["ok, we decided to ship on Friday", "decision"],
  ] as const)("「%s」受保护（%s）：看起来像寒暄 / 应答 / 问句也放行", (phrase, why) => {
    expect(protectionOf(phrase)).toBe(why);
    expect(judgeWorthRemembering(phrase)).toEqual({ verdict: "extract", protectedBy: why });
  });
});

describe("#4365 规则：只跳过整条完全落在三类里的", () => {
  it.each([
    ["你好", "greeting"], ["您好！", "greeting"], ["谢谢", "greeting"], ["谢谢你啦～", "greeting"], ["早上好", "greeting"],
    ["Hi!", "greeting"], ["thanks", "greeting"], ["辛苦了，再见", "greeting"], ["拜拜 👋", "greeting"],
    ["好的", "acknowledgement"], ["嗯嗯", "acknowledgement"], ["收到！", "acknowledgement"], ["OK", "acknowledgement"],
    ["好的，明白了", "acknowledgement"], ["👍", "acknowledgement"], ["没问题", "acknowledgement"], ["好的谢谢", "acknowledgement"],
    ["项目什么时候上线？", "pure_question"], ["这个怎么用？", "pure_question"], ["你能帮我看看吗", "pure_question"],
    ["What is the plan?", "pure_question"],
  ] as const)("「%s」⇒ 跳过（%s）", (phrase, reason) => {
    expect(judgeWorthRemembering(phrase)).toEqual({ verdict: "skip", reason });
  });

  it.each([
    ["好的，下周三我们在上海开会", "应答后面跟了实质内容"],
    ["项目A 9/29 上线吗？", "问句里带数字（可以记的数）"],
    ["预算是 50 万对吗？", "求证式问句：在断言内容"],
    ["我们下周上线。预算够吗？", "问句前还有一句陈述"],
    ["北京", "很短但不是应答词（回答上一句「你在哪个城市」时是有用的）"],
    ["张三负责测试", "普通陈述"],
    ["", "空消息交给模型，不猜（触发器本来不排）"],
    ["好的，我记下了。", "「记下」是记忆指令词（宁可多放）"],
  ] as const)("「%s」⇒ 放行（%s）", (phrase, _why) => {
    expect(judgeWorthRemembering(phrase).verdict).toBe("extract");
  });
});

const job: KgExtractionJob = { orgId: toOrgId("org-s8-gate"), messageId: "m1", threadId: "t1", attempts: 1 };
const msg = (body: string): { message: KgMessage; context: KgMessage[] } =>
  ({ message: { id: "m1", threadId: "t1", body, authorKind: "human" }, context: [] });
function logger() {
  const lines: { level: string; msg: string; data: Record<string, unknown> }[] = [];
  return {
    lines,
    info: (m: string, d?: Record<string, unknown>) => { lines.push({ level: "info", msg: m, data: d ?? {} }); },
    error: (m: string, d?: Record<string, unknown>) => { lines.push({ level: "error", msg: m, data: d ?? {} }); },
    warn: (m: string, d?: Record<string, unknown>) => { lines.push({ level: "warn", msg: m, data: d ?? {} }); },
  };
}

describe("#4365 应用层门控：可选的便宜模型", () => {
  it("规则跳过 ⇒ 记一条带原因的结构化日志 + 计「省下的调用」，不问模型", async () => {
    const log = logger();
    const slo = new ExtractionSloRecorder();
    let asked = 0;
    const gateModel: WorthinessModelPort = { worthRemembering: async () => { asked += 1; return true; } };
    expect(await gateExtraction({ logger: log as never, slo, gateModel }, job, msg("谢谢！"))).toEqual({ gate: "skip", reason: "greeting" });
    expect(asked).toBe(0);
    expect(log.lines).toEqual([expect.objectContaining({
      level: "info", msg: "kg extraction skipped: not worth remembering",
      data: expect.objectContaining({ reason: "greeting", messageId: "m1", modelCallSaved: true }),
    })]);
    expect(slo.gate()).toMatchObject({ modelCallsSaved: 1, skippedByReason: { greeting: 1 } });
  });

  it("目标 / 偏好 / 决定（按 S3 selfIntentLike 与 decisionLike 自己的判定，外加所有提到目标 / 偏好的句子）永远不问模型——模型说 NO 也没用", async () => {
    let asked = 0;
    const gateModel: WorthinessModelPort = { worthRemembering: async () => { asked += 1; return false; } };
    const intents = [...SELF_INTENT_GOLDEN, ...DECISION_GOLDEN].filter((p) =>
      selfIntentLike("goal", p) || selfIntentLike("preference", p) || decisionLike(p) || /目标|偏好|喜欢|决定|确定|定为/.test(p));
    expect(intents.length).toBeGreaterThan(25);
    for (const p of intents) {
      expect((await gateExtraction({ logger: logger() as never, gateModel }, job, msg(p))).gate, p).toBe("extract");
    }
    expect(asked).toBe(0);
  });

  it("未受保护、规则放行 ⇒ 问模型；模型说 NO ⇒ 跳过（model_not_worth）", async () => {
    const slo = new ExtractionSloRecorder();
    const gateModel: WorthinessModelPort = { worthRemembering: async () => false };
    expect(await gateExtraction({ logger: logger() as never, slo, gateModel }, job, msg("今天天气不错")))
      .toEqual({ gate: "skip", reason: "model_not_worth" });
    expect(slo.gate()).toMatchObject({ gateModelChecks: 1, gateModelErrors: 0, skippedByReason: { model_not_worth: 1 } });
  });

  it("模型出错 ⇒ error 日志带错误码、计数，照常抽取（不是静默跳过）", async () => {
    const log = logger();
    const slo = new ExtractionSloRecorder();
    const gateModel: WorthinessModelPort = { worthRemembering: async () => { throw new Error("provider down"); } };
    expect(await gateExtraction({ logger: log as never, slo, gateModel }, job, msg("张三负责测试")))
      .toEqual({ gate: "extract", protectedBy: null });
    expect(log.lines).toEqual([expect.objectContaining({ level: "error", data: expect.objectContaining({ code: "KG_GATE_MODEL_FAILED" }) })]);
    expect(slo.gate()).toMatchObject({ gateModelChecks: 1, gateModelErrors: 1, modelCallsSaved: 0 });
  });
});

describe("#4365 抽取一轮里的接线：跳过的不调抽取模型，任务照常完成", () => {
  it("寒暄 / 应答 / 纯提问 ⇒ 不调抽取模型、出队、计 skipped；目标 ⇒ 调模型", async () => {
    const bodies: Record<string, string> = { a: "你好！", b: "好的", c: "这个怎么用？", d: "我的目标是探索未来教育" };
    const extracted: string[] = [];
    const completed: string[] = [];
    const slo = new ExtractionSloRecorder();
    const deps = {
      queue: {
        pendingOrgs: async () => [job.orgId],
        claim: async () => Object.keys(bodies).map((id) => ({ ...job, messageId: id })),
        complete: async (_o: unknown, id: string) => { completed.push(id); },
        fail: async () => undefined,
      },
      source: {
        loadMessage: async (_o: unknown, id: string) => ({ message: { id, threadId: "t1", body: bodies[id]!, authorKind: "human" as const }, context: [] }),
        knownObjects: async () => [],
        projectAnswerOutsideRecallCount: async () => 0,
      },
      extractor: { extract: async (x: { message: KgMessage }) => { extracted.push(x.message.id); return { entities: [], claims: [] }; } },
      store: {} as never, conflicts: {} as never, autoCopy: {} as never, logger: logger() as never, newId: (p: string) => `${p}-1`, slo,
    } as unknown as ExtractionDeps;
    const tick = await runExtractionTick(deps);
    expect(extracted).toEqual(["d"]);
    expect(completed.sort()).toEqual(["a", "b", "c", "d"]);
    expect(tick).toEqual({ processed: 4, written: 0, empty: 1, skipped: 3, failed: 0 });
    expect(slo.gate()).toMatchObject({ modelCallsSaved: 3, modelCalls: 1, skippedByReason: { greeting: 1, acknowledgement: 1, pure_question: 1 } });
    expect(slo.window()).toMatchObject({ processed: 4, modelJobs: 1, failed: 0 });
  });
});
