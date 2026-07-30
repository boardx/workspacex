/**
 * 出站端口的**契约一致性套件**（F47）
 *
 * ## 这个文件存在的理由
 * F47 是一条「桩」feature，它最容易变成的东西是：
 * 一个 `throw new Error("not implemented")` 配一条 `expect(true).toBe(true)`。
 * 那样的交付物在 CI 上是绿的，而它**一个字的契约都没有验**。
 *
 * ⇒ 这里的断言全部写成**对任意实现都成立**的形式：
 *   套件收一个 `(input) => Promise<unknown>`，**不认识**桩的内部。
 *   同一套断言在 phase-01 的桩与一个「假装是 phase-02」的成功实现上**都必须通过**——
 *   这就是「桩被真实实现替换时，契约不变」的可执行形式。
 *
 * ## 空集不许平凡为真
 * 每一条遍历集合的断言都配一条「集合为空时这条断言必须报违规」的反证
 * （`NO_CASES` / `NO_ARRAY_FIELDS` / `EMPTY_ERR_LIST`）。
 * 本仓已九次「全绿但空转」，遍历零个元素的 `for` 循环是其中最常见的一种。
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";
import * as files from "../../src/files";
import { PortInputInvalidError, type OutboundPortImpl } from "../../src/files-outbound-stubs";

type PortName = files.OutboundPortName;

/** 一次调用的结果。**成功与失败都是结果**——用异常表达失败会让断言写不整齐 */
export type Outcome = { kind: "ok"; value: unknown } | { kind: "err"; error: unknown };

export async function callPort(impl: OutboundPortImpl, input: unknown): Promise<Outcome> {
  try {
    return { kind: "ok", value: await impl(input) };
  } catch (error) {
    return { kind: "err", error };
  }
}

/**
 * 合法入参样例。⚠ 这是**测试夹具**，不是第二份契约：
 * 它必须先过 `OUTBOUND_PORTS[port].in.parse`，否则套件自己就红（见 `checkFixture`）。
 */
export const VALID_INPUT: Record<PortName, Record<string, unknown>> = {
  invalidateOntologyEdges: { artifactId: "art-1", versionIds: ["ver-1", "ver-2"] },
  annotateWithdrawnEvidence: { versionIds: ["ver-1"], reason: "受访者撤回授权" },
};

/** 从合法样例**机械派生**的空集变体：把每一个数组字段各清空一次 */
export function emptyArrayVariants(port: PortName): { field: string; input: Record<string, unknown> }[] {
  const base = VALID_INPUT[port];
  return Object.entries(base)
    .filter(([, v]) => Array.isArray(v))
    .map(([field]) => ({ field, input: { ...base, [field]: [] } }));
}

/* ───────────────── 纯检查函数（可被反证直接调用）───────────────── */

/** 契约自身：`err` 非空、每一码都在 `FilesError` 里、`in`/`out` 是 zod */
export function checkPortContract(port: PortName): string[] {
  const v: string[] = [];
  const p = files.OUTBOUND_PORTS[port];
  const codes = p.err as readonly string[];
  if (codes.length === 0) v.push(`EMPTY_ERR_LIST: ${port} 没有声明任何失败码——「不会失败」的跨阶段出站端口不存在`);
  for (const c of codes) {
    if (!files.FilesError.options.includes(c as never)) v.push(`UNKNOWN_ERR_CODE: ${port} 的 ${c} 不在 FilesError 里`);
  }
  if (typeof (p.in as z.ZodTypeAny)?.safeParse !== "function") v.push(`NOT_A_SCHEMA: ${port}.in`);
  if (typeof (p.out as z.ZodTypeAny)?.safeParse !== "function") v.push(`NOT_A_SCHEMA: ${port}.out`);
  return v;
}

/**
 * 单次调用的结果是否合契约。**这条不认识实现**：
 *   · 成功 ⇒ `out` 必须 strict-parse 通过（多一个键就是违规）
 *   · 失败 ⇒ 错误必须带 `code`，且该码在声明的 `err` 里
 */
