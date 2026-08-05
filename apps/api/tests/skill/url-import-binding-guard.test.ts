/**
 * #595 —— **生产到底把哪个取回器绑上去了。**
 *
 * ## 为什么现有的十四条反证一条都盖不住这件事
 *
 * `ImportSkillFromUrlDeps.fetch` 是端口。已有测试分别证了：
 *   · `import-source-guard`      —— 那个**函数**正确；
 *   · `import-fetch-wiring`      —— 那道门在**取回层**被调用；
 *   · `import-skill-from-url`    —— **用例**不吞拒绝；
 *   · `url-import-repo-guard`    —— **授权**存在且在取回之前。
 *
 * ⚠ **没有一条测的是「生产绑了谁」。** 绑一个不校验的取回器，
 *   上面四个文件**全绿**——两道 SSRF 门直接失效，而没有任何东西会红。
 *   这是我自己在 #603 未验证项里标红的口子（端口是我开的）。
 *
 * ## 断言的是**同一性**，不是「结构上看起来对」
 *
 * 按今晚 ④ / ⑦ / ⑭ 的教训：断言要覆盖的是「**谁**被绑上去了」，
 * 不是「绑定这段代码存在」。⇒ 用 `toBe`（引用相等）比对到
 * `fetchImportSource` 这个函数对象本身。
 *
 * ⚠ 这也是 `url-import-composition.ts` 刻意**不包 wrapper** 的原因：
 *   包一层之后同一性断言就写不出来了，只能退回到「看起来在调用它」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fetchImportSource } from "../../src/infrastructure/skill/http-import-fetcher";
import {
  PRODUCTION_IMPORT_FETCHER,
  composeImportSkillFromUrlDeps,
} from "../../src/infrastructure/skill/url-import-composition";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * 把**不构成装配**的三类文本剔掉，再去找裸的标识符。
 *
 * ⚠ 接 controller 时实测撞到三处误报，全都不是「第二处装配」：
 *   ① `composeImportSkillFromUrlDeps` **包含** `ImportSkillFromUrlDeps` 这个子串
 *      —— 于是**调用**装配器（`kernel.module.ts` 该做的事）被判成自己装配；
 *   ② `ImportSkillFromUrlDepsFactory` 同理 —— controller 注入的**工厂类型**被误判，
 *      而 controller 恰恰是因为不许自己装配才只拿这个类型的；
 *   ③ **注释里提到** `fetchImportSource` 也算命中 —— 本文件想钉住的是代码干了什么，
 *      不是谁在注释里引用了谁。
 *
 * ⚠ 剔除是**为了让门说真话，不是为了让门放行**：剔完之后，裸的
 *   `ImportSkillFromUrlDeps` / `fetchImportSource` 仍然一命中就红。
 *   下面有一条装置自检专门守着这件事——因为「为了消误报而顺手把真违规也抹掉」
 *   会让这条断言变成永远绿，而永远绿的门就是本 issue 反复撞到的空转。
 */
