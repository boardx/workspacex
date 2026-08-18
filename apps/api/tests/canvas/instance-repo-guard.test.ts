/**
 * 豁免的载荷：`lint-permission-paths.mjs` 的白名单条目
 * （#1493 `pg-canvas-instance-repository.ts`）。纯静态解析源码，不需要 Postgres——
 * 同 `advance-segment-repo-guard.test.ts` 的写法。
 *
 * 豁免的论证（allowlist 条目逐字）：内容披露都发生在权限判定**之后**——
 * `get-canvas-source.ts` 先 `authorize` 再 `findVersion`；`update-canvas-source.ts`
 * 先比对 `group_id`（NOT_IN_GROUP）再 `appendVersion`。先于判定的 `findInstance`
 * 是 identity-repository 形状：判定需要行上的 workshopId/groupId 才问得出问题，
 * 且它不返回 markdown。本文件把这四个前提钉成断言，而不是留成一句注释。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const stripped = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

const REPO = at("../../src/infrastructure/canvas/pg-canvas-instance-repository.ts");
const GET_UC = at("../../src/application/canvas/get-canvas-source.ts");
const UPDATE_UC = at("../../src/application/canvas/update-canvas-source.ts");
const RENDER_UC = at("../../src/application/canvas/render-canvas.ts");
const EXPORT_UC = at("../../src/application/canvas/export-canvas-source.ts");
const STICKY_UC = at("../../src/application/canvas/apply-sticky-change.ts");

describe("#1493 · 豁免前提 (a)(b)(c)：仓储只碰三张表、不越租户、findInstance 不带内容", () => {
  // 第三块（applyStickyChange）把修订链表 canvas_sticky_revisions 纳入同一豁免：
  // 它存的是 patch/clientTs/指针，读它的 findCurrentStickyRevision 只在组归属判定
  // 之后被调用（下方 STICKY_UC 顺序断言），写它的 applyStickyRevision 同理。
  it("全部 FROM/JOIN/INTO/UPDATE 只命名 canvas_instances / canvas_instance_versions / canvas_templates / canvas_sticky_revisions", () => {
    const code = stripped(REPO);
    // `appendVersion` 的 CTE 名（`WITH bump AS ...`）不是表——先收集所有 WITH 定义名再剔除。
    const cteNames = new Set(
      [...code.matchAll(/\bWITH\s+(\w+)\s+AS\b/gi)].map((m) => m[1]!.toLowerCase()),
    );
    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)]
      .map((m) => m[1]!.toLowerCase())
      .filter((name) => !cteNames.has(name));
    expect(refs.length, "一条表引用都没扫到——本断言在空转").toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(
      new Set([
        "canvas_instances",
        "canvas_instance_versions",
        "canvas_templates",
        "canvas_sticky_revisions",
      ]),
    );
  });

  it("从不调用 withoutTenant", () => {
    expect(stripped(REPO)).not.toMatch(/withoutTenant/);
  });

  it("findInstance 的 SELECT 不含 markdown 列", () => {
    const code = stripped(REPO);
    const start = code.indexOf("async findInstance");
    const end = code.indexOf("async findVersion");
    expect(start, "findInstance 没找到——断言在空转").toBeGreaterThan(-1);
    const body = code.slice(start, end);
    expect(body).toMatch(/SELECT/);
    expect(body).not.toMatch(/markdown/);
  });
});

describe("#1493 · 豁免前提 (d)：判定先于内容披露", () => {
  it("get-canvas-source.ts：authorize 在 findVersion 之前", () => {
    const code = stripped(GET_UC);
    const auth = code.indexOf("authorize(");
    const read = code.indexOf(".findVersion(");
    expect(auth, "authorize 调用消失了——豁免条目随之失效").toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(read);
  });

  it("update-canvas-source.ts：NOT_IN_GROUP 判定在 appendVersion 之前", () => {
    const code = stripped(UPDATE_UC);
    const check = code.indexOf('"NOT_IN_GROUP"');
    const write = code.indexOf(".appendVersion(");
    expect(check, "组归属判定消失了——豁免条目随之失效").toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
  });

  // 第二块（render/export）沿用同一豁免——同样把顺序钉成断言。
  it("render-canvas.ts：authorize 在 findVersion 之前", () => {
    const code = stripped(RENDER_UC);
    const auth = code.indexOf("authorize(");
    const read = code.indexOf(".findVersion(");
    expect(auth, "authorize 调用消失了——豁免条目随之失效").toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(read);
  });

  it("export-canvas-source.ts：NOT_IN_GROUP 判定在 findVersion 之前", () => {
    const code = stripped(EXPORT_UC);
    const check = code.indexOf('"NOT_IN_GROUP"');
    const read = code.indexOf(".findVersion(");
    expect(check, "组归属判定消失了——豁免条目随之失效").toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(check).toBeLessThan(read);
  });

  // 第三块（applyStickyChange）沿用同一豁免——组归属判定先于任何内容读与任何写。
  it("apply-sticky-change.ts：NOT_IN_GROUP 判定在 findVersion / applyStickyRevision 之前", () => {
    const code = stripped(STICKY_UC);
    const check = code.indexOf('"NOT_IN_GROUP"');
    const read = code.indexOf(".findVersion(");
    const write = code.indexOf(".applyStickyRevision(");
    expect(check, "组归属判定消失了——豁免条目随之失效").toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeLessThan(read);
    expect(check).toBeLessThan(write);
  });
});