export function checkOutcome(port: PortName, outcome: Outcome): string[] {
  const v: string[] = [];
  const p = files.OUTBOUND_PORTS[port];
  if (outcome.kind === "ok") {
    const parsed = (p.out as z.ZodTypeAny).safeParse(outcome.value);
    if (!parsed.success) {
      v.push(`OUT_SHAPE: ${port} 的成功响应不合 out —— ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.code}`).join(", ")}`);
    }
  } else {
    const code = (outcome.error as { code?: unknown })?.code;
    if (typeof code !== "string") {
      v.push(`UNTYPED_ERROR: ${port} 抛了一个不带 code 的错误（${String(outcome.error)}）——调用方无法把它映射到某一类级联失败`);
    } else if (!(p.err as readonly string[]).includes(code)) {
      v.push(`UNDECLARED_ERR: ${port} 抛的 ${code} 不在声明的 err ${JSON.stringify(p.err)} 里`);
    }
  }
  return v;
}

/** 幂等：同样入参两次调用，要么同样的值，要么同样的失败码 */
export function checkIdempotent(port: PortName, a: Outcome, b: Outcome): string[] {
  if (a.kind !== b.kind) return [`NOT_IDEMPOTENT: ${port} 两次同参调用一次 ${a.kind} 一次 ${b.kind}`];
  if (a.kind === "ok" && b.kind === "ok") {
    const same = JSON.stringify(a.value) === JSON.stringify(b.value);
    return same ? [] : [`NOT_IDEMPOTENT: ${port} 两次同参调用返回不同的值`];
  }
  const errOf = (o: Outcome) => (o.kind === "err" ? (o.error as { code?: unknown })?.code : undefined);
  const ca = errOf(a);
  const cb = errOf(b);
  return ca === cb ? [] : [`NOT_IDEMPOTENT: ${port} 两次同参调用失败码不同（${String(ca)} vs ${String(cb)}）`];
}

/**
 * 端口**不得**在 phase-01 长成一条 HTTP 路由。
 * 09-kg 的路由由 09-kg 在 phase-02 定；本束替它编一条，就是替别的模块做设计。
 */
export function checkPortIsNotAnOperation(port: PortName): string[] {
  const v: string[] = [];
  const ops = files.operations as Record<string, { path?: string }>;
  if (port in ops) v.push(`PORT_LEAKED_AS_OPERATION: ${port} 出现在 files.operations 里`);
  for (const [name, op] of Object.entries(ops)) {
    if (typeof op.path === "string" && op.path.toLowerCase().includes(port.toLowerCase())) {
      v.push(`PORT_LEAKED_AS_ROUTE: files.operations.${name} 的 path 含端口名 ${port}`);
    }
  }
  if ((files.OUTBOUND_PORTS[port] as Record<string, unknown>).method !== undefined) {
    v.push(`PORT_HAS_METHOD: ${port} 声明了 method —— HTTP 面属提供方（phase-02），不在这里定`);
  }
  return v;
}

/** 夹具本身合不合契约。没有这条，`VALID_INPUT` 写错时整套断言会一起变成「都在报错所以都对」 */
export function checkFixture(port: PortName): string[] {
  const parsed = (files.OUTBOUND_PORTS[port].in as z.ZodTypeAny).safeParse(VALID_INPUT[port]);
  return parsed.success ? [] : [`BAD_FIXTURE: ${port} 的 VALID_INPUT 不合 in schema`];
}

/**
 * 🔴 **空集不许平凡为真**：把「遍历一组用例」这件事本身也做成可检查的。
 * 用例数为 0 时必须报 `NO_CASES`，否则「一条都没跑」与「全过了」不可分辨。
 */
export function checkCaseCoverage(label: string, caseCount: number, min = 1): string[] {
  return caseCount >= min ? [] : [`NO_CASES: ${label} 只收集到 ${caseCount} 条用例（至少 ${min}）——遍历空集不算通过`];
}

/* ───────────────── 套件本体：对任意实现跑同一组断言 ───────────────── */

/**
 * ⚠ `impl` 的类型是 `(input: unknown) => Promise<unknown>`：
 *   **套件在类型上就够不到实现的内部**。桩换成真实现，这里一个字都不用改。
 */
export function runPortConformance(port: PortName, label: string, impl: OutboundPortImpl): void {
  describe(`${port} · ${label}`, () => {
    it("契约自身合法：err 非空且全在 FilesError 里，in/out 是 zod", () => {
      expect(checkPortContract(port)).toEqual([]);
      expect(checkFixture(port)).toEqual([]);
    });

    it("端口不是 phase-01 的 HTTP 操作（路由属提供方，phase-02 定）", () => {
      expect(checkPortIsNotAnOperation(port)).toEqual([]);
    });

    it("合法入参的结果合契约：成功则合 out（strict），失败则带已声明的 err 码", async () => {
      const outcome = await callPort(impl, VALID_INPUT[port]);
      expect(checkOutcome(port, outcome)).toEqual([]);
    });

    it("幂等：同参两次调用结果一致（retryCascade 依赖这一条）", async () => {
      const a = await callPort(impl, VALID_INPUT[port]);
      const b = await callPort(impl, VALID_INPUT[port]);
      expect(checkIdempotent(port, a, b)).toEqual([]);
    });

    it("in 是 strict 的：多一个键即拒（且拒的是入参错，不是端口不可用）", async () => {
      const outcome = await callPort(impl, { ...VALID_INPUT[port], extra: 1 });
      expect(outcome.kind).toBe("err");
      expect((outcome as { error: unknown }).error).toBeInstanceOf(PortInputInvalidError);
    });

    it("空集不得成为一次调用：每个数组字段清空都必须被拒", async () => {
      const variants = emptyArrayVariants(port);
      // 没有这一条，端口若哪天没有数组字段，上面的 for 会遍历零次并静默通过
      expect(checkCaseCoverage(`${port} 空集变体`, variants.length)).toEqual([]);
      for (const { field, input } of variants) {
        const outcome = await callPort(impl, input);
        expect(outcome.kind, `${field} 为空集时应当被拒`).toBe("err");
        expect((outcome as { error: unknown }).error, `${field} 为空集应报入参错`).toBeInstanceOf(PortInputInvalidError);
      }
    });
  });
}

/* ───────────────── 反证：不合规的实现必须被抓住 ───────────────── */

/**
 * 一组**故意写坏**的实现。每一个都必须让上面某条纯检查函数报违规。
 * 它们是这套断言的「反证套件」——没有它们，上面全绿也可能只是因为断言太松。
 */
export function brokenImpls(port: PortName): { name: string; check: () => string[] }[] {
  const okValue =
    port === "invalidateOntologyEdges"
      ? { invalidatedEdgeIds: ["e1"] }
      : { annotatedSectionIds: ["s1"], notifiedApprovers: ["u1"] };
  let n = 0;
  return [
    {
      name: "成功响应多一个键（out 不是 strict 就抓不到）",
      check: () => checkOutcome(port, { kind: "ok", value: { ...okValue, extra: 1 } }),
    },
    {
      name: "抛一个不带 code 的裸 Error（'not implemented' 桩就是这形状）",
      check: () => checkOutcome(port, { kind: "err", error: new Error("not implemented") }),
    },
    {
      name: "抛一个没声明过的错误码",
      check: () => checkOutcome(port, { kind: "err", error: { code: "SOMETHING_ELSE" } }),
    },
    {
      name: "不幂等：两次调用返回不同的值",
      check: () =>
        checkIdempotent(
          port,
          { kind: "ok", value: { ...okValue, marker: n++ } },
          { kind: "ok", value: { ...okValue, marker: n++ } },
        ),
    },
    {
      name: "用例集为空（遍历零个元素的断言）",
      check: () => checkCaseCoverage(`${port} 反证`, 0),
    },
  ];
}
