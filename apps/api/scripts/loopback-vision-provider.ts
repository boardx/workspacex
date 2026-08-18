#!/usr/bin/env node
/**
 * #1560 P1 e2e —— 确定性的百炼（DashScope）多模态视觉理解上游替身。
 *
 * ## 为什么需要它，而不是直接打真实 `https://dashscope.aliyuncs.com`
 *
 * `BailianVisionExtractor`（`apps/api/src/infrastructure/chat/bailian-vision-extractor.ts`）
 * 复用与聊天模型**同一把** `KERNEL_MODEL_API_KEY`（文件头注「使用相同的登录API tok就可以使用
 * 所有的阿里云百炼平台的模型」）。`playwright.chat-read.config.ts` 里这把 key 早已是一个
 * **非空的占位字符串**（`chat-read-loopback-key-not-a-secret`，供聊天 `loopback-model-provider.ts`
 * 判定「已配置」用）——如果不显式改 `KERNEL_VISION_BASE_URL`，视觉端口会把这同一把假 key
 * 真的发去 `https://dashscope.aliyuncs.com`，让本该是「确定性回环」的 e2e 悄悄依赖真实外网、
 * 真实第三方服务的可用性与限流策略（本仓另一处正是因为这类不确定性——`next/font/google`——
 * 把 fullstack-smoke 的 web 构建改成了完全离线的 mock，见 `playwright.fullstack-smoke.config.ts`
 * 里 `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` 那段头注，同一条哲学延伸到这里）。
 *
 * 与 `loopback-model-provider.ts` / `loopback-asr-provider.ts` / `loopback-deep-agent-provider.ts`
 * 同一套纪律：**不是 mock fallback**——`BailianVisionExtractor` 是真实代码路径、真实 HTTP，
 * 只是上游换成了这个可预测的本地进程；它必须被显式选中（`KERNEL_VISION_BASE_URL` 指到这里）
 * 才会被用到，缺席时 `readBailianVisionConfig()` 落回真实 DashScope 域名。
 *
 * ## 本进程只做一件事：如实回「这把 key 无效」
 *
 * 本机（以及这条 e2e 链路）**没有真实的百炼视觉 key**——这正是 #1560 P1 要证的诚实降级路径。
 * 响应体逐字照抄真实 DashScope 对无效 key 的实测响应（本轮开发用 curl 打真实端点验证过，见
 * issue #1560 P1 e2e 补充评论），`bailian-vision-extractor.ts` 的 `classifyHttpFailure` 只认
 * HTTP 状态码 401/403 归 `visionNotConfigured`，不解析 body 文本作为判据——这里带上真实字段
 * 只是为了「回环上游的响应形状与真实上游一致」，不是断言依赖它。
 */
import { createServer } from "node:http";

const port = Number(process.env.LOOPBACK_VISION_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("LOOPBACK_VISION_PROVIDER_PORT must be a positive integer");
}

function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
    res.writeHead(404).end();
    return;
  }
  void readBody(req).then(() => {
    // 真实 DashScope 对一把无效/伪造 key 的实测响应形状（401 + `InvalidApiKey`）。
    // `classifyHttpFailure(401, …)` 只看状态码就归 `visionNotConfigured`，本体只是求真。
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({
      code: "InvalidApiKey",
      message: "Invalid API-key provided.",
    }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-vision-provider] listening on 127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
