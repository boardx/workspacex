/**
 * `analyzeUiWiring` 的判定单测（issue #397）——纯函数喂 fixture，不碰 IO。
 *
 * 行为层（真 spawn 脚本 + 真假仓库）在 `../lint-ui-wiring.test.ts`；这里补的是那边
 * 不便构造的分支：原型命名空间错配、shell 长出数据面、契约漂移、纯数据契约豁免、
 * 清单陈旧条目。每条都以"基线绿 → 只动一处 → 必须红"的形式写，免得断言空转。
 */
import { describe, expect, it } from "vitest";
import { analyzeUiWiring, type RouteKind, type WiringManifest, type WiringSnapshot } from "./ui-wiring";

/**
 * 夹具用**可变**镜像类型：判定函数的入参是全 readonly 的（那是对的，它不该改输入），
 * 但测试要"只动一处"再跑一遍，逐个 `as` 强转只会把类型噪声写满文件。
 * 可变类型可以直接赋给 readonly 参数，所以这里定义一次、下面随便改。
 */
interface MutableSnapshot {
  routes: { route: string; screen: string; liveAdapters: string[]; mockModules: string[] }[];
  adapters: Record<string, { exists: boolean; reachesApiClient: boolean; contracts: string[] }>;
  controllers: Record<
    string,
    { file: string; registered: boolean; httpRoutes: number; contracts: string[]; applicationModules: string[] }
  >;
  contractModules: string[];
  httpContracts: string[];
  applicationModules: string[];
}

interface MutableManifest {
  ratchet: { maxMockRoutes: number; frozenAt?: string; issue?: number };
  previewPrefixes: { prefix: string; reason: string }[];
  nonApiAdapters: { module: string; reason: string }[];
  controllers: Record<string, { useCases: string[]; note?: string }>;
  routes: Record<
    string,
    {
      kind: RouteKind;
      screen: string;
      adapters?: string[];
      contracts?: string[];
      controllers?: string[];
      mocks?: string[];
      note?: string;
    }
  >;
}

function baseSnapshot(): MutableSnapshot {
  return {
    routes: [
      {
        route: "/widgets",
        screen: "apps/web/app/widgets/page.tsx",
        liveAdapters: ["apps/web/lib/live-widgets.ts"],
        mockModules: [],
      },
      { route: "/preview/widgets", screen: "apps/web/app/preview/widgets/page.tsx", liveAdapters: [], mockModules: ["apps/web/lib/mock/widgets.ts"] },
      { route: "/about", screen: "apps/web/app/about/page.tsx", liveAdapters: [], mockModules: [] },
    ],
    adapters: {
      "apps/web/lib/live-widgets.ts": { exists: true, reachesApiClient: true, contracts: ["widgets"] },
      "apps/web/lib/live-mic.ts": { exists: true, reachesApiClient: false, contracts: [] },
    },
    controllers: {
      WidgetsController: {
        file: "apps/api/src/interface/controllers/widgets.controller.ts",
        registered: true,
        httpRoutes: 2,
        contracts: ["widgets"],
        applicationModules: ["widgets/list-widgets"],
      },
      GhostController: {
        file: "apps/api/src/interface/controllers/ghost.controller.ts",
        registered: false,
        httpRoutes: 1,
        contracts: ["widgets"],
        applicationModules: ["widgets/list-widgets"],
      },
    },
    contractModules: ["widgets", "widget-theme"],
    httpContracts: ["widgets"],
    applicationModules: ["widgets/list-widgets"],
  };
}

function baseManifest(): MutableManifest {
  return {
    ratchet: { maxMockRoutes: 0 },
    previewPrefixes: [{ prefix: "/preview", reason: "原型命名空间" }],
    nonApiAdapters: [],
    controllers: { WidgetsController: { useCases: ["widgets/list-widgets"] } },
    routes: {
      "/widgets": {
        kind: "wired",
        screen: "apps/web/app/widgets/page.tsx",
        adapters: ["apps/web/lib/live-widgets.ts"],
        contracts: ["widgets"],
        controllers: ["WidgetsController"],
      },
      "/preview/widgets": { kind: "preview", screen: "apps/web/app/preview/widgets/page.tsx" },
      "/about": { kind: "shell", screen: "apps/web/app/about/page.tsx" },
    },
  };
}

/** 基线必须绿：后面每条"只动一处"的断言才有意义。 */
function expectGreen(m: WiringManifest, s: WiringSnapshot): void {
  const v = analyzeUiWiring(m, s);
  expect(v.errors, v.errors.join("\n")).toEqual([]);
}

