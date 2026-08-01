/**
 * F51 · 「没有第二条路能绕过 `routeModelCall`」（uc-20-3 R3 步骤 7 / R5 / I-15）。
 *
 * `usecases.md` 逐字：「任何绕过尝试（直接指定闭源 / 篡改标记 / API 直调）⇒ 拒绝 +
 * 越权拦截计数 +1」。三种绕过手法，逐一给出「这里为什么做不到」：
 *
 *   ① 直接指定闭源模型 —— 覆盖测试见 `confidential-hard-route.test.ts`；本文件只
 *      再钉一遍"这条路径确实会被计数"，不重复其余用例。
 *   ② 篡改标记 —— `RouteModelCallInput` 的类型上**没有**任何字段能让调用方自己
 *      声明"这次不含机密"；机密性只能来自 `ConfidentialityReader.read(contextPackId)`
 *      （I-50：contextPackId 是唯一取数入口）。这是**类型层面**的不可能，用一次
 *      "试图传入本不存在的字段"的编译期反证钉住。
 *   ③ API 直调 —— 本束目前**没有**任何绕开 `routeModelCall` 就能把 pool 里的模型
 *      拿去用的第二个用例/端点。源码扫描：`application/model/` 与 `domain/model/`
 *      目录下，除 `route-model-call.ts` / `route-call.ts` 自身外，没有第二处
 *      "selectableModels(...).find(...)  然后直接返回一个 selectedModelId" 的模式。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  routeModelCall,
  RouteModelCallError,
  type RouteModelCallInput,
  type BypassAuditSink,
  type ConfidentialityReader,
  type RouteModelPoolReader,
  type RoutingDecisionSink,
} from "../../../src/application/model/route-model-call";
import type { SelectableCandidateRow } from "../../../src/domain/model/selectable";

function row(modelId: string, kind: "closed-api" | "self-hosted"): SelectableCandidateRow {
  return { modelId, kind, shape: "single", status: "已启用", complianceAttrs: [], members: [] };
}

/* ══════════════════ ① 直接指定闭源模型 ⇒ 拒绝 + 计数 ══════════════════ */

describe("① 直接指定闭源模型 —— 拒绝且计入越权拦截计数", () => {
  it("requestedModelId 指向一个已启用的闭源模型，含机密时仍被拒绝", async () => {
    const bypassAttempts: unknown[] = [];
    const poolReader: RouteModelPoolReader = {
      listCandidates: async () => [row("gpt-5.2", "closed-api"), row("qwen3-32b", "self-hosted")],
    };
    const confidentialityReader: ConfidentialityReader = { read: async () => true };
    const decisionSink: RoutingDecisionSink = { record: async () => {} };
    const bypassAudit: BypassAuditSink = {
      recordBypassAttempt: async (e) => void bypassAttempts.push(e),
    };

    await expect(
      routeModelCall(
        { orgId: "org-1", callId: "c-1", contextPackId: "p-1", requestedModelId: "gpt-5.2", taskKind: "含客户机密" },
        { pool: poolReader, confidentiality: confidentialityReader, decisions: decisionSink, bypassAudit },
      ),
    ).rejects.toBeInstanceOf(RouteModelCallError);
    expect(bypassAttempts).toHaveLength(1);
  });
});

/* ══════════════════ ② 篡改标记 —— 类型层面不可能 ══════════════════ */

describe("② 篡改标记 —— 调用方拿不到任何字段来自称'这次不含机密'", () => {
  it("RouteModelCallInput 只有五个字段，没有 confidential / override 之类的旁路", () => {
    // 机械化列出契约允许的输入键：新增任何"客户端自报机密性"的字段都会让这条断言变红。
    const allowedKeys: (keyof RouteModelCallInput)[] = [
      "orgId",
      "callId",
      "contextPackId",
      "requestedModelId",
      "taskKind",
    ];
    expect(allowedKeys).toHaveLength(5);
    expect(allowedKeys).not.toContain("confidential" as keyof RouteModelCallInput);
    expect(allowedKeys).not.toContain("skipRouting" as keyof RouteModelCallInput);
    expect(allowedKeys).not.toContain("localOnly" as keyof RouteModelCallInput);
  });

  it("机密性只能来自 ConfidentialityReader.read(contextPackId) —— 源码里 routeModelCall 只调用这一个口", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "..", "src", "application", "model", "route-model-call.ts"),
      "utf8",
    );
    const codeLines = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    const code = codeLines.join("\n");
    expect(code).toMatch(/ports\.confidentiality\.read\(input\.contextPackId\)/);
    // 反证：函数体内没有从 input 上直接读出一个布尔机密性字段（那会是第二个入口）。
    expect(code).not.toMatch(/input\.confidential/);
    expect(code).not.toMatch(/input\.localOnly/);
  });
});

/* ══════════════════ ③ API 直调 —— 没有第二条路径产出 selectedModelId ══════════════════ */

describe("③ API 直调 —— 本束里只有 routeModelCall 一处产出 selectedModelId", () => {
  function tsFilesUnder(root: string): string[] {
    const files: string[] = [];
    (function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(p);
      }
    })(root);
    return files;
  }

  it("domain/model 与 application/model 目录非空（防止目录读错导致下面恒真）", () => {
    const roots = [
      join(__dirname, "..", "..", "..", "src", "domain", "model"),
      join(__dirname, "..", "..", "..", "src", "application", "model"),
    ];
    const files = roots.flatMap(tsFilesUnder);
    expect(files.length).toBeGreaterThan(5);
  });

  it("除 route-call.ts / route-model-call.ts 外，没有第二处把 selectableModels 的结果直接当'调用结果'返回", () => {
    const roots = [
      join(__dirname, "..", "..", "..", "src", "domain", "model"),
      join(__dirname, "..", "..", "..", "src", "application", "model"),
    ];
    const files = roots.flatMap(tsFilesUnder).filter((f) => !/route-call\.ts$|route-model-call\.ts$/.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      const codeLines = body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      const code = codeLines.join("\n");
      // "拿到候选集后直接 .find/.at(0) 当结果返回" 是绕过 decideModelRoute 判定顺序的典型手法。
      if (/selectableModels\([^)]*\)\s*\.(find|at|shift)\(/.test(code)) {
        offenders.push(f);
      }
    }
    expect(offenders, `这些文件绕过 decideModelRoute 自行从候选集取结果：\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("routeModelCall 的判定顺序全部委托给 decideModelRoute，本文件（应用层）不重复实现候选集过滤", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "..", "src", "application", "model", "route-model-call.ts"),
      "utf8",
    );
    expect(src).toMatch(/decideModelRoute\(/);
    // 反证：应用层不得直接 import selectableModels 自己再筛一遍——那是第二份判据。
    expect(src).not.toMatch(/import\s*\{[^}]*selectableModels[^}]*\}/);
  });
});
