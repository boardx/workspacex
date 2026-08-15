import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentRuntime as A } from "@repo/contracts";

/**
 * F52：**凭据与端点对非管理员不可见**（domain I-6 / UC-20.1 AC3 / UC-21.1）。
 *
 * ## 这一条的落法不是 403 —— 读清楚再实现
 *
 * `domain.md` I-6 的验证手段逐字是：
 *   「扫描响应 zod schema 无 credential/endpoint 字段；能力维护者请求详情断言无该键；
 *     日志全文 grep 无凭据串」
 * 也就是说，正确的形状是**那个键根本不在响应 schema 里**——
 * 不是「有键但返回 403」，也不是「返回后再过滤」。
 *
 * 差别是实打实的：
 * · 返回 403 意味着服务端**已经把这个字段查出来了**，只是这一次没给。
 *   下一个消费点、下一个缓存层、下一条日志，谁都可能把它带出去。
 * · 「返回后过滤」是**每个消费点各自的自觉**。加一个新界面就漏一次，且漏了不会有东西红。
 * · 「schema 里没有这个键」是一次性的、全局的，且 `.strict()` 让任何塞回去的尝试当场炸。
 *
 * 所以主断言是**反向**的：往 `McpServerRow` 里塞一个 `endpoint`，解析必须失败。
 *
 * ## 为什么界面那一段也在 api 侧
 *
 * 它**不是 DOM 断言**（没有 jsdom、没有 render），是对渲染源的 fs + 正则结构扫描，
 * 所以在 api 的 node 环境里照跑不误。放在这里是因为 **F52 的验收命令只跑 api**——
 * 把这条守在 web 侧，等于「验收通过」与「端点没泄露」之间没有关系，
 * 而 `mcp-policy-screen.tsx` 那处泄露**本来就是真的存在过**。
 * 代价是 api 的测试知道 web 的目录结构；这个耦合是明写的，不是偷偷摸摸的。
 */

/* ───────────────────── schema 键的递归扫描器 ───────────────────── */

/** 收集一个 zod schema 里出现的**全部**键名（递归穿透 array/optional/nullable/object/union） */
function collectKeys(schema: z.ZodTypeAny, depth = 0): string[] {
  if (depth > 14) return [];
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  switch (def.typeName as string) {
    case "ZodObject": {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      return Object.entries(shape).flatMap(([k, v]) => [k, ...collectKeys(v as z.ZodTypeAny, depth + 1)]);
    }
    case "ZodArray":
      return collectKeys(def.type as z.ZodTypeAny, depth + 1);
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return collectKeys(def.innerType as z.ZodTypeAny, depth + 1);
    case "ZodEffects":
      return collectKeys(def.schema as z.ZodTypeAny, depth + 1);
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return ((def.options as z.ZodTypeAny[]) ?? []).flatMap((o) => collectKeys(o, depth + 1));
    case "ZodRecord":
      return collectKeys(def.valueType as z.ZodTypeAny, depth + 1);
    default:
      return [];
  }
}

const SECRET_KEY_RE = /credential|secret|password|apikey|api_key/i;
const ENDPOINT_KEY_RE = /^endpoint$/i;

/**
 * `credentialConfigured`（#1381，`listModelPool.out`）是模型池对凭据**唯一**允许透出的一
 * 个布尔位——"是否配置"，不是凭据本身。exempt by name，同
 * `tests/capability/model/credential-never-echoed.test.ts` 的 `endpointHint` 豁免纪律：
 * 豁免只在下方形状测试（必须是 bare boolean）仍然通过时才成立，不是一句免检声明。
 */
const SECRET_KEY_EXEMPT = new Set(["credentialConfigured"]);

const OPS = Object.entries(A.operations) as [string, { in: z.ZodTypeAny; out: z.ZodTypeAny }][];