describe("analyzeUiWiring 基线", () => {
  it("干净清单 + 干净快照 ⇒ 无错误，且四类计数如实", () => {
    const v = analyzeUiWiring(baseManifest(), baseSnapshot());
    expect(v.errors).toEqual([]);
    expect(v.counts).toEqual({ wired: 1, mock: 0, shell: 1, preview: 1 });
  });
});

describe("跨层链条", () => {
  it("controller 存在但没挂进 kernel ⇒ 红（本门存在的全部理由）", () => {
    const m = baseManifest();
    m.routes["/widgets"]!.controllers = ["GhostController"];
    m.controllers.GhostController = { useCases: ["widgets/list-widgets"] };
    delete m.controllers.WidgetsController;
    const errors = analyzeUiWiring(m, baseSnapshot()).errors;
    expect(errors.join("\n")).toContain("[controller 未挂载]");
  });

  it("声明的适配器不在屏的 import 闭包里 ⇒ 红（声明一条没人调用的接线）", () => {
    const m = baseManifest();
    m.routes["/widgets"]!.adapters = ["apps/web/lib/live-mic.ts"];
    const errors = analyzeUiWiring(m, baseSnapshot()).errors;
    expect(errors.join("\n")).toContain("[适配器未接进屏]");
  });

  it("适配器够不到 api-client 且没写豁免 ⇒ 红；写进 nonApiAdapters 后这条不再红", () => {
    const s = baseSnapshot();
    s.routes[0] = { ...s.routes[0]!, liveAdapters: ["apps/web/lib/live-widgets.ts", "apps/web/lib/live-mic.ts"] };
    const m = baseManifest();
    m.routes["/widgets"]!.adapters = ["apps/web/lib/live-widgets.ts", "apps/web/lib/live-mic.ts"];
    expect(analyzeUiWiring(m, s).errors.join("\n")).toContain("[适配器不打 API]");

    const exempt: MutableManifest = { ...m, nonApiAdapters: [{ module: "apps/web/lib/live-mic.ts", reason: "纯浏览器采音" }] };
    expect(analyzeUiWiring(exempt, s).errors.join("\n")).not.toContain("[适配器不打 API]");
  });

  it("清单记的契约与适配器实际 import 的不一致 ⇒ 红（清单漂移）", () => {
    const m = baseManifest();
    m.routes["/widgets"]!.contracts = ["widgets", "widget-theme"];
    expect(analyzeUiWiring(m, baseSnapshot()).errors.join("\n")).toContain("[契约漂移]");
  });

  it("纯数据契约（没有 HTTP 操作）不要求挂 controller —— 免得逼出一条假豁免", () => {
    const s = baseSnapshot();
    s.adapters["apps/web/lib/live-widgets.ts"] = { exists: true, reachesApiClient: true, contracts: ["widgets", "widget-theme"] };
    const m = baseManifest();
    m.routes["/widgets"]!.contracts = ["widgets", "widget-theme"];
    expectGreen(m, s); // widget-theme 不在 httpContracts 里

    // 反过来：它**有** HTTP 面却没人服务，就必须红。
    const withHttp: MutableSnapshot = { ...s, httpContracts: ["widgets", "widget-theme"] };
    expect(analyzeUiWiring(m, withHttp).errors.join("\n")).toContain("[契约没有 controller]");
  });

  it("controller 声明了它并没有 import 的用例 ⇒ 红（存在同名用例 ≠ 接上了）", () => {
    const s = baseSnapshot();
    s.controllers.WidgetsController = { ...s.controllers.WidgetsController!, applicationModules: [] };
    expect(analyzeUiWiring(baseManifest(), s).errors.join("\n")).toContain("[用例没被 controller 调用]");
  });

  it("controller 没有任何用例又没写 note ⇒ 红；写了 note ⇒ 只剩路由层那条", () => {
    const m = baseManifest();
    m.controllers.WidgetsController = { useCases: [] };
    expect(analyzeUiWiring(m, baseSnapshot()).errors.join("\n")).toContain("[空用例未说明]");

    const noted = { ...m, controllers: { WidgetsController: { useCases: [], note: "只读探针，不经 application 层" } } };
    const errors = analyzeUiWiring(noted, baseSnapshot()).errors.join("\n");
    expect(errors).not.toContain("[空用例未说明]");
    expect(errors).toContain("[没到 application 层]"); // 整条路由仍然没到 application 层
  });
});

