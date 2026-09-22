/**
 * ui-wiring.ts —— screen → live adapter → controller → application use case
 * 这条**跨层接线**的判定（纯函数，可喂 fixture 单测，不碰 IO）。
 *
 * ## 它堵的洞（issue #397）
 *
 * 本仓已有的门控各管一段，**没有一道管"这条产品路由到底接到后端了没有"**：
 *   · `lint-ui-material`  —— 只比对签核截图的引用集 == 实存集，管不到接线；
 *   · `lint-nav-reachability` —— 只管"束路由在导航里走得到"，走到之后是 mock 还是真后端，它不看；
 *   · `lint-rewrite-coverage` —— 只管 controller 路由 ↔ next rewrites 成对，不看有没有屏在用。
 * 于是「页面做好了、导航连上了、controller 却根本没挂」这一形状可以全绿穿过所有门。
 * 这正是 #384 审计里点名的 P0：前端 mock 驱动、application 用例没有路由。
 *
 * ## 形态：棘轮，不是"全绿门"（coord-architecture 2026-08-04 于 #397 的裁决）
 *
 * 等 20 条路由全接完再写这道门，作者面对的是一个已经改完的代码库：它必须一次性对全部
 * 路由为真，任何没接干净的都会红，而那时候的压力永远是"先让它绿"——结果是把断言放宽到
 * 能过为止。**写得过宽的脚本比没有脚本更坏**：它给出已收口的假象。
 * 所以这道门今天就能合（对现状为真、不阻塞任何人），却从今天起就起作用：
 *   ① mock 清单**只能变短**——新增任何 mock 驱动的产品路由当场红；
 *   ② 清单外的每条路由，其屏必须解析到一个**真的挂进了 kernel controllers[] 的 controller**
 *      （不是"存在同名 application 用例"）；
 *   ③ 每个接线 PR 顺手把自己那条从 mock 清单里划掉——条目陈旧（屏已经不碰 mock 了）也红，
 *      所以清单不会烂在那里。清单归零之日，门自动变成"全仓禁止 mock"。
 *
 * ## 跨层的"接头"是契约模块，不是 URL 字符串
 *
 * 适配器与 controller 两侧都 import 同一个 `@repo/contracts` 模块（ADR-020：契约是 API 的
 * 唯一事实源），所以 join key 取**契约模块 id**（`feedback-loop`、`chat`……），而不是去正则
 * 解析 URL——本仓的适配器里 URL 有三种写法（字面量、`op.path`、模板串拼 `${base(id)}`），
 * 用正则匹配 URL 的门迟早会漂移，而漂移方向恰好是"误判为已接线"，即本文件要挡的那种错觉。
 *
 * ## 分层
 *   lib/ui-wiring.ts     判定 + 类型（本文件，纯函数）
 *   lint-ui-wiring.mjs   IO：扫仓库建快照 → 调本文件 → 决定退出码；`--update` 重新生成清单
 */

/* ── 快照：由 lint-ui-wiring.mjs 从真实仓库读出来的**客观事实** ───────────── */

/** 一条被发现的产品路由（`apps/web/app` 下的一个 page）。 */
export interface RouteFacts {
  /** URL 路径，`(group)` 段已去掉：`/projects/[projectId]/files`。 */
  readonly route: string;
  /** 屏文件，仓库相对路径。 */
  readonly screen: string;
  /** 该屏 import 闭包（含沿途 layout）里够得到的 `apps/web/lib/live-*.ts`。 */
  readonly liveAdapters: readonly string[];
  /** 该屏闭包里够得到的 mock 模块（`lib/mock/**` 或 `*.mock.ts`）。 */
  readonly mockModules: readonly string[];
}

export interface AdapterFacts {
  readonly exists: boolean;
  /** 自身闭包里够不够得到 `apps/web/lib/api-client.ts`（真的打 HTTP/WS）。 */
  readonly reachesApiClient: boolean;
  /** 它 import 的契约模块 id 集合。 */
  readonly contracts: readonly string[];
}

export interface ControllerFacts {
  readonly file: string;
  /** 是否**真的**出现在 `kernel.module.ts` 的 `controllers: [...]` 里。 */
  readonly registered: boolean;
  /** `@Get/@Post/...` 路由装饰器条数——0 条 = 它不是个 HTTP 面。 */
  readonly httpRoutes: number;
  readonly contracts: readonly string[];
  /** 它 import 的 application 模块 id（相对 `apps/api/src/application/`，不带后缀）。 */
  readonly applicationModules: readonly string[];
}

