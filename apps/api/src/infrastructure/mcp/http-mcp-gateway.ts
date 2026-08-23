/**
 * issue #1849 —— `McpGateway`（`application/mcp/ports.ts`）第一个真正说 MCP 协议的实现。
 *
 * ## 范围：只做 remote transport（HTTP/SSE，即官方 SDK 的 `StreamableHTTPClientTransport`）
 *
 * ⚠ **不起本地子进程、不执行任何命令行**——stdio transport 明确留给后续单独迭代（会有
 *   更完整的白名单/沙箱设计）。本文件连接的永远是一个已经在别处运行、由管理员填入
 *   `https://` URL 指向的远程服务器。
 *
 * ## 只抛 `ports.ts` 允许的那两种错误
 *
 * `McpGateway.listTools` 的文档逐字写着"拒绝时只能是这两种错误之一"。SSRF 字面量校验
 * （`assertMcpEndpointAllowed`）失败时，从这个端口的视角看就是"这个端点我们不会去连"——
 * 与真正连不上没有本质区别，都映射成 `McpServerUnreachableError`；DNS 解析后的第二道门
 * （`guarded-fetch.ts` 里的 `checkAddress`）拒绝时同理。超时才映射成
 * `McpDiscoveryTimeoutError`——两者是不同的失败模式，UC-21.1 R9 要求能区分"答不上来"
 * 和"10 秒内没答完"。
 *
 * ## `sideEffect` 从哪来（domain AR2 标注为未裁的那个问题，这里给出实现选择）
 *
 * MCP 规范里工具的 `annotations` 是**握手层的提示**（`readOnlyHint` / `openWorldHint` 等），
 * 规范原文明确"客户端不应仅凭这些提示做出工具使用决策"——但发现阶段不是"要不要调用"，
 * 是"给它一个初始 `sideEffect` 分类，供 `checkToolScopeCap` 后续封顶"，语义不同。
 * ⚠ **保守默认**：没有 `readOnlyHint: true` 就不当它只读——默认落在 `写入外部`
 *   （最窄的授权范围上限），而不是默认 `只读`（最宽的上限）。一个诚实但没有标注
 *   `annotations` 的服务器，与一个隐瞒副作用的服务器，从这里的角度看不出区别，
 *   所以对未知一律按"更危险"处理，而不是按"更方便"处理。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError, type Tool as McpSdkTool } from "@modelcontextprotocol/sdk/types.js";
import {
  McpDiscoveryTimeoutError,
  McpServerUnreachableError,
  type DiscoveredTool,
  type McpGateway,
} from "../../application/mcp/ports";
import {
  assertMcpEndpointAllowed,
  McpEndpointRefusedError,
  type McpEndpointPolicy,
} from "../../domain/mcp/remote-endpoint-guard";
import { createGuardedFetch, GuardedFetchRefusedError, type GuardedFetchSeams } from "./guarded-fetch";

const CLIENT_NAME = "workspacex-mcp-client";
const CLIENT_VERSION = "1.0.0";

/** UC-21.1 R9 -- "答内 10s 或明确失败,绝不挂起". */
export const DEFAULT_MCP_DISCOVERY_TIMEOUT_MS = 10_000;

export interface HttpMcpGatewayDeps {
  /** `null` = 匿名连接;非空时作为 `Authorization: Bearer <credential>` 发给远程服务器。 */
  readonly credential: string | null;
  readonly policy: McpEndpointPolicy;
  readonly timeoutMs?: number;
  /** 测试接缝——生产装配从不传它,只有对着回环地址的测试替身会传。 */
  readonly seams?: GuardedFetchSeams;
}

function sideEffectOf(tool: McpSdkTool): DiscoveredTool["sideEffect"] {
  const a = tool.annotations;
  if (a?.readOnlyHint === true) return "只读";
  if (a?.openWorldHint === true) return "对外发送";
  return "写入外部";
}

/**
 * 从 JSON Schema 形状的 `inputSchema` 渲染出一个确定性的签名字符串,供
 * `discoverMcpTools` 的指纹比对使用。属性名排序是为了让同一份 schema 无论 JS 引擎
 * 按什么顺序枚举 key 都产出同一个签名——否则每次重新发现都可能误报"签名变了"。
 */
function signatureOf(tool: McpSdkTool): string {
  const properties = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const params = Object.keys(properties)
    .sort()
    .map((key) => `${key}${required.has(key) ? "" : "?"}`)
    .join(", ");
  const returns = tool.outputSchema ? "object" : "unknown";
  return `${tool.name}(${params}) -> ${returns}`;
}

export function createHttpMcpGateway(deps: HttpMcpGatewayDeps): McpGateway {
  return {
    async listTools(serverId, endpoint) {
      const timeoutMs = deps.timeoutMs ?? DEFAULT_MCP_DISCOVERY_TIMEOUT_MS;

      let url: URL;
      try {
        url = assertMcpEndpointAllowed(endpoint, deps.policy);
      } catch (refusal) {
        if (refusal instanceof McpEndpointRefusedError) {
          throw new McpServerUnreachableError(serverId);
        }
        throw refusal;
      }

      const guardedFetch = createGuardedFetch({ connectTimeoutMs: timeoutMs, seams: deps.seams });
      const transport = new StreamableHTTPClientTransport(url, {
        fetch: guardedFetch,
        requestInit:
          deps.credential !== null
            ? { headers: { authorization: `Bearer ${deps.credential}` } }
            : undefined,
      });
      const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });

      try {
        await client.connect(transport, { timeout: timeoutMs });
        const result = await client.listTools(undefined, { timeout: timeoutMs });
        return result.tools.map(
          (tool): DiscoveredTool => ({
            name: tool.name,
            signature: signatureOf(tool),
            sideEffect: sideEffectOf(tool),
          }),
        );
      } catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
          throw new McpDiscoveryTimeoutError(serverId);
        }
        if (isAbortTimeoutError(error)) {
          throw new McpDiscoveryTimeoutError(serverId);
        }
        // SSRF 拒绝（连接层，即第二道门）与"服务器就是连不上"在这个端口的视角下
        // 是同一种失败——见文件头注。
        if (isGuardedFetchRefusal(error)) {
          throw new McpServerUnreachableError(serverId);
        }
        throw new McpServerUnreachableError(serverId);
      } finally {
        await client.close().catch(() => {});
      }
    },
  };
}

/** undici 在 `bodyTimeout`/`headersTimeout`/连接超时命中时抛的是它自己的 `TimeoutError` 家族。 */
function isAbortTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error.name === "HeadersTimeoutError" ||
    error.name === "BodyTimeoutError" ||
    error.name === "ConnectTimeoutError"
  );
}

/** `guardedLookup` 把 SSRF 拒绝包成 `GuardedFetchRefusedError` 抛出 undici 的 `lookup` 回调；
 * 它经由 fetch 的内部错误链一路冒泡上来，可能被包了一层，这里沿 `cause` 链找一遍。 */
function isGuardedFetchRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let hop = 0; hop < 5 && current instanceof Error; hop += 1) {
    if (current instanceof GuardedFetchRefusedError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