describe("扫描器本身不是空转", () => {
  it("能从嵌套结构里挖出键", () => {
    const nested = z.object({ a: z.object({ b: z.array(z.object({ c: z.string() })) }) });
    expect(collectKeys(nested).sort()).toEqual(["a", "b", "c"]);
  });

  it("确实扫到了操作（0 个操作会让下面每条断言恒真）", () => {
    expect(OPS.length).toBeGreaterThan(30);
  });

  it("它对写入面确实能扫到 credential / endpoint —— 否则「响应里扫不到」毫无意义", () => {
    const inKeys = collectKeys(A.operations.registerMcpServer.in);
    expect(inKeys).toContain("credential");
    expect(inKeys).toContain("endpoint");
  });

  it("反证：扫描器确实认得凭据类字段名", () => {
    const fake = z.object({ credentialRef: z.string(), nested: z.object({ apiKey: z.string() }) });
    expect(collectKeys(fake).filter((k) => SECRET_KEY_RE.test(k)).sort()).toEqual(["apiKey", "credentialRef"]);
  });
});

describe("F52 I-6 · 凭据：agent-runtime 束的**任何**响应 schema 里都不存在", () => {
  it.each(OPS)("%s 的 out 里没有任何凭据类字段", (_name, op) => {
    const leaked = collectKeys(op.out).filter((k) => SECRET_KEY_RE.test(k) && !SECRET_KEY_EXEMPT.has(k));
    expect(leaked, `响应体里出现了凭据类字段：${leaked.join(",")}`).toEqual([]);
  });

  it("写入面**允许**带凭据 —— 不对称是有意的，不是漏检", () => {
    // 注册当然要给凭据，不然连不上。被禁止的是**回显**。
    expect(collectKeys(A.operations.registerMcpServer.in)).toContain("credential");
  });

  it("`credentialConfigured` 的豁免是有条件的：它必须是 bare boolean，不能扩权成一个字符串值", () => {
    const rowSchema = A.operations.listModelPool.out.element as unknown as {
      shape: Record<string, z.ZodTypeAny>;
    };
    const flag = rowSchema.shape.credentialConfigured!;
    expect(flag.safeParse(true).success).toBe(true);
    expect(flag.safeParse("sk-live-should-never-parse").success,
      "credentialConfigured 不再是布尔——豁免条件不成立了，回去看这条测试上面的注释").toBe(false);
  });
});

describe("F52 I-6 · 端点：不在任何响应 schema 里，只以粗粒度提示出现", () => {
  it.each(OPS)("%s 的 out 里没有 endpoint 这个键", (_name, op) => {
    const leaked = collectKeys(op.out).filter((k) => ENDPOINT_KEY_RE.test(k));
    expect(leaked, "响应 schema 里出现了 endpoint 原值").toEqual([]);
  });

  it("`McpServerRow` 没有 endpoint / credential 键，而不是「有键但被过滤」", () => {
    const keys = Object.keys(A.McpServerRow.shape);
    expect(keys).not.toContain("endpoint");
    expect(keys).not.toContain("credential");
    expect(keys).not.toContain("credentialRef");
  });

  it("**反向断言**：往 McpServerRow 里塞 endpoint ⇒ 解析失败（不是被静默丢掉）", () => {
    const legit = A.McpServerRow.parse({
      serverId: "mcp-crm",
      name: "客户 CRM",
      description: "Salesforce 桥接",
      endpointHint: "内网",
      authScope: "仅项目负责人",
      reviewStatus: "已放行",
      connectionStatus: "已连接",
      quarantineUntil: null,
      involvesCustomerData: true,
      isEgress: false,
    });
    expect(
      A.McpServerRow.safeParse({ ...legit, endpoint: "mcp://crm.internal:7301" }).success,
      "多带的 endpoint 被放过了——strict 没生效或 schema 被改宽了",
    ).toBe(false);
    expect(A.McpServerRow.safeParse({ ...legit, credential: "sk-xxx" }).success).toBe(false);
    expect(A.McpServerRow.safeParse({ ...legit, credentialRef: "ref-1" }).success).toBe(false);
  });

  it("`endpointHint` 是两值粗粒度，信息量不足以拨过去", () => {
    const hint = A.McpServerRow.shape.endpointHint;
    expect(hint.options).toEqual(["内网", "外网"]);
    // 反证：它不接受任何形似端点的串
    expect(hint.safeParse("mcp://crm.internal:7301").success).toBe(false);
    expect(hint.safeParse("crm.internal").success).toBe(false);
  });

  it("能力维护者要看的都在：名 / 说明 / 授权范围；工具清单行也无端点无凭据", () => {
    const keys = Object.keys(A.McpServerRow.shape);
    for (const k of ["name", "description", "authScope"]) expect(keys).toContain(k);
    const toolKeys = collectKeys(A.McpTool);
    expect(toolKeys.filter((k) => ENDPOINT_KEY_RE.test(k) || SECRET_KEY_RE.test(k))).toEqual([]);
  });
});

