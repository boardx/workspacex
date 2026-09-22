/**
 * `lint-ui-wiring` 的**行为**测试（issue #397）—— 断的是"门会不会红"，不是源码字符串。
 *
 * 做法与 `lint-rewrite-coverage-strict.test.ts` 同型：真的 spawn 脚本，用 `--root` 指向
 * 一份最小假仓库（`fixtures/ui-wiring/`，一条完整接线的 `/widgets`），先证明**干净夹具
 * 是绿的**（门不是恒红），再逐个注入缺陷，证明每一种都会红。
 *
 * ⚠ 第 ② 条是这道门存在的全部理由：**页面存在、适配器存在、controller 也存在，
 *   但那个 controller 没被 `kernel.module.ts` 的 `controllers[]` 挂进去**——
 *   用户点进去什么都拿不到，而在这道门之前，全仓没有任何检查会因此变红
 *   （`lint-ui-material` 只管截图、`lint-nav-reachability` 只管导航走得到、
 *   `lint-rewrite-coverage` 只管 controller ↔ rewrites 成对）。
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, ".harness", "scripts", "lint-ui-wiring.mjs");
const FIXTURE = join(ROOT, ".harness", "scripts", "fixtures", "ui-wiring");

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** 把夹具拷进临时目录（变异只发生在拷贝上，工作树一个字节都不动）。 */
function fixtureCopy(): string {
  dir = mkdtempSync(join(tmpdir(), "ui-wiring-fixture-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function run(root: string): { code: number; out: string } {
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, "--root", root], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function write(root: string, rel: string, body: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

function patchManifest(root: string, mutate: (m: Record<string, any>) => void): void {
  const p = join(root, ".harness", "scripts", "ui-wiring-manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
  mutate(m);
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
}

/** 往夹具里加一条「屏 + 适配器 + 契约 + controller，但 controller 没挂进 kernel」的路由。 */
function addUnregisteredRoute(root: string): void {
  write(root, "apps/web/app/gadgets/page.tsx",
    'import { listGadgets } from "@/lib/live-gadgets";\n\nexport default function GadgetsPage() {\n  return <div>{listGadgets.name}</div>;\n}\n');
  write(root, "apps/web/lib/live-gadgets.ts",
    'import { gadgets } from "@repo/contracts";\nimport { apiRequest } from "./api-client";\n\nexport async function listGadgets() {\n  return apiRequest(gadgets.operations.listGadgets.path);\n}\n');
  write(root, "packages/contracts/src/gadgets.ts",
    'export const operations = {\n  listGadgets: { method: "GET", path: "/gadgets" },\n};\n');
  write(root, "packages/contracts/src/index.ts",
    'export * as widgets from "./widgets";\nexport * as gadgets from "./gadgets";\n');
  write(root, "apps/api/src/application/widgets/list-gadgets.ts", "export async function listGadgets() {\n  return [];\n}\n");
  write(root, "apps/api/src/interface/controllers/gadgets.controller.ts",
    'import { Controller, Get } from "@nestjs/common";\nimport { gadgets as C } from "@repo/contracts";\nimport { listGadgets } from "../../application/widgets/list-gadgets";\n\n@Controller()\nexport class GadgetsController {\n  @Get(C.operations.listGadgets.path)\n  async list() {\n    return listGadgets();\n  }\n}\n');
}

describe("lint-ui-wiring（#397 跨层接线门控）", () => {
  it("① 正样本：干净夹具退出 0 —— 门不是恒红", () => {
    const root = fixtureCopy();
    const r = run(root);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("已接线 1");
  });

  it("② 反证：屏和 controller 都在，但 controller 没挂进 kernel controllers[] ⇒ 红", () => {
    const root = fixtureCopy();
    addUnregisteredRoute(root);
    patchManifest(root, (m) => {
      m.routes["/gadgets"] = {
        kind: "wired",
        screen: "apps/web/app/gadgets/page.tsx",
        adapters: ["apps/web/lib/live-gadgets.ts"],
        contracts: ["gadgets"],
        controllers: ["GadgetsController"],
      };
      m.controllers.GadgetsController = { useCases: ["widgets/list-gadgets"] };
    });
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[controller 未挂载]");
    expect(r.out).toContain("GadgetsController");
  });

  it("③ 反证：同一条屏连 controller 都不声明（「接到后端」纯属口头）⇒ 红", () => {
    const root = fixtureCopy();
    addUnregisteredRoute(root);
    patchManifest(root, (m) => {
      m.routes["/gadgets"] = {
        kind: "wired",
        screen: "apps/web/app/gadgets/page.tsx",
        adapters: ["apps/web/lib/live-gadgets.ts"],
        contracts: ["gadgets"],
        controllers: [],
      };
    });
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[没接到 controller]");
    expect(r.out).toContain("[契约没有 controller]");
  });

  it("④ 反证：新页面不进清单 ⇒ 红（不许静默新增未归类的产品路由）", () => {
    const root = fixtureCopy();
    addUnregisteredRoute(root);
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[未声明路由]");
  });

  it("⑤ 反证：已接线路由的渲染路径回退 mock ⇒ 红", () => {
    const root = fixtureCopy();
    write(root, "apps/web/components/widgets/widgets-screen.tsx",
      '"use client";\nimport { MOCK_WIDGETS } from "@/lib/mock/widgets";\n\nexport function WidgetsScreen() {\n  return <ul>{MOCK_WIDGETS.length}</ul>;\n}\n');
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[产品路由回退 mock]");
  });

  it("⑥ 反证：把已挂载的 controller 从 kernel controllers[] 里摘掉 ⇒ 红", () => {
    const root = fixtureCopy();
    const kernel = join(root, "apps/api/src/kernel.module.ts");
    writeFileSync(kernel, readFileSync(kernel, "utf8").replace("    WidgetsController,\n", ""));
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[controller 未挂载]");
  });

  it("⑦ 反证：application 用例被改名 / 不再被 controller 调用 ⇒ 红", () => {
    const root = fixtureCopy();
    patchManifest(root, (m) => {
      m.controllers.WidgetsController.useCases = ["widgets/archive-widget"];
    });
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[用例不存在]");
  });

  it("⑧ 反证：棘轮只减不增 —— mock 路由超过冻结上限 ⇒ 红", () => {
    const root = fixtureCopy();
    write(root, "apps/web/app/legacy/page.tsx",
      'import { MOCK_WIDGETS } from "@/lib/mock/widgets";\n\nexport default function LegacyPage() {\n  return <div>{MOCK_WIDGETS.length}</div>;\n}\n');
    patchManifest(root, (m) => {
      m.routes["/legacy"] = { kind: "mock", screen: "apps/web/app/legacy/page.tsx", mocks: ["apps/web/lib/mock/widgets.ts"] };
    });
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[棘轮回退]");
  });

  it("⑨ 反证：接完线却忘了把自己那条从 mock 清单划掉（陈旧豁免）⇒ 红", () => {
    const root = fixtureCopy();
    patchManifest(root, (m) => {
      m.ratchet.maxMockRoutes = 1;
      m.routes["/widgets"] = { kind: "mock", screen: "apps/web/app/widgets/page.tsx", mocks: ["apps/web/lib/mock/widgets.ts"] };
      delete m.controllers.WidgetsController;
    });
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[陈旧豁免]");
  });

  it("⑩ 反证：扫不到任何 page / controller 时不许判绿（空集不是全绿）", () => {
    const root = fixtureCopy();
    rmSync(join(root, "apps/web/app"), { recursive: true, force: true });
    const r = run(root);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("[空扫描]");
  });
});
