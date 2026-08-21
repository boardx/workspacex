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
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintUiMaterial, extractRefs, extractSelfCheck, normalizeRef } from "./lint-ui-material.mjs";

let root: string;
const PHASE = "phase-test";
const BUNDLE = "demo";
const DIR = "ui-preview/demo-shots";

function uiMdFor(bundle: string, dir: string, refs: string[], n = refs.length, m = refs.length) {
  return [
    `# 契约束 \`${bundle}\` — ① UI`,
    "",
    `> **自检：本文件引用 ${n} 张截图，目录下实际 ${m} 张。**`,
    "",
    ...refs.map((r, i) => `| ${i + 1} | \`${dir}/${r}\` | default | 说明 |`),
  ].join("\n");
}

function uiMd(refs: string[], n = refs.length, m = refs.length) {
  return uiMdFor(BUNDLE, DIR, refs, n, m);
}

function writeMap(m: unknown) {
  const p = join(root, "map.json");
  writeFileSync(p, JSON.stringify(m));
  return p;
}

function shots(names: string[]) {
  shotsFor(PHASE, DIR, names);
}

function shotsFor(phase: string, dir: string, names: string[]) {
  const d = join(root, "phases", phase, dir);
  mkdirSync(d, { recursive: true });
  for (const n of names) writeFileSync(join(d, n), "png");
}

function ui(body: string) {
  uiFor(PHASE, BUNDLE, body);
}

function uiFor(phase: string, bundle: string, body: string) {
  const d = join(root, "phases", phase, "contracts", bundle);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "ui.md"), body);
}

