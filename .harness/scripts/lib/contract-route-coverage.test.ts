/**
 * `contract-route-coverage.ts` 的 fixture 单测（issue #1177）。
 *
 * 第一节是**反证**：issue 正文点名的四条种子，喂给这道门必须当场报红。
 * 一道判定不出已知缺陷的门比没有门更糟——它会让「清单是空的」被读成「没有缺口」。
 */
import { describe, expect, it } from "vitest";
import {
  bundleScope,
  isOperationRouted,
  judgeContractRouteCoverage,
  parseContractOperations,
  parseNestRoutes,
  pathShapeEquals,
  type BundleInput,
  type RouteDecl,
} from "./contract-route-coverage";

/* ─────────────────── fixture：issue #1177 的两个束 ─────────────────── */

/** `packages/contracts/src/skills.ts` 的形状（截自 F68 的 `rateMessage`） */
const SKILLS_CONTRACT = `
import { z } from "zod";
export const operations = {
  rateMessage: {
    method: "POST",
    path: "/messages/:messageId/rating",
    in: z.object({ messageId: z.string(), verdict: RatingVerdict }).strict(),
    out: z.object({ ratingId: z.string() }).strict(),
    err: ["ATTRIBUTION_MISSING"] as const,
  },
  getSatisfaction: {
    method: "GET",
    path: "/skills/:skillId/satisfaction",
    in: z.object({ skillId: z.string() }).strict(),
    out: z.object({ insufficient: z.boolean() }).strict(),
  },
} as const;
`;

/** `packages/contracts/src/agent-runtime.ts` 的形状（截自 F60 的三条） */
const AGENT_RUNTIME_CONTRACT = `
export const operations = {
  queryOrgAudit: {
    method: "GET",
    path: "/org-audit",
    in: z.object({ projectId: z.string().nullable() }).strict(),
    out: z.object({ entries: z.array(AuditEntry) }).strict(),
  },
  listAnomalies: {
    method: "GET",
    path: "/anomalies",
    in: z.object({}).strict(),
    out: z.object({ anomalies: z.array(Anomaly) }).strict(),
  },
  markAnomalyNormal: {
    method: "POST",
    path: "/anomalies/:anomalyId/mark-normal",
    in: z.object({ anomalyId: z.string() }).strict(),
    out: z.object({ ok: z.literal(true) }).strict(),
  },
  listAgents: {
    method: "GET",
    path: "/agents",
    in: z.object({}).strict(),
    out: z.object({ agents: z.array(Agent) }).strict(),
  },
} as const;
`;

/**
 * `apps/api/src/interface/` 在 issue 登记当时（SHA `ec074433`）的形状：
 * 有 `/agents` 的路由，`anomalies` / `org-audit` / 消息评价一个都没有。
 * issue 正文逐字：「全量拼接后 `includes("anomalies")` 与 `includes("org-audit")` 均为 false」。
 */
const INTERFACE_AT_EC074433 = `
@Controller()
export class AgentController {
  @Get(C.operations.listAgents.path)
  async list() { return this.agents.list(); }
}
`;

/** 四条种子那一刻的入参：两束都已签核，covers 里没有 not_started */
function seedBundles(): BundleInput[] {
  return [
    {
      bundle: "skills",
      phase: "01",
      contractFile: "packages/contracts/src/skills.ts",
      contractSource: SKILLS_CONTRACT,
      signoffStatus: "confirmed",
      covers: ["F67", "F68"],
      featureStatus: { F67: "passing", F68: "passing" },
    },
    {
      bundle: "agent-runtime",
      phase: "01",
      contractFile: "packages/contracts/src/agent-runtime.ts",
      contractSource: AGENT_RUNTIME_CONTRACT,
      signoffStatus: "confirmed",
      covers: ["F59", "F60"],
      featureStatus: { F59: "passing", F60: "passing" },
    },
  ];
}

function judgeAgainst(interfaceSource: string) {
  const parsed = parseNestRoutes("apps/api/src/interface/controllers/agent.controller.ts", interfaceSource);
  return judgeContractRouteCoverage({
    bundles: seedBundles(),
    routes: parsed.routes,
    unresolvedRoutes: parsed.unresolved,
  });
}

describe("反证：issue #1177 点名的四条种子", () => {
  const report = judgeAgainst(INTERFACE_AT_EC074433);
  const found = report.gaps.map((g) => `${g.method} ${g.path}`);

  it.each([
    ["POST /messages/:messageId/rating", "F68，passing"],
    ["GET /anomalies", "F60，passing"],
    ["POST /anomalies/:anomalyId/mark-normal", "F60，passing"],
    ["GET /org-audit", "F60，passing"],
  ])("报红 %s（%s）", (seed) => {
    expect(found).toContain(seed);
  });

  it("不误伤同一束里真有路由的 operation", () => {
    // `listAgents` 由 `@Get(C.operations.listAgents.path)` 实现——符号引用即最强证据
    expect(found).not.toContain("GET /agents");
  });

  it("`getSatisfaction` 同样无路由，所以它也在清单里（种子不是白名单）", () => {
    expect(found).toContain("GET /skills/:skillId/satisfaction");
  });

  it("补上路由之后这条种子就从清单里消失 —— 判据跟着实现走，不是写死的四条", () => {
    // F176（2026-08-14）之后 `message-rating.controller.ts` 真的落了这条路由
    const after = judgeAgainst(`${INTERFACE_AT_EC074433}
@Controller()
export class MessageRatingController {
  @HttpCode(HttpStatus.OK)
  @Post("/messages/:messageId/rating")
  async rate() { return this.ratings.rate(); }
}
`);
    const afterPaths = after.gaps.map((g) => `${g.method} ${g.path}`);
    expect(afterPaths).not.toContain("POST /messages/:messageId/rating");
    expect(afterPaths).toContain("GET /anomalies"); // 另外三条没动，仍然红
  });
});

