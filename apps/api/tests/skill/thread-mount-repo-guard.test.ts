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

  it("③ 三条路由都在调用仓储之前解析项目成员关系（权限在前，仓储在后）", () => {
    const controller = code(readFileSync(CONTROLLER, "utf8"));
    // 写路径：挂载把角色交给用例判，摘除走 controller 里复用 domain 谓词的那道门。
    expect(controller).toContain("deliverRoleOf");
    expect(controller).toContain("assertMayWriteMounts");
    // 读路径：要求「你在这个项目里」。
    expect(controller).toContain("assertProjectMember");
    expect(controller).toContain("findProjectMembership");
  });
});