function reuseUi(bundle: string, target: string, targetDir: string, refs: string[], declaredTarget = target) {
  return [
    `# 契约束 \`${bundle}\` — ① UI`,
    "",
    `> **UI material reuse: no new screen; reuse_bundle: \`${declaredTarget}\`.**`,
    `> **自检：本文件引用 ${refs.length} 张截图，目录下实际 ${refs.length} 张。**`,
    "",
    ...refs.map((r, i) => `| ${i + 1} | \`${targetDir}/${r}\` | reused from ${target} |`),
  ].join("\n");
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

describe("显式同 phase 束复用", () => {
  const TARGET = "shared-screen";
  const REUSER = "reuser";
  const TARGET_DIR = "ui-preview/shared-screen";

  function writeValidTarget(names = ["a.png", "b.png"]) {
    shotsFor(PHASE, TARGET_DIR, names);
    uiFor(PHASE, TARGET, uiMdFor(TARGET, TARGET_DIR, names));
  }

  it("正例：复用束可引用目标束的原始截图路径，不复制图片", () => {
    writeValidTarget();
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png", "b.png"]));

    const map = { [PHASE]: { [TARGET]: TARGET_DIR, [REUSER]: { reuse_bundle: TARGET } } };
    const { errors, rows } = run(writeMap(map));

    expect(errors).toEqual([]);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: `${PHASE}/${TARGET}`, dir: TARGET_DIR, referenced: 2, actual: 2 }),
      expect.objectContaining({ label: `${PHASE}/${REUSER}`, dir: TARGET_DIR, reusedFrom: TARGET, referenced: 2, actual: 2 }),
    ]));
    expect(existsSync(join(root, "phases", PHASE, "ui-preview", REUSER))).toBe(false);
  });

  it("目标束缺失 => fail closed 并点名目标", () => {
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"]));
    const { errors } = run(writeMap({ [PHASE]: { [REUSER]: { reuse_bundle: TARGET } } }));
    expect(errors.join("\n")).toContain("[复用目标缺失]");
    expect(errors.join("\n")).toContain(TARGET);
  });

  it("自引用 => fail closed", () => {
    uiFor(PHASE, REUSER, reuseUi(REUSER, REUSER, TARGET_DIR, ["a.png"]));
    const { errors } = run(writeMap({ [PHASE]: { [REUSER]: { reuse_bundle: REUSER } } }));
    expect(errors.join("\n")).toContain("[复用自身]");
  });

  it("复用对象含额外字段 => fail closed，不猜组合语义", () => {
    writeValidTarget(["a.png"]);
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"]));
    const map = {
      [PHASE]: {
        [TARGET]: TARGET_DIR,
        [REUSER]: { reuse_bundle: TARGET, screenshot_dir: TARGET_DIR },
      },
    };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[复用声明非法]");
  });

  it("循环复用 => fail closed，不会递归溢出", () => {
    uiFor(PHASE, "a", reuseUi("a", "b", "ui-preview/b", ["x.png"]));
    uiFor(PHASE, "b", reuseUi("b", "a", "ui-preview/a", ["x.png"]));
    const { errors } = run(writeMap({ [PHASE]: { a: { reuse_bundle: "b" }, b: { reuse_bundle: "a" } } }));
    expect(errors.join("\n")).toContain("[复用循环]");
  });

  it("链式复用 => fail closed，必须扁平化到 concrete 目标", () => {
    writeValidTarget(["a.png"]);
    uiFor(PHASE, "middle", reuseUi("middle", TARGET, TARGET_DIR, ["a.png"]));
    uiFor(PHASE, REUSER, reuseUi(REUSER, "middle", TARGET_DIR, ["a.png"]));
    const map = {
      [PHASE]: {
        [TARGET]: TARGET_DIR,
        middle: { reuse_bundle: TARGET },
        [REUSER]: { reuse_bundle: "middle" },
      },
    };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[复用链]");
    expect(errors.join("\n")).toContain("扁平化");
  });

  it("带 phase/目录的 target 不是同 phase 束名 => fail closed", () => {
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"], "phase-other/shared-screen"));
    const map = { [PHASE]: { [REUSER]: { reuse_bundle: "phase-other/shared-screen" } } };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[跨阶段复用]");
  });

  it("目标映射不是同 phase 内的 concrete ui-preview 目录 => fail closed", () => {
    writeValidTarget(["a.png"]);
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"]));
    const map = {
      [PHASE]: {
        [TARGET]: "../phase-other/ui-preview/shared-screen",
        [REUSER]: { reuse_bundle: TARGET },
      },
    };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[复用目标非 concrete]");
  });

  it("合法 reuse + 无关 plain mapping 用 ../ 跨 phase 读图 => 整体 fail closed", () => {
    writeValidTarget(["a.png"]);
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"]));

    const outsidePhase = "phase-other";
    const outsideDir = "ui-preview/outside";
    shotsFor(outsidePhase, outsideDir, ["leak.png"]);
    uiFor(
      PHASE,
      "unsafe-plain",
      uiMdFor("unsafe-plain", "ignored-by-bare-ref", ["leak.png"])
        .replace("ignored-by-bare-ref/leak.png", "leak.png"),
    );

    const map = {
      [PHASE]: {
        [TARGET]: TARGET_DIR,
        [REUSER]: { reuse_bundle: TARGET },
        "unsafe-plain": `../${outsidePhase}/${outsideDir}`,
      },
    };
    const { errors, rows } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[目录映射越界]");
    expect(errors.join("\n")).toContain("unsafe-plain");
    expect(rows.some((row: { label: string }) => row.label === `${PHASE}/unsafe-plain`)).toBe(false);
  });

  it("复用 ui.md 显式写了其他 phase 的截图路径 => fail closed", () => {
    writeValidTarget(["a.png"]);
    const body = reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"])
      .replace(`${TARGET_DIR}/a.png`, `phases/phase-other/${TARGET_DIR}/a.png`);
    uiFor(PHASE, REUSER, body);
    const map = { [PHASE]: { [TARGET]: TARGET_DIR, [REUSER]: { reuse_bundle: TARGET } } };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[跨阶段路径]");
  });

  it("复用束引用目标目录外的实存图 => fail closed", () => {
    writeValidTarget(["a.png"]);
    shotsFor(PHASE, "ui-preview/other", ["other.png"]);
    const body = reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"])
      .replace("| 1 |", "| 0 | `ui-preview/other/other.png` | forbidden |\n| 1 |");
    uiFor(PHASE, REUSER, body);
    const map = { [PHASE]: { [TARGET]: TARGET_DIR, [REUSER]: { reuse_bundle: TARGET } } };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[跨目录]");
    expect(errors.join("\n")).toContain("ui-preview/other/other.png");
  });

  it("伪装成目标前缀的 ../ 越界实存图 => 仍 fail closed", () => {
    writeValidTarget(["a.png"]);
    shotsFor(PHASE, "ui-preview/other", ["other.png"]);
    const body = reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png"])
      .replace(`${TARGET_DIR}/a.png`, `${TARGET_DIR}/../other/other.png`);
    uiFor(PHASE, REUSER, body);
    const map = { [PHASE]: { [TARGET]: TARGET_DIR, [REUSER]: { reuse_bundle: TARGET } } };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[跨目录]");
    expect(errors.join("\n")).toContain("../other/other.png");
  });

  it("目标束自身双向材料门禁失败 => 复用束不得借绿", () => {
    shotsFor(PHASE, TARGET_DIR, ["a.png", "orphan.png"]);
    uiFor(PHASE, TARGET, uiMdFor(TARGET, TARGET_DIR, ["a.png"], 1, 2));
    uiFor(PHASE, REUSER, reuseUi(REUSER, TARGET, TARGET_DIR, ["a.png", "orphan.png"]));
    const map = { [PHASE]: { [TARGET]: TARGET_DIR, [REUSER]: { reuse_bundle: TARGET } } };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[未被引用]");
    expect(errors.join("\n")).toContain("[复用目标未通过]");
  });

  it("复用 ui.md 必须显式声明 no new screen 并点名同一目标束", () => {
    writeValidTarget(["a.png"]);
    uiFor(PHASE, REUSER, uiMdFor(REUSER, TARGET_DIR, ["a.png"]));
    const map = { [PHASE]: { [TARGET]: TARGET_DIR, [REUSER]: { reuse_bundle: TARGET } } };
    const { errors } = run(writeMap(map));
    expect(errors.join("\n")).toContain("[缺复用声明]");
  });
});