/* ─────────────────── 契约侧解析 ─────────────────── */

describe("parseContractOperations", () => {
  it("抓 `export const operations = {…}` 里的每一条", () => {
    const ops = parseContractOperations("skills", "skills.ts", SKILLS_CONTRACT);
    expect(ops.map((o) => o.name).sort()).toEqual(["getSatisfaction", "rateMessage"]);
    expect(ops.find((o) => o.name === "rateMessage")).toMatchObject({
      method: "POST",
      path: "/messages/:messageId/rating",
      bundle: "skills",
    });
  });

  it("不把外层容器对象当成一条 operation（method/path 只认对象自身顶层）", () => {
    const ops = parseContractOperations("skills", "skills.ts", SKILLS_CONTRACT);
    expect(ops.map((o) => o.name)).not.toContain("operations");
  });

  it("认 `export const planControl = {…}` 这种别的导出名", () => {
    const ops = parseContractOperations("plan-control", "plan-control.ts", `
export const planControl = {
  getPlanLedger: { method: "GET", path: "/plan-control/threads/:threadId/ledger", in: z.object({}) },
} as const;
`);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.path).toBe("/plan-control/threads/:threadId/ledger");
  });

  it("认顶层单条 `export const getAgentSkillPins = {…}`", () => {
    const ops = parseContractOperations("agent-skill-pins", "agent-skill-pins.ts", `
export const getAgentSkillPins = { method: "GET", path: "/agents/:agentId/skill-pins" } as const;
`);
    expect(ops.map((o) => o.name)).toEqual(["getAgentSkillPins"]);
  });

  it("没有 path 的（纯 domain 类型、WS 事件）不算 operation", () => {
    const ops = parseContractOperations("chat", "chat.ts", `
export const StreamEvent = { method: "POST" };
export const Thing = z.object({ path: z.string() });
`);
    expect(ops).toEqual([]);
  });
});

/* ─────────────────── 路由侧解析 ─────────────────── */

describe("parseNestRoutes", () => {
  it("把 @Controller 前缀和子路径拼起来（issue #1177 难点第 2 条）", () => {
    const { routes } = parseNestRoutes("survey.controller.ts", `
@Controller("/surveys")
export class SurveyController {
  @Get(":surveyId")
  one() {}
  @Post()
  create() {}
}
`);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /surveys/:surveyId", "POST /surveys"]);
  });

  it("空前缀 @Controller() + 方法上的完整 path", () => {
    const { routes } = parseNestRoutes("x.controller.ts", `
@Controller()
export class X { @Post("/messages/:messageId/rating") rate() {} }
`);
    expect(routes[0]!.path).toBe("/messages/:messageId/rating");
  });

  it("符号引用 `C.operations.xxx.path` 记成 operationRef，不猜路径", () => {
    const { routes } = parseNestRoutes("x.controller.ts", `
@Controller()
export class X { @Get(C.operations.listAgents.path) list() {} }
`);
    expect(routes[0]).toMatchObject({ method: "GET", path: null, operationRef: "listAgents" });
  });

  it("一个文件里多个 @Controller，各段各归各的前缀", () => {
    const { routes } = parseNestRoutes("two.controller.ts", `
@Controller("/a")
export class A { @Get("/one") one() {} }
@Controller("/b")
export class B { @Get("/two") two() {} }
`);
    expect(routes.map((r) => r.path)).toEqual(["/a/one", "/b/two"]);
  });

  it("模板字面量解析不了 —— 登记进 unresolved，不当作「没有路由」", () => {
    const { routes, unresolved } = parseNestRoutes("survey-attachment.controller.ts", `
@Controller()
export class X { @Delete(\`\${path}/:attachmentId\`) del() {} }
`);
    expect(routes).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]!.method).toBe("DELETE");
  });

  it("没有 @Controller 的文件（DI 装配、guard）不产出路由", () => {
    const { routes } = parseNestRoutes("ports.di.ts", `export const PORT = Symbol("PORT");`);
    expect(routes).toEqual([]);
  });
});

/* ─────────────────── 路径形状匹配 ─────────────────── */

