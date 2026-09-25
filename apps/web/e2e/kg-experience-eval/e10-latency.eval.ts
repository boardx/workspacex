/**
 * E10 不卡顿（06-UX R4 / R3-8）：开启记忆前后，发消息到首字的时间差 ≤ 100ms；图或向量故障时对话照常，只多一行说明。
 *
 * - c1 首字时间：同一条栈、同样的问题，交替各问 5 次，取中位数之差。
 *   「开启记忆」= 主用户在一个记了 7 条事的对话里问（每轮都要召回、走图、把记忆交给模型）；
 *   「没有记忆」= 对照账号在一个什么都没说过的对话里问（召回每轮照样执行，但候选为空、不走图）。
 *   产品没有「关掉记忆」的开关，所以这是能在真栈里量到的最接近「开启前后」的一对；两边的差就是记忆这一段的开销。
 *   「首字」= 按下回车到回答那一行出现第一个字（浏览器里看到的，不是接口时间）。
 * - c2 图路故障：在库里把图路查询函数挪开（真的让它不可用），问一个会走图的问题：回答照常出来、答得上，
 *   回答下方多且只多一行「这次没能查全你的记忆…」。之后把函数挪回来。
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { newThread, say, tell } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;
const QUESTIONS = ["北极星项目的负责人是谁？", "恒通物流那边的对接人是谁？", "设计稿由谁负责？", "北极星的技术负责人是谁？", "恒通物流的合同金额是多少？"];
const DEGRADED = "这次没能查全你的记忆";

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? NaN : s[Math.floor(s.length / 2)]!; };

/** 以库的属主身份执行一句 SQL（只在评测栈的库上：PGDATABASE 由调用方给）。 */
function psql(sql: string): void {
  execFileSync("psql", ["-h", process.env.PGHOST ?? "127.0.0.1", "-p", process.env.PGPORT ?? "55432", "-U", "postgres", "-d", process.env.PGDATABASE!, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "pipe" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  j = await runJourney("E10", browser, async (ctx) => {
    ctx.step("主用户：一个记了几件事的对话");
    const on = await ctx.pageAs(KG_EVAL.owner);
    await on.goto("/chat");
    const onThread = await newThread(on);
    await tell(on, onThread, ["M1", "M2", "M3"]);
    ctx.step("对照账号：一个空对话");
    const off = await ctx.pageAs(KG_EVAL.idle);
    await off.goto("/chat");
    await newThread(off);
    // 各先热身一轮（首次编译 / 连接池），不计入。
    await say(on, "你好");
    await say(off, "你好");
    const onMs: number[] = [];
    const offMs: number[] = [];
    for (const q of QUESTIONS) {
      ctx.step(`首字计时：${q}`);
      onMs.push((await say(on, q)).firstTokenMs);
      offMs.push((await say(off, q)).firstTokenMs);
    }
    ctx.see("latency", { onMs, offMs, onMedian: median(onMs), offMedian: median(offMs) });

    ctx.step("让图路不可用，再问一个会走图的问题");
    try {
      psql("ALTER FUNCTION kg_graph_neighbors(text[]) RENAME TO kg_graph_neighbors__f15_fault");
      const turn = await say(on, "恒通物流那边的对接人是谁？");
      const block = turn.answer.locator("xpath=..");
      await block.getByTestId("kg-answer-footer").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      const lines = await block.getByText(DEGRADED).count();
      ctx.see("graphDown", { answer: turn.text, degradedLines: lines });
      await ctx.shot("graph-down", block);
    } finally {
      psql("ALTER FUNCTION kg_graph_neighbors__f15_fault(text[]) RENAME TO kg_graph_neighbors");
    }
  });
});

test("[E10.c1] 发消息到首字：有记忆比没有记忆慢不超过 100ms（中位数）", async ({}, testInfo) => {
  await attach(testInfo, j, [], { latency: j.seen.latency ?? null });
  const l = seen<{ onMedian: number; offMedian: number }>(j, "latency");
  expect(l.onMedian - l.offMedian).toBeLessThanOrEqual(100);
});

test("[E10.c2] 图路故障：回答照常出来、答得上，只多一行「这次没能查全你的记忆」", async ({}, testInfo) => {
  await attach(testInfo, j, ["graph-down"], { graphDown: j.seen.graphDown ?? null });
  const g = seen<{ answer: string; degradedLines: number }>(j, "graphDown");
  expect(g.answer).toContain("陈静");
  expect(g.degradedLines).toBe(1);
});