describe("类目与棘轮", () => {
  it("产品路由够得到 mock ⇒ 红", () => {
    const s = baseSnapshot();
    s.routes[0] = { ...s.routes[0]!, mockModules: ["apps/web/lib/mock/widgets.ts"] };
    expect(analyzeUiWiring(baseManifest(), s).errors.join("\n")).toContain("[产品路由回退 mock]");
  });

  it("mock 豁免条目陈旧（屏已经够不到 mock）⇒ 红", () => {
    const m = baseManifest();
    m.routes["/about"] = { kind: "mock", screen: "apps/web/app/about/page.tsx" };
    const withCeiling: MutableManifest = { ...m, ratchet: { maxMockRoutes: 1 } };
    expect(analyzeUiWiring(withCeiling, baseSnapshot()).errors.join("\n")).toContain("[陈旧豁免]");
  });

  it("mock 条目数超过冻结上限 ⇒ 红（只减不增）", () => {
    const s = baseSnapshot();
    s.routes[2] = { ...s.routes[2]!, mockModules: ["apps/web/lib/mock/widgets.ts"] };
    const m = baseManifest();
    m.routes["/about"] = { kind: "mock", screen: "apps/web/app/about/page.tsx", mocks: ["apps/web/lib/mock/widgets.ts"] };
    expect(analyzeUiWiring(m, s).errors.join("\n")).toContain("[棘轮回退]");
  });

  it("产品屏藏进原型命名空间 / 原型屏自称原型却不在命名空间下 ⇒ 都红", () => {
    const hidden = baseManifest();
    hidden.routes["/preview/widgets"] = { kind: "shell", screen: "apps/web/app/preview/widgets/page.tsx" };
    expect(analyzeUiWiring(hidden, baseSnapshot()).errors.join("\n")).toContain("[类目错配]");

    const fake = baseManifest();
    fake.routes["/about"] = { kind: "preview", screen: "apps/web/app/about/page.tsx" };
    expect(analyzeUiWiring(fake, baseSnapshot()).errors.join("\n")).toContain("[假原型]");
  });

  it("shell 长出数据面 ⇒ 红（必须改类目并补齐跨层声明）", () => {
    const s = baseSnapshot();
    s.routes[2] = { ...s.routes[2]!, liveAdapters: ["apps/web/lib/live-widgets.ts"] };
    expect(analyzeUiWiring(baseManifest(), s).errors.join("\n")).toContain("[shell 长出数据面]");
  });
});

describe("清单与代码的双向一致", () => {
  it("新页面没进清单 ⇒ 红；清单里的页面没了 ⇒ 也红", () => {
    const s = baseSnapshot();
    s.routes.push({ route: "/new", screen: "apps/web/app/new/page.tsx", liveAdapters: [], mockModules: [] });
    expect(analyzeUiWiring(baseManifest(), s).errors.join("\n")).toContain("[未声明路由]");

    const m = baseManifest();
    m.routes["/gone"] = { kind: "shell", screen: "apps/web/app/gone/page.tsx" };
    expect(analyzeUiWiring(m, baseSnapshot()).errors.join("\n")).toContain("[清单陈旧]");
  });

  it("清单声明了没有任何 wired 路由用到的 controller ⇒ 红（陈旧条目）", () => {
    const m = baseManifest();
    m.controllers.GhostController = { useCases: ["widgets/list-widgets"] };
    expect(analyzeUiWiring(m, baseSnapshot()).errors.join("\n")).toContain("[陈旧 controller 声明]");
  });

  it("屏路径漂移 ⇒ 红", () => {
    const m = baseManifest();
    m.routes["/widgets"]!.screen = "apps/web/app/widgets/old-page.tsx";
    expect(analyzeUiWiring(m, baseSnapshot()).errors.join("\n")).toContain("[屏路径漂移]");
  });
});

describe("空集不是全绿（本仓栽过的形状）", () => {
  it("一条路由都没扫到 / 清单为空 / 没有 controller / 没有 wired 样本 ⇒ 全部红", () => {
    const s = baseSnapshot();
    expect(analyzeUiWiring(baseManifest(), { ...s, routes: [] }).errors.join("\n")).toContain("[空扫描]");
    expect(analyzeUiWiring({ ...baseManifest(), routes: {} }, s).errors.join("\n")).toContain("[空清单]");
    expect(analyzeUiWiring(baseManifest(), { ...s, controllers: {} }).errors.join("\n")).toContain("[空 controller 表]");

    const noWired = baseManifest();
    noWired.routes["/widgets"] = { kind: "shell", screen: "apps/web/app/widgets/page.tsx" };
    delete noWired.controllers.WidgetsController;
    expect(analyzeUiWiring(noWired, baseSnapshot()).errors.join("\n")).toContain("[无接线样本]");
  });
});
