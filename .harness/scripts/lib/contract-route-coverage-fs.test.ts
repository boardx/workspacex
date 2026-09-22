/**
 * 真仓库上的**反空洞**检查（issue #1177）。
 *
 * fixture 单测证明「判据对不对」，这一份证明「它今天真的扫到了东西」。
 * 本仓栽过一次这个跟头：`lint-body-path-param-leak` 上线当天的正则漏了
 * `apiRequest<T>(` 形态，实际只扫了 5.7% 的调用点，而「117 个文件、0 处泄漏」
 * 的结论看起来一样绿。一道扫了 0 行的门永远是绿的。
 *
 * ⚠ 这里**不**断言某条具体缺口存在。缺口是会被人补掉的（`rateMessage` 就是：
 *   issue 登记时它没有路由，F176 在 2026-08-14 补上了），把「某条还红着」写进
 *   测试，等于让别人修好缺陷的那个 PR 变红。
 */
import { describe, expect, it } from "vitest";
import { contractRouteCoverage, loadBundleInputs, loadInterfaceRoutes } from "./contract-route-coverage-fs";

describe("真仓库扫描不是空转", () => {
  const { routes, unresolved, filesScanned } = loadInterfaceRoutes();

  it("interface 目录真的被扫到了", () => {
    expect(filesScanned).toBeGreaterThan(50);
    expect(routes.length).toBeGreaterThan(100);
  });

  it("符号引用形态（`@Get(C.operations.x.path)`）解析得出来", () => {
    expect(routes.filter((r) => r.operationRef !== null).length).toBeGreaterThan(0);
  });

  it("字面量路径形态也解析得出来，且都已归一成 `/` 开头", () => {
    const literal = routes.filter((r) => r.path !== null);
    expect(literal.length).toBeGreaterThan(100);
    expect(literal.every((r) => r.path!.startsWith("/"))).toBe(true);
  });

  it("解析不了的路由表达式是少数 —— 多了说明解析器跟不上写法，判据的地基就松了", () => {
    expect(unresolved.length).toBeLessThan(routes.length * 0.05);
  });
});

describe("真仓库判定", () => {
  const report = contractRouteCoverage();

  it("至少有一个束进入判定范围", () => {
    expect(report.bundles.filter((b) => b.inScope).length).toBeGreaterThan(0);
  });

  it("每个不判的束都带着为什么不判", () => {
    for (const b of report.bundles.filter((x) => !x.inScope)) expect(b.reason).not.toBe("");
  });

  it("有路由的 operation 不进缺口清单 —— 匹配器对真文件同样有效", () => {
    // `POST /messages/:messageId/rating`（F68 契约，F176 落的路由）今天真的存在。
    // 它一旦被误报，说明 controller 前缀拼接或路径归一在真文件上失效了。
    expect(report.gaps.map((g) => g.operation)).not.toContain("rateMessage");
  });

  it("缺口清单里没有任何一条被路由符号引用过（自洽性）", () => {
    const referenced = new Set(
      loadInterfaceRoutes()
        .routes.map((r) => r.operationRef)
        .filter((n): n is string => n !== null),
    );
    for (const g of report.gaps) expect(referenced.has(g.operation)).toBe(false);
  });

  it("判定范围里确实有 operation（束选出来了但一条都没扫到＝空转）", () => {
    expect(report.operationsInScope).toBeGreaterThan(0);
  });

  it("束的入参齐备：进入范围的束都指得出自己的契约文件", () => {
    for (const b of loadBundleInputs().filter((x) => x.contractFile !== null)) {
      expect(b.contractSource).not.toBeNull();
    }
  });
});
