/**
 * `docs/coordination-protocol.md` 的任务流转行必须跟着 coord-gateway 的真实可达面走
 * （issue #381）。
 *
 * 修复前这一行写的是 `POST …/tasks/:id/ack·done·recall`：
 *   - `done` 是**状态名**，不是动作名——公开动作叫 `complete`（照着表打 `/done` 得 404）；
 *   - `recall` 被并列成同一个公开端点，实际它在 gateway 的 **admin 面**，普通 token 打过去
 *     一律 404。
 * 两处都是 AGENTS.md「静态痕迹 ≠ 动态事实」那个形状：一张排版工整、看起来权威的表，
 * 描述的是一个不存在的 API。所以判据不能是「表里写了 complete」这种自说自话的字符串，
 * 而要绑到会随实现变化的信号上——`auth.ts` 的 REST allowlist 与 `index.ts` 的 admin 路由。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const doc = read("docs/coordination-protocol.md");
const auth = read("apps/coord-gateway/src/auth.ts");
const index = read("apps/coord-gateway/src/index.ts");

/** `isAllowedRestSubpath` 里那条 `/tasks/:id/(ack|complete)` —— 普通 token 的真实可达动作。 */
function publicTaskActions(): string[] {
  const m = /\/\^\\\/tasks\\\/\\d\+\\\/\(([a-z|]+)\)\\?\$\//.exec(auth.replace(/\s/g, ""));
  if (!m?.[1]) throw new Error("auth.ts 里找不到 /tasks/:id/(…) 的 REST allowlist 正则——实现变了，先更新本门");
  return m[1].split("|");
}

/** 协议表里"状态流转"那几行。 */
function transitionRows(): string[] {
  return doc.split("\n").filter((line) => /^\|\s*`POST …\/tasks\/:id\//.test(line));
}

describe("coordination-protocol.md 的任务流转面（#381）", () => {
  const actions = publicTaskActions();
  const rows = transitionRows();

  it("门够得着东西：实现里确实有一条公开动作 allowlist，文档里确实有流转行", () => {
    expect(actions.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("公开面动作与 gateway 的 allowlist 逐个对齐（今天是 ack / complete）", () => {
    expect(actions).toEqual(["ack", "complete"]);
    const publicRow = rows.find((row) => !row.includes("admin"));
    expect(publicRow, "找不到描述公开流转面的那一行").toBeDefined();
    for (const action of actions) expect(publicRow).toContain(`/${action}`);
  });

  it("不把状态名 `done` 当动作写进端点——照着打会 404", () => {
    for (const row of rows) {
      expect(row, `端点列把状态名当成了动作：${row}`).not.toMatch(/`POST …\/tasks\/:id\/[^`]*\bdone\b/);
    }
  });

  it("recall 单独成行并标注 admin-only——实现里它确实走 admin 路由", () => {
    // index.ts 把 /tasks/:id/recall 与 POST /tasks 一起路由进 handleAdmin
    expect(index).toMatch(/\\\/\\d\+\\\/recall/);
    // 且不在普通 token 的 allowlist 里
    expect(actions).not.toContain("recall");
    const recallRow = rows.find((row) => row.includes("recall"));
    expect(recallRow, "协议表里没有 recall 这一行").toBeDefined();
    expect(recallRow).toMatch(/admin/i);
  });
});
