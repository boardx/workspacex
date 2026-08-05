/**
 * #467 —— 把 `pg-thread-mount-store.ts` 那条 `lint-permission-paths` 豁免的**前提**
 * 钉成机械事实，而不是只写在 allowlist 的理由里。
 *
 * 豁免的理由有两半，两半都在这里被断言：
 *
 *   ① **它只碰 `thread_skill_mounts` 一张表。** 一旦有人在这个仓储里 JOIN 上
 *      `artifacts` / `chat_messages` 之类，它就变成了一个未经判定的内容读出口，
 *      而 allowlist 那一行会继续对它生效——这正是「豁免会长大」的形状。
 *   ② **它吐出的字段不超过 `ThreadSkillMount` 的六个。** 那六个全是标识符与时间戳
 *      （mountId / threadId / skillId / versionId / mountedAt / removedAt），
 *      没有一个是 Artifact/Segment 内容。多返回一个字段就可能是内容泄露。
 *
 * ⚠ 授权发生在**这个文件被调用之前**：`skill-mount.controller.ts` 三条路由各自先
 *   解析 `project_memberships`（写路径要 `isSelfMountAllowed`，读路径要在项目里），
 *   与 F119 / F124 / F125 那三条豁免同一个形状——权限在前，仓储在后。
 *   第三条断言因此钉住「controller 里那三道门还在」。
 *
 * 这个文件被删掉时，allowlist 里那一行必须跟着删。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STORE = join(__dirname, "../../src/infrastructure/skill/pg-thread-mount-store.ts");
const CONTROLLER = join(
  __dirname,
  "../../src/interface/controllers/skill-mount.controller.ts",
);

/**
 * ⚠ 先剥注释再扫。本文件的文件头**逐字写着** `withoutTenant`（在解释「为什么没有它」），
 *   直接对全文 `toContain` 会把那句解释判成违规——实测就是这么红了一次。
 *   一条会被自己的说明文字触发的断言，最后只会被人加白名单绕过去。
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("#467 thread-mount 仓储的权限豁免前提", () => {
  const source = code(readFileSync(STORE, "utf8"));

  it("① 只名到 `thread_skill_mounts` 一张表：FROM / INTO / UPDATE / JOIN 后面没有第二个表名", () => {
    const named = [...source.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1]!.toLowerCase())
      // `ON CONFLICT … DO UPDATE SET` 里的 `SET` 不是表名。剔的是关键字，不是某张表——
      // 剔表名会让这条断言失去意义。
      .filter((name) => name !== "set");
    // 反空转：匹配器必须真的匹配到东西，否则「没有第二张表」是因为它谁都没匹配到。
    expect(named.length).toBeGreaterThan(0);
    expect([...new Set(named)]).toEqual(["thread_skill_mounts"]);
  });

  it("① 之二：没有 `withoutTenant`——那条路会关掉 RLS 并把「读到 0 行」伪装成「没有数据」", () => {
    expect(source).not.toContain("withoutTenant");
    // 正样本：它确实用了带租户的那条。
    expect(source).toContain("withTenant");
  });

  it("② 吐出的键不超过 `ThreadSkillMount` 的六个", () => {
    const mapper = /function toMount\([\s\S]*?\n}/.exec(source)?.[0] ?? "";
    expect(mapper).not.toBe("");
    const keys = [...mapper.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]!);
    expect(new Set(keys)).toEqual(
      new Set(["mountId", "threadId", "skillId", "versionId", "mountedAt", "removedAt"]),
    );
  });

  /**
   * ⚠ 这一条原本写的是四行 `expect(controller).toContain("assertProjectMember")` 之类，
   *   **它是空转的** —— coord-main 造反证时把读路由里的
   *   `await this.assertProjectMember(...)` 整行注释掉，这条断言**照样绿**：
   *   `toContain` 命中的是同文件下方那个 `private async assertProjectMember` 的
   *   **定义本身**，只要私有方法还在，字符串就永远在。
   *
   *   ⇒ 一条「查名字在不在文件里」的断言，防不住「路由忘了调它」——
   *     而那正是它声称要防的唯一那件事。这条豁免的许可证有一半是它给的，
   *     所以它必须真的能红。
   *
   * 改成断言**调用点的先后**：在每个路由方法体内，那道门必须出现在仓储调用之前。
   * 「之前」是这条豁免的全部内容（权限在前，仓储在后），所以断言也只断这一件。
   */
  it("③ 三条路由各自在**调用仓储之前**过一道门（断调用点顺序，不是断名字存在）", () => {
    const controller = code(readFileSync(CONTROLLER, "utf8"));

    /** 取某个路由方法的方法体：从方法名那行到下一个同级 `@Get/@Post/@Delete` 或私有方法。 */
    function bodyOf(marker: string): string {
      const start = controller.indexOf(marker);
      expect(start, `路由 ${marker} 不见了`).toBeGreaterThan(-1);
      const rest = controller.slice(start + marker.length);
      const end = rest.search(/\n\s*(@(Get|Post|Delete|Put|Patch)\(|private\s)/);
      return end === -1 ? rest : rest.slice(0, end);
    }

    // ⚠ 三条路由的不变量**不是同一条**，所以不能用同一个「先后」模板去套。
    //   coord-main 第一版就这么套了，结果在 mount 路由上误红：那里
    //   `this.deliverRoleOf(...)` 是作为**实参**在 `mountSkillToThread(...)` 内部求值的
    //   —— 文本上在后，执行上在前。**红了但红得不对**，断言被改正而不是把代码改去迁就它。

    // ① 摘除 / 读：门是 controller 里的一句 await，必须**文本上也在**仓储调用之前。
    for (const { marker, gate, store } of [
      { marker: "async unmount(", gate: "assertMayWriteMounts(", store: "unmountSkillFromThread(" },
      { marker: "async deviations(", gate: "assertProjectMember(", store: "listThreadDeviations(" },
    ] as const) {
      const body = bodyOf(marker);
      const gateAt = body.indexOf(gate);
      const storeAt = body.indexOf(store);
      expect(gateAt, `${marker} 里找不到门 ${gate} 的调用点`).toBeGreaterThan(-1);
      expect(storeAt, `${marker} 里找不到仓储调用 ${store}`).toBeGreaterThan(-1);
      expect(gateAt, `${marker}：门 ${gate} 必须在仓储调用 ${store} 之前`).toBeLessThan(storeAt);
    }

    // ② 挂载：判定**在用例里**（domain 的 `isSelfMountAllowed`），controller 的义务是
    //   把角色**从服务端解析出来交进去**。所以这里断的是「role 不来自请求体」——
    //   那才是这条路由唯一可能被绕开的方式。
    const mountBody = bodyOf("async mount(");
    expect(mountBody, "挂载路由必须服务端解析角色").toContain("this.deliverRoleOf(");
    expect(
      /role:\s*(body|input|request)\./.test(mountBody),
      "挂载路由的 role 不得取自请求体——那等于让前端自称是引导师",
    ).toBe(false);

    // 门的实现本身仍要落在真实的成员关系查询上，不是一个恒真的桩。
    expect(controller).toContain("findProjectMembership");
  });
});