export interface WiringSnapshot {
  readonly routes: readonly RouteFacts[];
  readonly adapters: Readonly<Record<string, AdapterFacts>>;
  readonly controllers: Readonly<Record<string, ControllerFacts>>;
  /** `packages/contracts/src` 下真实存在的契约模块 id。 */
  readonly contractModules: readonly string[];
  /**
   * 其中**声明了 HTTP 操作**（`path: "/…"`）的契约模块 id。
   * 只有这些才要求有 controller 服务——`agent-defaults` / `design-prototype` 这类纯数据契约
   * 本来就没有 HTTP 面，要求它们挂 controller 只会逼出一条假豁免。
   * ⚠ 这是**从契约源码推出来的事实**，不是清单里的一条免死金牌（本仓的教训：
   *   「无 HTTP 面」一旦能靠写一行字声明，它就会变成豁免整层门控的金牌）。
   */
  readonly httpContracts: readonly string[];
  /** `apps/api/src/application/` 下真实存在的模块 id。 */
  readonly applicationModules: readonly string[];
}

/* ── 清单：人类维护的**声明** ─────────────────────────────────────────── */

export type RouteKind = "wired" | "mock" | "shell" | "preview";

export interface RouteEntry {
  readonly kind: RouteKind;
  readonly screen: string;
  /** kind=wired：屏经由哪些 live 适配器取数（≥1，且必须真的在屏的闭包里）。 */
  readonly adapters?: readonly string[];
  /** kind=wired：适配器实际 import 的契约模块集合（相等判定，漂移即红）。 */
  readonly contracts?: readonly string[];
  /** kind=wired：服务这些契约的 controller 类名（必须已注册进 kernel）。 */
  readonly controllers?: readonly string[];
  /** kind=mock：今天仍够得到的 mock 模块（陈旧即红——接线完成就该把本条删掉）。 */
  readonly mocks?: readonly string[];
  /** 人话说明，给读清单的人看。 */
  readonly note?: string;
}

/**
 * controller → application 用例的声明。
 *
 * ⚠ 刻意**不**写在路由条目里：同一个 controller 会被多条路由用到，写在路由里就等于同一个
 *   事实声明在多处——本项目已五次因此漂移（AGENTS.md 硬约束）。这里一个 controller 一条，
 *   路由只引用类名。
 */
export interface ControllerEntry {
  /** 该 controller 真正调用的 application 用例模块（≥1；`ports`/类型模块不算用例）。 */
  readonly useCases: readonly string[];
  readonly note?: string;
}

export interface WiringManifest {
  readonly ratchet: {
    /** mock 清单的**冻结上限**：只减不增。要加，就得动这个数字——一次显式的、可 grep 的回退。 */
    readonly maxMockRoutes: number;
    readonly frozenAt?: string;
    readonly issue?: number;
  };
  /** 原型/预览命名空间：这些前缀下的屏允许用 mock，不要求接线。每条必须写理由。 */
  readonly previewPrefixes: readonly { readonly prefix: string; readonly reason: string }[];
  /** 不打 API 的 live 适配器（如纯浏览器采音），显式豁免第 ⑥ 条。每条必须写理由。 */
  readonly nonApiAdapters: readonly { readonly module: string; readonly reason: string }[];
  /** controller → application 用例（单一事实源，路由只引用类名）。 */
  readonly controllers: Readonly<Record<string, ControllerEntry>>;
  readonly routes: Readonly<Record<string, RouteEntry>>;
}

export interface WiringVerdict {
  readonly errors: readonly string[];
  readonly counts: Readonly<Record<RouteKind, number>>;
}

const KINDS: readonly RouteKind[] = ["wired", "mock", "shell", "preview"];

function sorted(xs: Iterable<string>): string[] {
  return [...new Set(xs)].sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const A = sorted(a), B = sorted(b);
  return A.length === B.length && A.every((x, i) => x === B[i]);
}

export function isPreviewRoute(route: string, manifest: WiringManifest): boolean {
  return manifest.previewPrefixes.some(
    (p) => route === p.prefix || route.startsWith(p.prefix.endsWith("/") ? p.prefix : `${p.prefix}/`),
  );
}

