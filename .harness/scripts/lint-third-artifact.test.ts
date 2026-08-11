/**
 * lint-third-artifact 的反证套件。
 *
 * 这道门控管的是签核第 ③ 件（API 契约）。它诞生的直接原因是一次反证（CP-1）：
 * 造一个合规 fixture 阶段、**故意不建** `packages/contracts/src/<bundle>.ts`，
 * `auditSignoff` 的 fails=0、`verify-uc-coverage` 退出码 0 且打印「✅ 覆盖矩阵完整」。
 * 那次反证同时暴露第二条：只有一行 `# coverage` 的 coverage.md 也被判「完整」。
 *
 * 本仓已九次「全绿但空转」。写完门控立刻造反证是纪律：每一条断言都对应一种
 * 真实发生过的破坏方式，先确认它会红，才有资格相信它绿的时候说明了什么。
 *
 * 合成 phase 建在 tmp 目录，不碰仓库里的真材料；最后一组是**反向反证**，
 * 直接跑真仓库的 phase-00——一道永远红的门控等于没有。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintThirdArtifact, findNoHttpDeclaration, parseCoverageTables, hasExecutableCommand } from "./lint-third-artifact.mjs";

let root: string;
const PHASE = "phase-test";
const BUNDLE = "demo";

function write(rel: string, body: string) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
}

/** 一份合规的 coverage.md：一张以 R12 编号为行键的映射表，每行 API 格都有落点。 */
function coverage(apiCells: string[] = ["`UC-1 createThing`", "无 API 面（直连 SQL 断言 RLS）"]) {
  return [
    `# 契约束 \`${BUNDLE}\` — UC 覆盖证明`,
    "",
    "| V | 一句话 | API 操作 | 前端消费点 | 状态 |",
    "|---|---|---|---|---|",
    ...apiCells.map((a, i) => `| V${i + 1} | 线索 ${i + 1} | ${a} | \`thing-list\` | ✅ |`),
  ].join("\n");
}

function bundle({
  cov = coverage(),
  domain = "# 契约束 — ① 领域模型\n\n## 一、值对象\n\n略。",
  schema = "export const Thing = z.object({});",
}: { cov?: string; domain?: string | null; schema?: string | null } = {}) {
  write(`phases/${PHASE}/contracts/${BUNDLE}/coverage.md`, cov);
  if (domain !== null) write(`phases/${PHASE}/contracts/${BUNDLE}/domain.md`, domain);
  if (schema !== null) write(`packages/contracts/src/${BUNDLE}.ts`, schema);
}

function run() {
  return lintThirdArtifact({
    root,
    phasesRoot: join(root, "phases"),
    contractsSrc: join(root, "packages", "contracts", "src"),
    schemaMapFile: join(root, ".harness", "scripts", "third-artifact-map.json"),
  });
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "third-artifact-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("解析零件本身不能骗人", () => {
  it("「无 HTTP 面」只认标题行——正文里捎带一句 `HTTP 管道` 不算声明", () => {
    // api-kernel 的 domain.md 正文里真有「HTTP 管道」这句；按正文松匹配它会被误判成已声明。
    expect(findNoHttpDeclaration("正文提到 **HTTP 管道** 是本束契约对象之一。")).toBeNull();
    expect(findNoHttpDeclaration("## 三、③ 件为什么**不是** zod 契约文件")).toContain("③ 件");
    expect(findNoHttpDeclaration("### 本束没有业务 HTTP API")).toContain("HTTP");
  });

  it("只把「表头含 API 操作列 + 行键是 R12 编号」的表当映射表", () => {
    const body = [
      "| 门控 | 被哪条 R12 要求 | 结论 |", "|---|---|---|", "| `x.sh` | V2 | ✅ |", "",
      "| V | 一句话 | API 操作 | 状态 |", "|---|---|---|---|", "| **V4b** | 线索 | `UC-1 doIt` | ✅ |",
    ].join("\n");
    const t = parseCoverageTables(body);
    expect(t).toHaveLength(1);                       // 「反向检查」表不该被当成映射表
    expect(t[0].rows[0]).toMatchObject({ key: "V4b", api: "`UC-1 doIt`" });
  });

  it("认得可执行命令，不把 `UC-4 listThreads` 这种接口名当命令", () => {
    expect(hasExecutableCommand("`pnpm --filter api run typecheck`")).toBe(true);
    expect(hasExecutableCommand("`apps/web/scripts/lint-design.sh`（D-35）")).toBe(true);
    expect(hasExecutableCommand("`node .harness/scripts/lint-arch-deps.mjs`")).toBe(true);
    expect(hasExecutableCommand("`UC-4 listThreads`（同一 schema）")).toBe(false);
  });
});