describe("pathShapeEquals", () => {
  it("参数名不同但形状相同 ⇒ 同一条路由", () => {
    expect(pathShapeEquals("/skills/:skillId", "/skills/:id")).toBe(true);
  });

  it("尾斜杠 / 重复斜杠归一", () => {
    expect(pathShapeEquals("/skills/", "//skills")).toBe(true);
  });

  it("通配符不与静态段匹配 —— `/threads/:id` 不算实现了 `/threads/active`", () => {
    expect(pathShapeEquals("/threads/:id", "/threads/active")).toBe(false);
  });

  it("段数不同不匹配 —— 「静态片段全部出现过」那种兜底判据在这里是假的", () => {
    expect(pathShapeEquals("/anomalies", "/agents/:agentId/anomalies/summary")).toBe(false);
  });
});

describe("isOperationRouted", () => {
  const op = {
    bundle: "skills",
    contractFile: "skills.ts",
    name: "rateMessage",
    method: "POST" as const,
    path: "/messages/:messageId/rating",
  };
  const route = (over: Partial<RouteDecl>): RouteDecl => ({
    file: "x.ts",
    method: "POST",
    path: "/messages/:messageId/rating",
    operationRef: null,
    raw: "",
    ...over,
  });

  it("method 不同不算实现（同一路径的 GET 不是 POST 的实现）", () => {
    expect(isOperationRouted(op, [route({ method: "GET" })])).toBe(false);
  });

  it("符号引用按 operation 名判定", () => {
    expect(isOperationRouted(op, [route({ path: null, operationRef: "rateMessage" })])).toBe(true);
    expect(isOperationRouted(op, [route({ path: null, operationRef: "rateThread" })])).toBe(false);
  });
});

/* ─────────────────── 判定范围 ─────────────────── */

describe("bundleScope", () => {
  const base: BundleInput = {
    bundle: "b",
    phase: "01",
    contractFile: "packages/contracts/src/b.ts",
    contractSource: "export const operations = {} as const;",
    signoffStatus: "confirmed",
    covers: ["F01", "F02"],
    featureStatus: { F01: "passing", F02: "in_progress" },
  };

  it("已签核 + 有 passing + 无 not_started ⇒ 判", () => {
    expect(bundleScope(base).inScope).toBe(true);
  });

  it("有 not_started ⇒ 不判（契约有、路由没有是设计，不是缺口）", () => {
    const d = bundleScope({ ...base, featureStatus: { F01: "passing", F02: "not_started" } });
    expect(d.inScope).toBe(false);
    expect(d.reason).toContain("not_started");
  });

  it("一个 passing 都没有 ⇒ 不判（本束还没声称任何能力可用）", () => {
    expect(bundleScope({ ...base, featureStatus: { F01: "in_progress", F02: "in_progress" } }).inScope).toBe(false);
  });

  it("未签核 ⇒ 不判", () => {
    expect(bundleScope({ ...base, signoffStatus: "pending" }).inScope).toBe(false);
    expect(bundleScope({ ...base, signoffStatus: "missing" }).inScope).toBe(false);
  });

  it("covers 为空 ⇒ 不判，且理由说的是映射缺失而不是「没有缺口」", () => {
    const d = bundleScope({ ...base, covers: [] });
    expect(d.inScope).toBe(false);
    expect(d.reason).toContain("covers");
  });

  it("covers 点名了清单里查无此条的 feature ⇒ 不判，先修映射", () => {
    const d = bundleScope({ ...base, covers: ["F01", "F999"] });
    expect(d.inScope).toBe(false);
    expect(d.reason).toContain("F999");
  });

  it("没有同名契约文件 ⇒ 不判，理由写明是哪个文件找不到", () => {
    const d = bundleScope({ ...base, contractFile: null, contractSource: null });
    expect(d.inScope).toBe(false);
    expect(d.reason).toContain("packages/contracts/src/b.ts");
  });
});

describe("judgeContractRouteCoverage", () => {
  it("不判的束一条 gap 都不产出，但它为什么不判要留在报告里", () => {
    const report = judgeContractRouteCoverage({
      bundles: [
        {
          bundle: "survey",
          phase: "02",
          contractFile: "packages/contracts/src/survey.ts",
          contractSource: `export const operations = { listSurveys: { method: "GET", path: "/surveys" } } as const;`,
          signoffStatus: "confirmed",
          covers: ["F01"],
          featureStatus: { F01: "not_started" },
        },
      ],
      routes: [],
      unresolvedRoutes: [],
    });
    expect(report.gaps).toEqual([]);
    expect(report.operationsInScope).toBe(0);
    expect(report.bundles[0]!.inScope).toBe(false);
    expect(report.bundles[0]!.reason).toContain("not_started");
    // 束虽然不判，它有几条带 path 的 operation 仍然如实记着——不然「跳过」会看起来像「没有」
    expect(report.bundles[0]!.operationsWithPath).toBe(1);
  });

  it("解析不了的路由表达式原样进报告（说不清扫到多少的清单等于没有清单）", () => {
    const report = judgeContractRouteCoverage({
      bundles: [],
      routes: [],
      unresolvedRoutes: [{ file: "x.ts", method: "POST", raw: "@Post(path)" }],
    });
    expect(report.unresolvedRoutes).toHaveLength(1);
  });
});