/**
 * 主判定。返回的 errors 为空 ⟺ 这道门今天为绿。
 *
 * ⚠ 每一条判定都写成"点名"的错误信息：门红的时候，读的人要能直接知道改哪个文件，
 *   而不是"某处不一致"。本仓多次栽在"门红了但没人看得懂它在说什么"。
 */
export function analyzeUiWiring(manifest: WiringManifest, snapshot: WiringSnapshot): WiringVerdict {
  const errors: string[] = [];
  const counts: Record<RouteKind, number> = { wired: 0, mock: 0, shell: 0, preview: 0 };
  const nonApi = new Set(manifest.nonApiAdapters.map((a) => a.module));
  const usedControllers = new Set<string>();

  /* ⑩ 非空防线：空集会让下面每一条断言平凡为真——本仓栽过的形状，显式堵掉。 */
  if (snapshot.routes.length === 0) {
    errors.push("[空扫描] apps/web/app 下没扫到任何 page —— 空集会让全部判定平凡为真，视为失败。");
    return { errors, counts };
  }
  if (Object.keys(manifest.routes).length === 0) {
    errors.push("[空清单] 清单里一条路由都没有 —— 视为失败（门不许守着空数据）。");
    return { errors, counts };
  }
  if (Object.keys(snapshot.controllers).length === 0) {
    errors.push("[空 controller 表] 没解析到任何 controller —— 扫描器坏了或目录挪了，不能用残缺输入判绿。");
    return { errors, counts };
  }

  /* ① 覆盖：发现集 == 清单集（双向）。新页面不声明 ⇒ 红；清单里的页面没了 ⇒ 红。 */
  const discovered = new Map(snapshot.routes.map((r) => [r.route, r]));
  for (const r of snapshot.routes) {
    if (!manifest.routes[r.route]) {
      errors.push(
        `[未声明路由] ${r.route}（${r.screen}）不在清单里 —— 新产品路由必须显式归类：` +
          `wired（已接线）/ mock（棘轮豁免）/ shell（无数据面）/ preview（原型）。`,
      );
    }
  }
  for (const route of Object.keys(manifest.routes)) {
    if (!discovered.has(route)) {
      errors.push(`[清单陈旧] 清单里的 ${route} 在 apps/web/app 下已经没有对应 page —— 删掉这条。`);
    }
  }

  for (const [route, entry] of Object.entries(manifest.routes)) {
    const facts = discovered.get(route);
    if (!facts) continue;
    if (!KINDS.includes(entry.kind)) {
      errors.push(`[非法类目] ${route} 的 kind="${entry.kind}" 不是 ${KINDS.join(" / ")} 之一。`);
      continue;
    }
    counts[entry.kind]++;
    if (entry.screen !== facts.screen) {
      errors.push(`[屏路径漂移] ${route} 清单写的是 ${entry.screen}，实际是 ${facts.screen}。`);
    }

    /* ② preview 只认命名空间，不认自称：声明 preview 却不在任何 previewPrefix 下 ⇒ 红，
          反之在 preview 命名空间里却声明成别的类目 ⇒ 也红（免得有人把产品屏藏进 /preview）。 */
    const inPreviewNs = isPreviewRoute(route, manifest);
    if (entry.kind === "preview" && !inPreviewNs) {
      errors.push(
        `[假原型] ${route} 声明成 preview，但它不在任何已声明的原型命名空间下 —— ` +
          `要么归到 wired/mock/shell，要么在 previewPrefixes 里加上这个前缀并写明理由。`,
      );
    }
    if (entry.kind !== "preview" && inPreviewNs) {
      errors.push(`[类目错配] ${route} 在原型命名空间下，却声明成 ${entry.kind}。`);
    }

    /* ③ mock 棘轮（双向）：声明 mock 就必须**今天真的还够得到 mock**；
          没声明 mock 的非 preview 路由**不许**够得到 mock。 */
    const reachesMock = facts.mockModules.length > 0;
    if (entry.kind === "mock") {
      if (!reachesMock) {
        errors.push(
          `[陈旧豁免] ${route} 还挂在 mock 清单里，但它的屏今天已经够不到任何 mock —— ` +
            `接线完成就把这条删掉（棘轮只减不增，留着等于给回归留一扇没人看守的门）。`,
        );
      } else if (entry.mocks && !sameSet(entry.mocks, facts.mockModules)) {
        errors.push(
          `[mock 漂移] ${route} 清单记的 mock 是 [${sorted(entry.mocks).join(", ")}]，` +
            `实际够得到 [${sorted(facts.mockModules).join(", ")}]。`,
        );
      }
    } else if (entry.kind !== "preview" && reachesMock) {
      errors.push(
        `[产品路由回退 mock] ${route}（${facts.screen}）的渲染路径够得到 ` +
          `[${sorted(facts.mockModules).join(", ")}] —— 产品路由不许静默回退 mock。`,
      );
    }

    /* ⑤ shell：既没有数据面也没有 mock。长出适配器就必须改类目，不能继续挂在 shell 下。 */
    if (entry.kind === "shell" && facts.liveAdapters.length > 0) {
      errors.push(
        `[shell 长出数据面] ${route} 声明为 shell（无数据面），但它已经够得到 ` +
          `[${sorted(facts.liveAdapters).join(", ")}] —— 改成 wired 并补齐跨层声明。`,
      );
    }

    if (entry.kind !== "wired") continue;

    /* ⑥ 适配器：≥1、存在、在屏的闭包里、够得到 api-client。 */
    const adapters = entry.adapters ?? [];
    if (adapters.length === 0) {
      errors.push(`[空接线] ${route} 声明为 wired 却没有任何 live 适配器 —— wired 不许是空壳。`);
    }
    const inClosure = new Set(facts.liveAdapters);
    for (const mod of adapters) {
      const a = snapshot.adapters[mod];
      if (!a || !a.exists) {
        errors.push(`[适配器不存在] ${route} 声明的 ${mod} 在仓库里找不到。`);
        continue;
      }
      if (!inClosure.has(mod)) {
        errors.push(
          `[适配器未接进屏] ${route} 声明了 ${mod}，但它不在 ${facts.screen} 的 import 闭包里 —— ` +
            `声明一条没人调用的适配器，正是本门要挡的"看起来接了"。`,
        );
      }
      if (!a.reachesApiClient && !nonApi.has(mod)) {
        errors.push(
          `[适配器不打 API] ${route} 的 ${mod} 闭包里够不到 api-client —— ` +
            `它要么不是 live 适配器，要么要在 nonApiAdapters 里显式豁免并写明理由。`,
        );
      }
    }

    /* ⑦ 契约（跨层接头）：声明集 == 适配器实际 import 集；且契约模块真实存在。 */
    const declaredContracts = entry.contracts ?? [];
    const actualContracts = sorted(adapters.flatMap((m) => snapshot.adapters[m]?.contracts ?? []));
    if (!sameSet(declaredContracts, actualContracts)) {
      errors.push(
        `[契约漂移] ${route} 清单记的契约是 [${sorted(declaredContracts).join(", ")}]，` +
          `适配器实际 import 的是 [${actualContracts.join(", ")}] —— 清单与代码必须逐个相等。`,
      );
    }
    const known = new Set(snapshot.contractModules);
    for (const c of declaredContracts) {
      if (!known.has(c)) errors.push(`[契约不存在] ${route} 声明的契约模块 ${c} 在 packages/contracts/src 下找不到。`);
    }

    /* ⑧ controller：存在 + **已注册进 kernel** + 有 HTTP 路由 + 服务本路由的某个契约；
          反向：每个契约至少被一个已声明 controller 服务 —— "页面存在但没接到 controller" 红在这。 */
    const controllers = entry.controllers ?? [];
    if (controllers.length === 0) {
      errors.push(`[没接到 controller] ${route} 声明为 wired 却没有任何 controller —— 屏够不到后端。`);
    }
    const servedContracts = new Set<string>();
    for (const cls of controllers) {
      const c = snapshot.controllers[cls];
      if (!c) {
        errors.push(`[controller 不存在] ${route} 声明的 ${cls} 不在 apps/api/src/interface/controllers 下。`);
        continue;
      }
      if (!c.registered) {
        errors.push(
          `[controller 未挂载] ${route} 声明的 ${cls} 存在于 ${c.file}，` +
            `但它**没有**出现在 kernel.module.ts 的 controllers[] 里 —— 没挂进路由表 = 用户打不到它。`,
        );
      }
      if (c.httpRoutes === 0) {
        errors.push(`[controller 没有路由] ${route} 声明的 ${cls} 一条 @Get/@Post 之类的路由装饰器都没有。`);
      }
      const overlap = c.contracts.filter((x) => declaredContracts.includes(x));
      if (overlap.length === 0) {
        errors.push(
          `[跨层接头断裂] ${route} 声明的 ${cls} 没有 import 本路由的任何契约 ` +
            `[${sorted(declaredContracts).join(", ")}] —— 它服务的不是这个屏。`,
        );
      }
      for (const x of overlap) servedContracts.add(x);
    }
    const httpContracts = new Set(snapshot.httpContracts);
    for (const c of declaredContracts) {
      if (!httpContracts.has(c)) continue; // 纯数据契约没有 HTTP 面，见 httpContracts 头注
      if (!servedContracts.has(c)) {
        errors.push(
          `[契约没有 controller] ${route} 用到契约 ${c}，但清单里没有任何**已注册**的 controller 服务它 —— ` +
            `这正是"页面做好了、后端没挂上"的形状。`,
        );
      }
    }

    /* ⑨ application 用例：由 manifest.controllers 声明（单一事实源），路由这层只核对
          "用到的 controller 都有声明"；逐条核对放在下面按 controller 走一遍，免得同一个
          controller 的同一处问题被 N 条路由各报一次（读的人要能一眼看出有几处问题）。 */
    for (const cls of controllers) {
      if (!snapshot.controllers[cls]) continue; // 上面已经点名报过
      if (!manifest.controllers[cls]) {
        errors.push(
          `[用例未声明] ${route} 用到 ${cls}，但清单的 controllers 段里没有它的 application 用例声明 —— ` +
            `到不了 application 层的 controller 只是个空壳。`,
        );
        continue;
      }
      usedControllers.add(cls);
    }

    /* ⑨（续一）路由层非空：整条路由的 controller 不能全是"没有用例"的薄壳，
          否则第 ⑨ 条对这条路由就是平凡为真。 */
    if (controllers.length > 0 && !controllers.some((cls) => (manifest.controllers[cls]?.useCases ?? []).length > 0)) {
      errors.push(
        `[没到 application 层] ${route} 的 controller 一个都没有 application 用例 —— ` +
          `屏最多接到了 HTTP 层，跨层链条断在 controller 上。`,
      );
    }
  }

  /* ⑨（续二）逐个 controller 核对用例声明；顺带挡住陈旧条目（清单不许烂掉）。 */
  const appKnown = new Set(snapshot.applicationModules);
  for (const [cls, declared] of Object.entries(manifest.controllers)) {
    if (!usedControllers.has(cls)) {
      errors.push(`[陈旧 controller 声明] 清单声明了 ${cls} 的用例，但没有任何 wired 路由用到它 —— 删掉这条。`);
      continue;
    }
    const c = snapshot.controllers[cls];
    if (!c) continue;
    if (declared.useCases.length === 0 && !declared.note) {
      errors.push(
        `[空用例未说明] ${cls} 的 useCases 是空的却没写 note —— 直接吃仓储、不经 application 用例的 ` +
          `controller 可以存在（探针 / 只读访问位），但必须在清单里写明它为什么没有用例。`,
      );
    }
    const imported = new Set(c.applicationModules);
    for (const uc of declared.useCases) {
      if (!appKnown.has(uc)) {
        errors.push(`[用例不存在] ${cls} 声明的 application 用例 ${uc} 在 apps/api/src/application 下找不到。`);
        continue;
      }
      if (!imported.has(uc)) {
        errors.push(
          `[用例没被 controller 调用] ${cls} 声明了 ${uc}，但 ${c.file} 并没有 import 它 —— ` +
            `存在同名用例 ≠ 它被挂进了这条路由。`,
        );
      }
    }
  }

  /* ③（续）棘轮上限：mock 路由只减不增。 */
  if (counts.mock > manifest.ratchet.maxMockRoutes) {
    errors.push(
      `[棘轮回退] mock 豁免路由 ${counts.mock} 条，超过冻结上限 ${manifest.ratchet.maxMockRoutes} 条 —— ` +
        `清单只许变短。新增 mock 驱动的产品路由当场红。`,
    );
  }

  /* ⑩（续）wired 非空：全部路由都豁免掉的话，第 ⑥⑦⑧⑨ 条就一条都没在判。 */
  if (counts.wired === 0) {
    errors.push("[无接线样本] 清单里没有任何 wired 路由 —— 跨层判定全部平凡为真，视为失败。");
  }

  return { errors, counts };
}
