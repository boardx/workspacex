import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { PLAN_CONFIRMATION_TOOL_NAME } from "@repo/contracts/plan-control";
import { buildDeepAgentSkillCatalogBlock } from "../../src/application/agent-run/skill-catalog";

/**
 * 不起监听端口、不起进程、不起 Docker，直接驱动替身脚本自己的 handler。
 *
 * issue #3100 D6 —— 这个 fixture 此前是 `loopback-initial-state-unit.test.ts` 的私有函数。
 * 第二个套件（`loopback-spawn-async-task.test.ts`）要在同一条被测面上取证，抄一份 =
 * 「同一事实声明在两处」，所以抽成共享模块，两边 import 同一份。
 *
 * `fetchImpl` 是新增的可选项：替身的 `spawn_async_task` 会真的发一次 HTTP POST
 * （与 `deep_agent_service/tools.py` 同一条线格式），vm 上下文默认没有 `fetch`，
 * 由调用方注入一个记录型替身，以便对**请求字节本身**做断言。缺省不注入 —— 于是
 * 没有回调配置的路径（不该发请求）一旦真的发了请求，会以 ReferenceError 露馅。
 */
export function fixture(extraEnv: Record<string, string> = {}, fetchImpl?: typeof globalThis.fetch) {
  let handle: (request: unknown, response: unknown) => void;
  const server = { listen: () => {}, close: () => {} };
  const source = readFileSync(new URL("../../scripts/loopback-deep-agent-provider.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    // 替身用 `setInterval` 驱动 SSE 帧节奏（十步滚动剧本的推进游标就挂在上面），
    // vm 上下文默认没有计时器——不给它就等于把「节奏」这件事从被测面里删掉。
    setInterval, clearInterval, setTimeout, clearTimeout, Date, JSON, Math,
    // issue #3100 D6：只有注入了才存在——见本函数头注最后一段。
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl, AbortSignal }),
    exports: {}, process: {env: {LOOPBACK_DEEP_AGENT_PROVIDER_PORT: "9999", LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: "multistep", ...extraEnv}, once: () => {}},
    require: (name: string) => {
      if (name === "node:http") return {createServer: (callback: typeof handle) => { handle = callback; return server; }};
      if (name === "node:crypto") return {randomUUID};
      if (name === "@repo/contracts/deep-agent-hitl") return {DEEP_AGENT_HITL_TOOL_NAME};
      // 路径矩阵 D4：替身判定「skill 目录块」时从产品源码取那一行头，不在替身里抄第二份
      // 字面量（同上面 `DEEP_AGENT_HITL_TOOL_NAME` 那条既有理由：允许分叉就等于允许静默
      // 假绿）。这个 shim 是白名单，新增依赖必须显式列进来——本条正是那个显式动作。
      if (name === "../src/application/agent-run/skill-catalog") return {buildDeepAgentSkillCatalogBlock};
      // issue #3132（B7）：替身要演计划确认门，工具名同样从契约取，不在替身里抄第二份
      // 字面量——与上面两条同一条理由。这一行就是白名单要求的那个显式动作。
      if (name === "@repo/contracts/plan-control") return {PLAN_CONFIRMATION_TOOL_NAME};
      throw new Error(`unexpected fixture dependency: ${name}`);
    },
  });
  const request = (method: string, url: string, body?: unknown): Promise<any> => new Promise(resolve => {
    const incoming = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {method, url});
    const response = {writeHead: () => response, end: (text: string) => resolve(JSON.parse(text))};
    handle(incoming, response);
  });
  /** SSE 形态的响应替身：帧留在数组里，流不结束也能被观察——正是本文件要证的那件事。 */
  const openStream = (url: string) => {
    const frames: string[] = [];
    let ended = false;
    const incoming = Object.assign(Readable.from([]), {method: "GET", url, on: () => incoming});
    const response = {
      writeHead: () => response,
      write: (chunk: string) => { frames.push(chunk); return true; },
      end: () => { ended = true; },
      destroy: () => { ended = true; },
    };
    handle(incoming, response);
    return {frames, isEnded: () => ended};
  };
  return Object.assign(request, {openStream});
}