describe("反证 —— 逐条破坏必须变红", () => {
  it("基线 · 形态 A：有 zod 契约文件 ⇒ 绿", () => {
    bundle();
    const { errors, rows } = run();
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ form: "A" });
  });

  it("基线 · 形态 A 复用：显式映射到既有契约文件 ⇒ 绿且不复制第二套 schema", () => {
    bundle({ schema: null });
    write("packages/contracts/src/interview.ts", "export const Interview = {};\n");
    write(
      ".harness/scripts/third-artifact-map.json",
      JSON.stringify({ [PHASE]: { [BUNDLE]: "interview" } }),
    );
    const { errors, rows } = run();
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ form: "A", schema: "packages/contracts/src/interview.ts" });
  });

  it("反证 · 契约复用映射的目标不存在 ⇒ 红并点名映射", () => {
    bundle({ schema: null });
    write(
      ".harness/scripts/third-artifact-map.json",
      JSON.stringify({ [PHASE]: { [BUNDLE]: "missing-contract" } }),
    );
    const { errors } = run();
    expect(errors.join("\n")).toContain("[契约复用目标缺失]");
    expect(errors.join("\n")).toContain("missing-contract");
  });

  it("基线 · 形态 B：显式声明无 HTTP 面 + API 列填门控命令 ⇒ 绿", () => {
    bundle({
      schema: null,
      domain: "# 域\n\n## 三、③ 件为什么**不是** zod 契约文件\n\n本束零后端、零 HTTP。",
      cov: coverage(["`pnpm --filter web run test`", "`node .harness/scripts/lint-design.sh`"]),
    });
    const { errors, rows } = run();
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ form: "B" });
  });

  it("① CP-1 本体：删掉 <bundle>.ts 且不作任何声明 ⇒ 点名该束报「第 ③ 件缺失」", () => {
    bundle({ schema: null });
    const { errors, rows } = run();
    expect(errors.join("\n")).toContain("[第 ③ 件缺失]");
    expect(errors.join("\n")).toContain(`packages/contracts/src/${BUNDLE}.ts`);
    expect(rows[0].form).toBeNull();
  });

  it("② 伪造「无 HTTP 面」声明但 API 列不填门控命令 ⇒ 仍红（一行字不能豁免第 ③ 件）", () => {
    bundle({
      schema: null,
      domain: "# 域\n\n## 三、③ 件为什么**不是** zod 契约文件\n\n随口一说。",
      cov: coverage(["`UC-1 createThing`", "`UC-2 listThings`"]),   // 是接口名，不是可执行命令
    });
    const { errors } = run();
    expect(errors.join("\n")).toContain("[声明无 HTTP 但无门控命令]");
    expect(errors.join("\n")).toContain("V1");
  });

  it("②' 声明了无 HTTP 面、连一张 R12 映射表都没有 ⇒ 红（不许拿空表换豁免）", () => {
    bundle({ schema: null, domain: "# 域\n\n## 三、本束没有业务 HTTP API", cov: "# coverage" });
    const { errors } = run();
    expect(errors.join("\n")).toContain("[声明无 HTTP 但无门控命令]");
  });

  it("②'' 「无 HTTP 面」不能从「文件不存在」反推 —— 沉默与声明必须长得不一样", () => {
    // 同一份 coverage（API 列填的是门控命令）：有声明 ⇒ 绿；把声明删掉 ⇒ 红。
    const cov = coverage(["`pnpm run test`", "`node x.mjs`"]);
    bundle({ schema: null, domain: "# 域\n\n## 三、③ 件为什么**不是** zod 契约文件", cov });
    expect(run().errors).toEqual([]);
    write(`phases/${PHASE}/contracts/${BUNDLE}/domain.md`, "# 域\n\n## 一、值对象");
    expect(run().errors.join("\n")).toContain("[第 ③ 件缺失]");
  });

  it("③ CP-1 第二条：coverage.md 只有一行标题 ⇒ 红，不是「覆盖矩阵完整」", () => {
    bundle({ cov: "# coverage" });
    const { errors } = run();
    expect(errors.join("\n")).toContain("[coverage 无映射表]");
  });

  it("③-b 某条 R12 既没落点又没具名缺口 ⇒ 点名那一行", () => {
    bundle({ cov: coverage(["`UC-1 createThing`", "——"]) });
    const { errors } = run();
    expect(errors.join("\n")).toContain("[R12 落点悬空]");
    expect(errors.join("\n")).toContain("V2");
  });

  it("③-b 反向：破折号 + **具名缺口**是合规的诚实（纪律第 10 条：缺口要有名字，不是不许有）", () => {
    const cov = [
      `# c`, "",
      "| V | 一句话 | API 操作 | 前端消费点 | 状态 |", "|---|---|---|---|---|",
      "| V1 | 线索 | `UC-1 doIt` | `x` | ✅ |",
      "| V2 | 删除本地组织被拒 | —— | —— | ⚠ **缺口 5** |",
    ].join("\n");
    bundle({ cov });
    expect(run().errors).toEqual([]);
  });

  it("③-b 判据是性质不是数量：只有一行 R12 但填满了 ⇒ 绿（行数下限会挡住正当新增）", () => {
    bundle({ cov: coverage(["`UC-1 doIt`"]) });
    expect(run().errors).toEqual([]);
  });

  it("④ 契约文件存在但零 export ⇒ 报「空契约」，不是绿", () => {
    bundle({ schema: "// TODO: 待填\nimport { z } from 'zod';\n" });
    const { errors } = run();
    expect(errors.join("\n")).toContain("[空契约]");
  });

  it("⑤ 空集防线：一个契约束都找不到 ⇒ 红，而不是「没对象所以全绿」", () => {
    mkdirSync(join(root, "phases"), { recursive: true });
    expect(run().errors.join("\n")).toContain("门控无对象可查");
  });

  it("⑤' 空集防线：有 contracts/ 目录却零个束目录 ⇒ 红", () => {
    mkdirSync(join(root, "phases", PHASE, "contracts"), { recursive: true });
    expect(run().errors.join("\n")).toContain("[零契约束]");
  });
});

describe("反向反证 —— 它在仓库的真实状态下必须能绿", () => {
  it("phase-00 六个束全绿：四束走形态 A，api-kernel / web-kernel 走形态 B", () => {
    const { errors, rows } = lintThirdArtifact({ only: ["phase-00-shared-kernel"] });
    expect(errors).toEqual([]);
    const form = new Map(rows.map((r: { label: string; form: string }) => [r.label.split("/")[1], r.form]));
    expect(form.get("api-kernel")).toBe("B");
    expect(form.get("web-kernel")).toBe("B");
    expect(form.get("identity")).toBe("A");
    expect(form.get("artifact")).toBe("A");
  });
});
