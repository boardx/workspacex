/**
 * F176 —— 把 `pg-message-rating-repository.ts` 那条 `lint-permission-paths` 豁免的
 * **四个前提**钉成机械事实，而不是只写在 allowlist 的理由里。
 *
 * 这条豁免比 #467 那条**危险**，因为它多碰三张表（`chat_messages` / `agent_runs` /
 * `skill_versions`）。所以前提也更窄，逐条对应 allowlist 里那段话：
 *
 *   ① 名到的表**恰好**是那五张——多 JOIN 一张就是一个未经判定的读出口，
 *      而 allowlist 那一行会继续对它生效（「豁免会长大」的形状）。
 *   ② **一个内容列都不选**。尤其 `chat_messages.body`：那三张表只为归因而读，
 *      交出来的是三个标识符。一旦有人为了「顺便省一次查询」把 body 带上，
 *      这个仓储就成了绕过可见性判定的消息内容出口。
 *   ③ 没有 `withoutTenant`——用它等于关掉 RLS 后读到「没有数据」而不是报错。
 *   ④ 授权发生在**仓储被调用之前**：`submit-message-rating.ts` 先跑
 *      `findMessageLocation` + `resolveVisibility`，之后才碰 `deps.ratings`。
 *      ⚠ 这条按**字符下标**断言顺序，不是「文件里出现过这两个词」——
 *      把检查挪到 `deps.ratings.resolveForMessage` 之后，词还在，门已经没了。
 *
 * 这个文件被删掉时，allowlist 里那一行与 `permission-propagation-six-paths` 的
 * 上限 54 必须跟着回退。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../src/infrastructure/skill/pg-message-rating-repository.ts");
const USECASE = join(__dirname, "../../src/application/skill/submit-message-rating.ts");

/**
 * ⚠ 先剥注释再扫。本仓有过实测教训：解释「为什么没有 withoutTenant」的那句注释
 *   自己把断言打红过一次，而会被自己的说明文字触发的检查最后只会被人绕过去。
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ALLOWED_TABLES = [
  "message_ratings",
  "rating_data_quality_entries",
  "chat_messages",
  "agent_runs",
  "skill_versions",
].sort();

describe("F176 评价仓储的权限豁免前提", () => {
  const source = code(readFileSync(REPO, "utf8"));

  it("① 名到的表恰好是允许的五张", () => {
    const named = [
      ...source.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi),
    ].map((m) => m[1]!.toLowerCase());
    expect(named.length, "一条 SQL 都没扫到 —— 这条断言正在空转").toBeGreaterThan(0);
    expect([...new Set(named)].sort()).toEqual(ALLOWED_TABLES);
  });

  it("② 一个内容列都不选 —— 尤其 chat_messages.body", () => {
    // 归因只要三个标识符。列在这里的每一个都是「读了就等于绕过可见性判定」的东西。
    for (const forbidden of [/\bm\.body\b/, /\bbody\b/, /\bprompt_template\b/, /\braw_transcript\b/]) {
      expect(source, `选了内容列：${forbidden}`).not.toMatch(forbidden);
    }
    // 阳性对照：三个归因标识符**确实**被选了，否则上面只是在为「这个文件什么都不查」背书。
    for (const wanted of ["agent_id", "skill_version_ids", "skill_id"]) {
      expect(source, `没有查 ${wanted} —— 归因不可能成立`).toContain(wanted);
    }
  });

  it("③ 没有 withoutTenant", () => {
    expect(source).not.toContain("withoutTenant");
    // 阳性对照：确实每处都走 withTenant。
    expect((source.match(/withTenant/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("④ 两道前置检查仍在，且位置在第一次 deps.ratings.* 之前", () => {
    const usecase = code(readFileSync(USECASE, "utf8"));
    const location = usecase.indexOf("findMessageLocation");
    const visibility = usecase.indexOf("resolveVisibility(");
    const firstRepoTouch = usecase.indexOf("deps.ratings.");

    expect(location, "findMessageLocation 不见了").toBeGreaterThan(-1);
    expect(visibility, "resolveVisibility 不见了").toBeGreaterThan(-1);
    expect(firstRepoTouch, "用例根本没碰仓储 —— 断言在空转").toBeGreaterThan(-1);

    // ⚠ 顺序才是门。词还在但挪到了仓储之后，门就没了。
    expect(location, "findMessageLocation 跑在仓储之后").toBeLessThan(firstRepoTouch);
    expect(visibility, "resolveVisibility 跑在仓储之后").toBeLessThan(firstRepoTouch);

    // 不是 allow 就抛：光调用 resolveVisibility 而不看结果等于没判。
    expect(usecase).toMatch(/outcome\.kind\s*!==\s*"allow"[\s\S]{0,60}throw/);
  });
});
