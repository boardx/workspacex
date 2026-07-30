import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as identity from "../src/identity";
import * as artifact from "../src/artifact";
import * as contextPack from "../src/context-pack";
import * as project from "../src/project";
import * as interview from "../src/interview";
import * as recording from "../src/recording";
import * as canvas from "../src/canvas";
import * as chat from "../src/chat";

/**
 * 契约自身的形状约束（ADR-020）
 *
 * 这些不是业务测试——业务断言在各 feature 的 verification 里。
 * 这里保证的是**契约本身写得合法**，因为它要生成四样下游产物
 * （后端 DTO / 前端类型 / OpenAPI / mock），任何一处形状不对，
 * 四样都会一起错，而且是在联调时才发现。
 */

const BUNDLES = [
  ["identity", identity.operations],
  ["artifact", artifact.operations],
  ["context-pack", contextPack.operations],
  ["project", project.operations],
  // ── phase-01 束（不加进来 = 这三道门对新契约不生效）──
  ["interview", interview.operations],
  ["recording", recording.operations],
  ["canvas", canvas.operations],
  ["chat", chat.operations],
] as const;

type Op = {
  method?: string;
  path?: string;
  in?: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  err?: readonly string[];
};

describe.each(BUNDLES)("契约束 %s", (_name, ops) => {
  const entries = Object.entries(ops as Record<string, Op>);

  it("每个操作都有 method / path / in / out / err 五件", () => {
    for (const [opName, op] of entries) {
      expect(op.method, `${opName} 缺 method`).toBeTruthy();
      expect(op.path, `${opName} 缺 path`).toBeTruthy();
      expect(op.in, `${opName} 缺 in`).toBeTruthy();
      expect(op.out, `${opName} 缺 out`).toBeTruthy();
      // ⚠ err 可以是空数组（表示该操作不会失败），但**不能缺**——
      //   缺了说明作者没想过失败模式，而「失败长什么样」是契约的一半
      expect(Array.isArray(op.err), `${opName} 缺 err（可为空数组，但不能没有）`).toBe(true);
    }
  });

  it("path 在束内唯一", () => {
    const seen = new Map<string, string>();
    for (const [opName, op] of entries) {
      const key = `${op.method} ${op.path}`;
      expect(seen.has(key), `${key} 被 ${seen.get(key)} 与 ${opName} 重复占用`).toBe(false);
      seen.set(key, opName);
    }
  });

  it("in / out 是可解析的 zod schema", () => {
    for (const [opName, op] of entries) {
      expect(typeof op.in!.safeParse, `${opName}.in 不是 zod schema`).toBe("function");
      expect(typeof op.out!.safeParse, `${opName}.out 不是 zod schema`).toBe("function");
    }
  });

  it("out 不是 ZodEffects —— 否则 mock 生成器会退化成 null", () => {
    // gen-mock.ts 的 sample() 按 _def.typeName 分派；`.refine()` 会把 schema 包成
    // ZodEffects，sample() 命中不到内层结构，整个响应样例变成 null。
    // ⇒ 跨字段约束请写进 domain 的不变量与 application 层强制，不要用 refine 包 out。
    for (const [opName, op] of entries) {
      const t = (op.out as unknown as { _def: { typeName: string } })._def.typeName;
      expect(t, `${opName}.out 是 ${t}，会让 mock 生成器产出 null`).not.toBe("ZodEffects");
    }
  });

  it("err 里的错误码全大写下划线，且束内不重复", () => {
    for (const [opName, op] of entries) {
      const codes = op.err ?? [];
      expect(new Set(codes).size, `${opName} 的 err 有重复项`).toBe(codes.length);
      for (const c of codes) {
        expect(c, `${opName} 的错误码 ${c} 不是 SCREAMING_SNAKE_CASE`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });
});

describe("跨束一致性", () => {
  it("path 在所有束之间也不冲突", () => {
    const seen = new Map<string, string>();
    for (const [bundle, ops] of BUNDLES) {
      for (const [opName, op] of Object.entries(ops as Record<string, Op>)) {
        const key = `${op.method} ${op.path}`;
        expect(
          seen.has(key),
          `${key} 在 ${seen.get(key)} 与 ${bundle}.${opName} 之间冲突`,
        ).toBe(false);
        seen.set(key, `${bundle}.${opName}`);
      }
    }
  });

  it("每个束至少有一个操作", () => {
    for (const [bundle, ops] of BUNDLES) {
      expect(Object.keys(ops).length, `${bundle} 没有任何操作`).toBeGreaterThan(0);
    }
  });
});
