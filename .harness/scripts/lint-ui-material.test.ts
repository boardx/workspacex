/**
 * lint-ui-material 的反证套件。
 *
 * 本仓已九次「全绿但空转」。写完门控立刻造反证是纪律，不是可选项：
 * 每一条断言都对应一种**真实发生过或极可能发生**的破坏方式，先确认它会红，
 * 才有资格相信它绿的时候说明了什么。
 *
 * 这里用 tmp 目录搭合成 phase，不碰仓库里的真材料。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintUiMaterial, extractRefs, extractSelfCheck, normalizeRef } from "./lint-ui-material.mjs";

let root: string;
const PHASE = "phase-test";
const BUNDLE = "demo";
const DIR = "ui-preview/demo-shots";

function uiMd(refs: string[], n = refs.length, m = refs.length) {
  return [
    `# 契约束 \`${BUNDLE}\` — ① UI`,
    "",
    `> **自检：本文件引用 ${n} 张截图，目录下实际 ${m} 张。**`,
    "",
    ...refs.map((r, i) => `| ${i + 1} | \`${DIR}/${r}\` | default | 说明 |`),
  ].join("\n");
}

function writeMap(m: unknown) {
  const p = join(root, "map.json");
  writeFileSync(p, JSON.stringify(m));
  return p;
}

function shots(names: string[]) {
  const d = join(root, "phases", PHASE, DIR);
  mkdirSync(d, { recursive: true });
  for (const n of names) writeFileSync(join(d, n), "png");
}

function ui(body: string) {
  const d = join(root, "phases", PHASE, "contracts", BUNDLE);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "ui.md"), body);
}

const OK_MAP = { [PHASE]: { [BUNDLE]: DIR } };

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ui-material-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** 不带参数时 lintUiMaterial 扫的是真仓库；测试显式把 root/phasesRoot 指到 tmp。 */
function run(mapFile: string) {
  return lintUiMaterial({ root, mapFile, phasesRoot: join(root, "phases") });
}

describe("extractRefs —— 抽取本身不能骗人", () => {
  it("认得中文文件名（手写 grep 的那版 `[a-z0-9-]+` 正是在这里返回 0 处命中的）", () => {
    const refs = extractRefs("| 1 | `ui-preview/itv-v2/uc-6-0-访谈列表-default.png` | default |");
    expect(refs.map((r: { raw: string }) => r.raw)).toEqual([
      "ui-preview/itv-v2/uc-6-0-访谈列表-default.png",
    ]);
  });
  it("跳过占位符与命令里的正则，不把它们当死链", () => {
    const body = "命名规则 `<uc>-<屏>.png`；`ls ui-preview/x/*.png`；`[a-z0-9-]+\\.png`；后缀是 `.png`";
    expect(extractRefs(body)).toHaveLength(0);
  });
  it("裸文件名按声明目录归一，绝对路径按 ui-preview/ 截断", () => {
    expect(normalizeRef("a.png", "ui-preview/tpl")).toBe("ui-preview/tpl/a.png");
    expect(normalizeRef("phases/p/ui-preview/tpl/a.png", "ui-preview/tpl")).toBe("ui-preview/tpl/a.png");
  });
  it("读得出顶部自检行的 N / M", () => {
    expect(extractSelfCheck("# x\n> **自检：本文件引用 **19** 张截图，目录下实际 19 张。**")).toEqual({
      declaredN: 19, declaredM: 19,
    });
  });
});

describe("反证 —— 逐条破坏必须变红", () => {
  it("基线：引用集 == 实存集 ⇒ 绿", () => {
    shots(["a.png", "b.png"]);
    ui(uiMd(["a.png", "b.png"]));
    const { errors, rows } = run(writeMap(OK_MAP));
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ referenced: 2, actual: 2, orphans: 0 });
  });

  it("① 塞一条不存在的 .png ⇒ 点名那条路径", () => {
    shots(["a.png"]);
    ui(uiMd(["a.png", "ghost.png"], 1, 1));
    const { errors } = run(writeMap(OK_MAP));
    expect(errors.join("\n")).toContain("[死链]");
    expect(errors.join("\n")).toContain("ghost.png");
  });

  it("② 目录里多一张没被引用的 png ⇒ 点名那个文件名", () => {
    shots(["a.png", "orphan.png"]);
    ui(uiMd(["a.png"], 1, 2));
    const { errors } = run(writeMap(OK_MAP));
    expect(errors.join("\n")).toContain("[未被引用]");
    expect(errors.join("\n")).toContain("orphan.png");
  });

  it("③ 删掉束↔目录映射 ⇒ 报「未声明」，不是静默跳过", () => {
    shots(["a.png"]);
    ui(uiMd(["a.png"]));
    const { errors, rows } = run(writeMap({ [PHASE]: {} }));
    expect(errors.join("\n")).toContain("[未声明]");
    expect(rows).toHaveLength(0);           // 没有被当成「查过且通过」
  });

  it("④ 目录不存在 ⇒ 报出来，不是 0/0 全绿（空集使断言平凡为真）", () => {
    ui(uiMd([]));                            // 只有 ui.md，没建截图目录
    const { errors } = run(writeMap(OK_MAP));
    expect(errors.join("\n")).toContain("[目录缺失]");
  });

  it("④' 目录存在但一张 png 都没有 ⇒ 同样是失败", () => {
    mkdirSync(join(root, "phases", PHASE, DIR), { recursive: true });
    ui(uiMd([]));
    const { errors } = run(writeMap(OK_MAP));
    expect(errors.join("\n")).toContain("[目录为空]");
  });

  it("⑤ 顶部自检行数字过时 ⇒ 报出来（那行字是同一事实的第二份副本）", () => {
    shots(["a.png", "b.png"]);
    ui(uiMd(["a.png", "b.png"], 40, 40));
    const { errors } = run(writeMap(OK_MAP));
    expect(errors.join("\n")).toContain("[自检行过时]");
  });

  it("⑥ 引用了别束目录里的图 ⇒ 报跨目录（防 interview 悄悄拿被推翻的 v1 充数）", () => {
    shots(["a.png"]);
    const other = join(root, "phases", PHASE, "ui-preview/old-v1");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "z.png"), "png");
    ui(uiMd(["a.png"]).replace("| 1 |", "| 0 | `ui-preview/old-v1/z.png` | old |\n| 1 |"));
    const { errors } = run(writeMap(OK_MAP));
    expect(errors.join("\n")).toContain("[跨目录]");
  });

  it("⑦ 一个 ui.md 都找不到 ⇒ 失败，而不是「没对象所以全绿」", () => {
    mkdirSync(join(root, "phases"), { recursive: true });
    const { errors } = run(writeMap({}));
    expect(errors.join("\n")).toContain("门控无对象可查");
  });
});

describe("反向反证 —— 它在仓库的真实状态下必须是绿的", () => {
  it("phase-01 十个束当前全绿（一道永远红的门控等于没有）", () => {
    const { errors, rows } = lintUiMaterial({});
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) expect(r.referenced).toBe(r.actual);
  });
});
