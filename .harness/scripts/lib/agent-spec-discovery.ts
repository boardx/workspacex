/**
 * agent-spec-discovery.ts —— `.harness/agents/*.yaml` 里「哪份文档是 agent 规格」的判定。
 *
 * 背景（issue #399）：gen-subagents 的发现逻辑是
 *   readdirSync(.harness/agents).filter(f => f.endsWith(".yaml"))
 * 它按**扩展名**收文件，于是把身份注册表 `registry.yaml` 也当成一份 agent spec 解析，
 * 每次生成都打一条 `registry.yaml 缺少 name 字段，跳过`。这条警告是假的：registry.yaml
 * 本来就不该有 `name`，它不是 agent 规格，缺的不是字段而是判定。真警告（某份 agent
 * 规格确实漏写 name）混在这条噪声里，久了就没人看了。
 *
 * 修法：按 **schema** 选型，不按文件名排除。registry 有自己的形状（顶层 `agents:` /
 * `developers:` 列表），agent 规格有自己的形状（顶层非空 `name:`）。哪天注册表改名、
 * 或再多一份非 agent 规格的 yaml 进来，判定照样成立——写死 "registry.yaml" 则不会。
 *
 * 纯函数、无 IO：调用方负责 readdir / readFile / YAML.parse。
 */

/** 一份 `.harness/agents/*.yaml` 文档的身份。 */
export type AgentDocumentKind =
  /** agent 规格，交给生成器产出 Claude/Codex 两种格式。 */
  | "agent-spec"
  /** 身份注册表（registry.yaml 的形状），不是 agent 规格，静默跳过。 */
  | "registry"
  /** 既不是注册表也不是合法 agent 规格——调用方应当打警告。 */
  | "unrecognized";

export interface AgentDocumentClassification {
  readonly sourceFile: string;
  readonly kind: AgentDocumentKind;
  /** 仅 `unrecognized` 时给出：为什么不认这份文档（供调用方拼警告文案）。 */
  readonly reason?: string;
}

/** 注册表的形状标记：顶层这些键承载列表 = 这是一份注册表，不是单个 agent 的规格。 */
const REGISTRY_LIST_KEYS = ["agents", "developers"] as const;

function isMapping(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasRegistryShape(doc: Record<string, unknown>): boolean {
  return REGISTRY_LIST_KEYS.some((key) => Array.isArray(doc[key]));
}

function hasSpecName(doc: Record<string, unknown>): boolean {
  return typeof doc.name === "string" && doc.name.trim() !== "";
}

export function classifyAgentDocument(
  sourceFile: string,
  parsed: unknown,
): AgentDocumentClassification {
  if (!isMapping(parsed)) {
    return { sourceFile, kind: "unrecognized", reason: "顶层不是 YAML 映射" };
  }
  const registryShaped = hasRegistryShape(parsed);
  const named = hasSpecName(parsed);
  if (registryShaped && named) {
    // 两种形状同时成立说明源文件本身有歧义，不能替它猜——交给人看警告。
    return {
      sourceFile,
      kind: "unrecognized",
      reason: `同时具备注册表形状（${REGISTRY_LIST_KEYS.join(" / ")} 列表）与 agent 规格的 name 字段，无法判定`,
    };
  }
  if (registryShaped) return { sourceFile, kind: "registry" };
  if (named) return { sourceFile, kind: "agent-spec" };
  return { sourceFile, kind: "unrecognized", reason: "缺少 name 字段" };
}