describe("反向反证 —— 它在仓库的真实状态下必须是绿的", () => {
  it("phase-01 十个束当前全绿（一道永远红的门控等于没有）", () => {
    const { errors, rows } = lintUiMaterial({});
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) {
      if (r.shared) {
        // 共用目录组的不变量是「组内并集 == 实存集」，不是逐束相等——
        // 单束 3/18 是正确状态。逐束断言在这里会把正确状态判成红。
        // 组级并集由 lintUiMaterial 自己在 errors 里兜底（上面已断言 errors 为空）。
        expect(r.referenced).toBeGreaterThan(0);
        expect(r.orphans).toBe(0);
      } else {
        expect(r.referenced).toBe(r.actual);
      }
    }
  });

  it("共用目录组真实存在，且组内并集恰好等于实存集（不是靠放宽判定过的）", () => {
    const { rows } = lintUiMaterial({});
    const shared = rows.filter((r) => r.shared);
    // 这条断言绑死 phase-10 的真实结构：5 个束共用一个 18 张图的扁平目录。
    // 如果有人把共用模式滥用到别处，或 phase-10 结构变了，这里会红，逼人重新核对。
    expect(shared.length).toBe(5);
    for (const r of shared) expect(r.actual).toBe(18);
    const sum = shared.reduce((n, r) => n + r.referenced, 0);
    // 22 > 18：束之间**确实存在重叠引用**——这正是当初无法拆成互不相交子目录、
    // 必须引入共用模式的原因。若哪天这个和等于 18，说明重叠没了，该退回普通映射。
    expect(sum).toBeGreaterThan(18);
  });
});
