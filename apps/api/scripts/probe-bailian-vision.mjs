#!/usr/bin/env node
/**
 * P2（#1561）—— 百炼（DashScope）**视觉输入**模型名探测脚本。
 *
 * ## 它为什么存在
 *
 * `configured-model-provider.ts` 的 `KERNEL_MODEL_VISION_IDS` 默认值
 * （`qwen-vl-max,qwen-vl-plus`）**没有在写下它的那个环境里实测过**——那台机器没有
 * `KERNEL_MODEL_API_KEY`。`bailian-image-provider.ts:14-15` 记着这件事上栽过的跟头：
 * `wanx2.2-t2i-plus` 报 "Model not exist"、`wanx2.1-t2i-plus` 才可用，
 * 「不要被"2.2 应该比 2.1 新"这种直觉带偏」。所以这个脚本的产物不是"我猜的名字"，
 * 而是「在有 key 的环境里跑一条命令，得到一份真实的可用/不可用清单」。
 *
 * ## 用法
 *
 *   KERNEL_MODEL_API_KEY=sk-xxx \
 *   KERNEL_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 \
 *   node apps/api/scripts/probe-bailian-vision.mjs [modelId,modelId,...]
 *
 * 不传 modelId 时探测下面的候选清单。它**真的会发一次带图的请求**（一张 1x1 的内嵌
 * PNG，见 `TINY_PNG_BASE64`），因为"模型名存在"与"这个模型吃得下 image_url part"是两件
 * 不同的事，只探前者会得到一个看着绿、实际不成立的结论。
 *
 * ## 它不做什么
 *
 * 不写任何文件、不改任何配置。结论要由跑它的人**读一眼输出**，再把通过的名字写进 env
 * （或改默认值并把这次实测记录写进 `configured-model-provider.ts` 的注释里）。
 * 让脚本自动改配置，就等于让一份没人看过的输出直接变成线上事实。
 */

const CANDIDATES = [
  // ⚠ 全部是**待验证候选**，不是已验证清单。顺序无含义，别把"排在前面"读成"更可能对"。
  "qwen-vl-max",
  "qwen-vl-plus",
  "qwen-vl-max-latest",
  "qwen2.5-vl-72b-instruct",
  "qwen2.5-vl-7b-instruct",
];

/** 1x1 透明 PNG。探的是"这个端点接不接 image_url part"，不是图像内容本身。 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const apiKey = process.env.KERNEL_MODEL_API_KEY ?? "";
const baseUrl = (process.env.KERNEL_MODEL_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1")
  .trim().replace(/\/+$/, "");

if (apiKey === "") {
  console.error("KERNEL_MODEL_API_KEY 未设置——这个脚本的全部意义就是打真实端点，没有 key 时它没有任何可信输出。");
  process.exit(2);
}

const models = (process.argv[2] ?? "").trim() !== ""
  ? process.argv[2].split(",").map((m) => m.trim()).filter((m) => m !== "")
  : CANDIDATES;

console.log(`base_url = ${baseUrl}`);
console.log(`探测 ${models.length} 个候选模型名，每个发一次带 1x1 PNG 的多模态请求。\n`);

const results = [];
for (const model of models) {
  const started = Date.now();
  let verdict;
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: "You are a probe." },
          {
            role: "user",
            content: [
              { type: "text", text: "Reply with the single word: ok" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } },
            ],
          },
        ],
      }),
    });
    const bodyText = await response.text();
    if (response.ok) {
      let content = "";
      try {
        content = JSON.parse(bodyText)?.choices?.[0]?.message?.content ?? "";
      } catch { content = "(响应不是 JSON)"; }
      verdict = { ok: true, note: `HTTP 200，回复：${String(content).slice(0, 60)}` };
    } else {
      // 探测脚本里**故意**把上游原文打出来（与 provider 的"错误文本一个字都不外泄"纪律
      // 相反）：这是本机手动运行的诊断工具，输出只给运行它的人看，而"Model not exist"
      // 与"权限不足"必须分得开，否则这次探测的结论就是错的。
      verdict = { ok: false, note: `HTTP ${response.status}：${bodyText.slice(0, 300)}` };
    }
  } catch (e) {
    verdict = { ok: false, note: `传输失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const ms = Date.now() - started;
  results.push({ model, ...verdict, ms });
  console.log(`${verdict.ok ? "✅ 可用" : "❌ 不可用"}  ${model}  (${ms}ms)\n    ${verdict.note}\n`);
}

const usable = results.filter((r) => r.ok).map((r) => r.model);
console.log("──────── 结论 ────────");
if (usable.length === 0) {
  console.log("没有一个候选可用。不要把任何一个名字写进 KERNEL_MODEL_VISION_IDS——");
  console.log("宁可让部署保持『没有视觉模型』（诚实降级，模型会明说自己看不到图），");
  console.log("也不要配一个探测失败的名字（那会让每个带图的 run 以 MODEL_CALL_FAILED 结束）。");
  process.exit(1);
}
console.log(`实测可用：${usable.join(", ")}`);
console.log(`把它写进部署 env：KERNEL_MODEL_VISION_IDS=${usable.join(",")}`);
