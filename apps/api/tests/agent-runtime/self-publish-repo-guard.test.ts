/**
 * #660 —— `lint-permission-paths` 白名单条目
 * `src/infrastructure/agent/pg-self-publish-agent-repository.ts` 的**守卫测试**。
 *
 * 与 `create-agent-repo-guard.test.ts` 同一形状、同一理由：那条白名单条目声称
 * 「授权已在 `self-publish-toolless-agent.ts` 中、且在仓储调用之前发生」——
 * ⚠ 一条只是一句声明的白名单条目是「写下时为真、上游改动后为假」的标准形状，
 *   且没有任何东西会红。本文件把那句声明变成机械事实。
 *
 * ## ⚠ 本文件比创建那条多守一件事：**判定的位置**
 *
 * 自助发布是一条**尚未签核的例外边**（`KNOWN_CONTRACT_GAPS.AR11`），它的正当性
 * 全部压在「domain 门确实跑过、且跑在落库之前」这一件事上。判定若被挪到落库之后、
 * 或被 controller 复述一份，这条边就从"受门控的例外"退化成"一条直达发布的路由"——
 * 而那正是 `SKILLS_FORBIDDEN_ROUTES` 逐字禁止过的形状。所以这里额外断言
 * `checkToollessSelfPublish` 的调用排在 `deps.repository.publish` 之前。
 *
 * ⛔ **若本文件被删除，那条白名单条目必须一起删除。**
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const REPO = new URL(
  "../../src/infrastructure/agent/pg-self-publish-agent-repository.ts",
  import.meta.url,
);
const USE_CASE = new URL(
  "../../src/application/agent/self-publish-toolless-agent.ts",
  import.meta.url,
);

const repoSource = readFileSync(REPO, "utf8");
const useCaseSource = readFileSync(USE_CASE, "utf8");

/**
 * 本仓储**允许**命名的三张租户表——与 `pg-system-agent-repository.ts` 白名单条目
 * 里那三张同一组，因为落库形状就是照抄它的（一行 agents + 一行 agent_versions +
 * 一行 capability_listings）。多一张就说明这个文件长出了新的读面。
 */
const ALLOWED_TABLES = new Set(["agents", "agent_versions", "capability_listings"]);

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

describe("#660 白名单条目的前提：仓储侧", () => {
  it("只命名允许的三张租户表", () => {
    const unexpected = [...tablesNamedIn(repoSource)].filter((t) => !ALLOWED_TABLES.has(t));
    expect(unexpected).toEqual([]);
  });

  /** 正样本：尺子有效——它确实认得出表名，不是恒返回空集。 */
  it("装置自检：解析器真的能认出表名", () => {
    expect(tablesNamedIn(repoSource).has("agent_versions")).toBe(true);
    expect(tablesNamedIn("SELECT 1 FROM some_other_table")).toEqual(new Set(["some_other_table"]));
  });

  it("从不使用 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

describe("#660 白名单条目的前提：授权确实存在，且在仓储调用之前", () => {
  it("用例层有 admin 组织成员判定", () => {
    expect(useCaseSource).toContain("findOrgMembership");
    expect(useCaseSource).toContain('orgRole !== "admin"');
    expect(useCaseSource).toContain('"ROLE_INSUFFICIENT"');
  });

  it("授权判定排在 findForSelfPublish / publish 两个仓储调用之前", () => {
    const authAt = useCaseSource.indexOf("findOrgMembership");
    const findAt = useCaseSource.indexOf("deps.repository.findForSelfPublish(");
    const publishAt = useCaseSource.indexOf("deps.repository.publish(");
    expect(authAt).toBeGreaterThan(-1);
    expect(findAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(findAt);
    expect(authAt).toBeLessThan(publishAt);
  });
});

describe("#660 这条例外边的正当性前提：domain 门跑在落库之前", () => {
  it("用例调用 checkToollessSelfPublish，且排在 deps.repository.publish 之前", () => {
    const gateAt = useCaseSource.indexOf("checkToollessSelfPublish(");
    const publishAt = useCaseSource.indexOf("deps.repository.publish(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(publishAt);
  });

  /**
   * ⚠ 判据只有一处。controller 里再写一个「没工具才放行」的分支，就是同一条规则的
   * 第二份副本——本仓已经五次因此漂移，而这一次漂移的方向恰好是**放行**。
   */
  it("controller 不复述任何一条判据（不出现 toolWhitelist / skillMounts / publishState 的判断）", () => {
    const controller = readFileSync(
      new URL("../../src/interface/controllers/agent.controller.ts", import.meta.url),
      "utf8",
    );
    const selfPublishMethod = controller.slice(controller.indexOf("async selfPublish("));
    expect(selfPublishMethod).not.toContain("toolWhitelist.length");
    expect(selfPublishMethod).not.toContain("skillMounts.length");
    expect(selfPublishMethod).not.toContain('=== "草稿"');
  });
});