describe("F52 I-6 · 界面侧：端点原值只出现在管理员/评审人能看到的分支里", () => {
  /**
   * ⚠ 「任何组件都不许出现 endpoint」是**错的判据**，会把一条正确实现判红：
   *   `/admin/mcp` 整屏就只有组织管理员进得来，端点在那里是**该显示的**。
   *   真正要查的是：**同一块屏上既有非管理员角色、又无条件渲染端点**。
   *   本仓的 `mcp-policy-screen` 正是这种——它的角色切换器里就有 `maintainer`。
   */
  const COMPONENTS = fileURLToPath(new URL("../../../../web/components", import.meta.url));

  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const p = join(dir, n);
      statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
    }
    return out;
  }

  /** 去掉注释：一段解释性文字不该把结构断言弄红 */
  const strip = (body: string) =>
    body
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/)/.test(l))
      .join("\n");

  const files = walk(COMPONENTS).map(
    (f) => [f.slice(COMPONENTS.length + 1), strip(readFileSync(f, "utf8"))] as const,
  );

  /** 一块屏是否把「非管理员角色」也画在自己身上 */
  const servesNonAdmin = (body: string) => /"maintainer"|'maintainer'/.test(body);
  /** 是否取了 MCP 服务器对象上的端点原值 */
  const readsMcpEndpoint = (body: string) => /\b(ISOLATED|server|s|panel\.server)\.endpoint\b/.test(body);

  it("确实扫到了组件（扫到 0 个会让下面恒真）", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("面向非管理员角色的屏，端点必须被角色条件门住", () => {
    const offenders = files
      .filter(([, body]) => servesNonAdmin(body) && readsMcpEndpoint(body))
      .filter(([, body]) => !/canReview \? \(/.test(body))
      .map(([f]) => f);
    expect(offenders, `这些屏有非管理员角色却无条件渲染端点：${offenders.join(", ")}`).toEqual([]);
  });

  it("mcp-policy-screen 具体到行：端点在门内，门外只给两值粗粒度", () => {
    const entry = files.find(([f]) => f.endsWith("mcp-policy-screen.tsx"));
    expect(entry, "找不到这块屏——它被改名/删了？那这条断言正在空转").toBeDefined();
    const body = entry![1];
    expect(body, "这块屏确实带 maintainer 角色").toContain("maintainer");
    expect(body).toContain('data-testid="mcp-isolated-endpoint"');
    expect(body).toContain('data-testid="mcp-isolated-endpoint-hint"');
    expect(body).toContain("canReview ? (");
    expect(body).toContain("mcpEndpointHint(ISOLATED.endpoint)");
    // 端点原值只被取用两次：门内渲染一次，投影成 bit 一次
    expect(body.split("ISOLATED.endpoint").length - 1).toBe(2);
  });

  it("反证：把门去掉，上面那条判据就会命中", () => {
    const body = files.find(([f]) => f.endsWith("mcp-policy-screen.tsx"))![1];
    const broken = body.replace("canReview ? (", "true ? (");
    expect(servesNonAdmin(broken) && readsMcpEndpoint(broken) && !/canReview \? \(/.test(broken)).toBe(true);
  });

  it("`/admin/mcp` 显示端点**不是**违规 —— 那块屏没有非管理员角色", () => {
    const body = files.find(([f]) => f.endsWith("admin/mcp-screen.tsx"))![1];
    expect(readsMcpEndpoint(body), "它确实显示端点").toBe(true);
    expect(servesNonAdmin(body), "但它不承载 maintainer 角色，所以不在 I-6 的射程内").toBe(false);
    expect(body).toContain("仅组织管理员可见");
  });

  it("凭据字面量不出现在任何组件里（`凭据失效` 是连接状态，不算）", () => {
    const offenders = files.filter(([, body]) => /credential/i.test(body)).map(([f]) => f);
    expect(offenders, `这些组件里出现了 credential：${offenders.join(", ")}`).toEqual([]);
  });
});
