#!/usr/bin/env node
/**
 * #1560 · P1 —— 视觉模型名**实测探测器**（要有真 key 才能跑）。
 *
 * 为什么需要它：`bailian-image-provider.ts:14-15` 记着的教训——`wanx2.2-t2i-plus` 报
 * "Model not exist"、`wanx2.1-t2i-plus` 才可用。模型名只能实测，不能抄文档、不能按版本号直觉猜。
 * 写 `BailianVisionExtractor` 的开发机上**没有** `KERNEL_MODEL_API_KEY`，所以代码里的默认模型名
 * (`qwen-vl-max`) 是**未经实测**的占位值。这支脚本把"去实测"变成一条命令。
 *
 * 用法（在有 key 的环境）：
 *     KERNEL_MODEL_API_KEY=sk-xxx node apps/api/scripts/probe-vision-model.mjs
 *     # 也可只探一个名字：… node apps/api/scripts/probe-vision-model.mjs qwen-vl-plus
 *
 * 它对每个候选发一张**内置的 1x1 PNG**（不上传任何真实业务图片），打印：
 *     ✓ 可用 / ✗ 模型不存在或无权 / ✗ 其它失败（原样打 HTTP 状态与上游 message）
 * 把输出**原样**贴回 issue #1560，并把实测可用的名字写进 `KERNEL_VISION_MODEL_ID`。
 *
 * 本脚本不修改任何文件、不写库——只发只读性质的探测请求。
 */

const BASE_URL = (process.env.KERNEL_VISION_BASE_URL ?? "").trim() || "https://dashscope.aliyuncs.com";
const API_KEY = process.env.KERNEL_MODEL_API_KEY ?? "";

/** 候选模型名——**全部都是待验证的候选**，这张表不声称任何一个可用。 */
const CANDIDATES = [
  "qwen-vl-max",
  "qwen-vl-max-latest",
  "qwen-vl-plus",
  "qwen-vl-plus-latest",
  "qwen2.5-vl-72b-instruct",
  "qwen2.5-vl-7b-instruct",
];

/** 1x1 透明 PNG（base64）——最小合法图片，够触发"模型名对不对/有没有视觉能力"这两件事。 */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function probe(model) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model,
        input: {
          messages: [{
            role: "user",
            content: [{ image: `data:image/png;base64,${TINY_PNG}` }, { text: "这张图里有什么？" }],
          }],
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return { model, ok: false, verdict: "网络/超时", detail: String(e) };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    const content = body?.output?.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((c) => (typeof c === "string" ? c : c?.text)).filter(Boolean).join(" ")
      : (typeof content === "string" ? content : body?.output?.text ?? "");
    return { model, ok: true, verdict: "可用", detail: String(text).slice(0, 120) };
  }
  return {
    model, ok: false,
    verdict: `HTTP ${res.status}`,
    detail: `${body?.code ?? ""} ${body?.message ?? ""}`.trim(),
  };
}

async function main() {
  if (API_KEY === "") {
    console.error("KERNEL_MODEL_API_KEY 未设置——本脚本必须用真 key 跑，没有 key 时不做任何猜测性输出。");
    process.exit(2);
  }
  const models = process.argv.slice(2);
  const targets = models.length > 0 ? models : CANDIDATES;
  console.log(`探测端点：${BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`);
  console.log(`候选 ${targets.length} 个（结果请原样贴回 issue #1560）\n`);
  const results = [];
  for (const model of targets) {
    const r = await probe(model);
    results.push(r);
    console.log(`${r.ok ? "✓" : "✗"} ${model.padEnd(28)} ${r.verdict}  ${r.detail}`);
  }
  const usable = results.filter((r) => r.ok).map((r) => r.model);
  console.log("");
  if (usable.length === 0) {
    console.log("没有候选可用。不要因此改代码去猜别的名字——先看上游 message 判断是 key 问题还是名字问题。");
    process.exit(1);
  }
  console.log(`实测可用：${usable.join(", ")}`);
  console.log(`把其中一个写进部署环境：KERNEL_VISION_MODEL_ID=${usable[0]}`);
}

await main();