function stripNonAssemblyText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .replace(/\/\/[^\n]*/g, "") // 行注释
    .split("composeImportSkillFromUrlDeps")
    .join("<composer>")
    .split("ImportSkillFromUrlDepsFactory")
    .join("<factoryType>");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("生产装配绑的必须是带两道门的那个取回器", () => {
  /** 核心断言：**同一性**。绑任何别的东西——包括一个"看起来一样"的 wrapper——都红。 */
  it("PRODUCTION_IMPORT_FETCHER 就是 fetchImportSource 本身", () => {
    expect(PRODUCTION_IMPORT_FETCHER).toBe(fetchImportSource);
  });

  it("装配出来的 deps.fetch 也是同一个函数对象", () => {
    const deps = composeImportSkillFromUrlDeps({
      db: {} as never,
      identities: {} as never,
      localOnlyOrg: false,
    });
    expect(deps.fetch).toBe(fetchImportSource);
    // 顺带钉住其余两件，防止装配悄悄换掉仓储或放开本地组织策略。
    expect(deps.repository).toBeInstanceOf(PgSkillUrlImportRepository);
    expect(deps.policy).toEqual({ localOnlyOrg: false });
  });

  it("localOnlyOrg 如实透传（不是被写死成 false）", () => {
    const deps = composeImportSkillFromUrlDeps({
      db: {} as never,
      identities: {} as never,
      localOnlyOrg: true,
    });
    expect(deps.policy).toEqual({ localOnlyOrg: true });
  });

  /**
   * 唯一装配点。⚠ 同一性断言只能证明**这一处**绑对了；
   * 第二处装配可以绑别的东西而上面三条全绿——所以必须同时钉住「只有一处」。
   */
  it("src/ 下只有 url-import-composition.ts 组装 ImportSkillFromUrlDeps", () => {
    const offenders = walk(SRC).filter((file) => {
      if (file.endsWith("url-import-composition.ts")) return false;
      const source = stripNonAssemblyText(readFileSync(file, "utf8"));
      // 装配的判据：同时出现 fetch 端口名与用例 deps 类型 / 或直接引用取回器实现。
      return (
        source.includes("ImportSkillFromUrlDeps") ||
        source.includes("fetchImportSource") ||
        source.includes("IMPORT_SOURCE_FETCHER")
      );
    });
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([
      // 用例自己定义端口类型，允许出现这些标识符；它不做装配。
      "application/skill-import/import-skill-from-url.ts",
      // 取回器实现自身。
      "infrastructure/skill/http-import-fetcher.ts",
    ]);
  });

  /**
   * 装置自检：`stripComposerName` **没有把真正的违规也一起抹掉**。
   *
   * ⚠ 这条必须存在。为了消掉一个误报而做的字符串剔除，最容易的失败模式就是
   *   顺手把真违规也剔掉了——那样上面那条断言会**永远绿**，
   *   而「永远绿的门」正是本 issue 反复撞到的东西。
   */
  it("装置自检：剔除之后，裸的 deps 类型名与取回器名仍然会被判为违规", () => {
    // 真违规必须活下来。
    expect(stripNonAssemblyText("const d: ImportSkillFromUrlDeps = {…}")).toContain(
      "ImportSkillFromUrlDeps",
    );
    expect(stripNonAssemblyText("const f = fetchImportSource;")).toContain("fetchImportSource");
    // 三类误报必须被剔干净。
    expect(stripNonAssemblyText("composeImportSkillFromUrlDeps({…})")).not.toContain(
      "ImportSkillFromUrlDeps",
    );
    expect(stripNonAssemblyText("let x: ImportSkillFromUrlDepsFactory;")).not.toContain(
      "ImportSkillFromUrlDeps",
    );
    expect(stripNonAssemblyText("/* 注释里提到 fetchImportSource */")).not.toContain(
      "fetchImportSource",
    );
    expect(stripNonAssemblyText("// 注释里提到 fetchImportSource")).not.toContain(
      "fetchImportSource",
    );
  });

  /**
   * 「装配只有一处」的另一半：**接进 DI 的也只有一处**。
   *
   * ⚠ 装配函数正确、却根本没被接进容器，是一个上面所有断言都盖不住的失效——
   *   那时 controller 拿到的是别的东西，而本文件仍然全绿。
   *   `url-import-http-route.test.ts` 从真实容器解析 token 核对同一性；
   *   这里补的是它的静态对偶：**谁**有资格调用装配器。
   */
  it("src/ 下只有 kernel.module.ts 调用装配器（组合根是唯一接线点）", () => {
    const callers = walk(SRC).filter((file) => {
      if (file.endsWith("url-import-composition.ts")) return false;
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      return source.includes("composeImportSkillFromUrlDeps");
    });
    expect(callers.map((f) => f.slice(SRC.length + 1))).toEqual(["kernel.module.ts"]);
  });

  /** 装置自检：扫描器真的在扫文件，不是恒返回空集。 */
  it("装置自检：扫描器确实遍历到了 src 下的文件", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("url-import-composition.ts"))).toBe(true);
  });
});
