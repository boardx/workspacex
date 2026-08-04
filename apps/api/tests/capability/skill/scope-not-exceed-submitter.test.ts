/**
 * F61 · 数据范围越权检查（I-12 / I-24 / I-25；UC-3.1 E1、V6）。
 *
 * 三件事在这一份里，因为它们是同一条链的三段：
 *   ① 提交时：声明范围 ⊆ 提交人当时的权限 —— 越权**被拒且说得出理由**，**不进待审核队列**
 *   ② 运行时：有效范围 ＝ 声明范围 ∩ Context Pack 实际返回项
 *   ③ 结构上：skill 运行时读上下文**只经 Context API**，import 图里没有 DB/向量库客户端
 *
 * ③ 是 F61 的第二条反向断言（「绕过 Context API 直取数据的路径在编译期或测试期被挡住」）。
 * 它断言的是**门控抓到了什么**，不是「门控退出码为 0」——
 * 对着不存在的目录那个门控同样 exit 0，本仓已九次栽在这上面。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RAW_TRANSCRIPT_SCOPE,
  authorizeScopeRead,
  checkDataScopeWithinSubmitter,
  effectiveDataScope,
} from "../../../src/domain/skill/data-scope";
import { createSkillDraft } from "../../../src/application/skill/create-skill-draft";
import { resolveRuntimeContext } from "../../../src/application/skill/resolve-runtime-context";
import {
  collectAudit,
  collectDraftStore,
  contextApiReturning,
  grantsOf,
  validContract,
} from "../../support/skill-fakes";

const REPO = fileURLToPath(new URL("../../../../..", import.meta.url));
const GATE = join(REPO, "apps/api/scripts/lint-skill-context-api-only.mjs");

function runGate(...args: string[]): { code: number; out: string } {
  try {
    return {
      code: 0,
      out: execFileSync("node", [GATE, ...args], { cwd: REPO, encoding: "utf8", stdio: "pipe" }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const scanned = (out: string): number => Number(/scanned=(\d+)/.exec(out)?.[1] ?? "-1");

/* ────────────── ① 提交时：提交人权限是上界 ────────────── */

describe("声明范围 ⊆ 提交人当时的权限（I-12）", () => {
  it("范围之内 ⇒ 通过（不过火）", () => {
    const r = checkDataScopeWithinSubmitter({
      declared: ["project:notes", "project:files"],
      readsRawTranscript: false,
      submitterGrants: ["project:notes", "project:files", "org:templates"],
    });
    expect(r.ok).toBe(true);
    expect(r.mayEnterReviewQueue).toBe(true);
  });

  it("越出上界 ⇒ 拒，**逐条列出越权项**，并说得出理由", () => {
    const r = checkDataScopeWithinSubmitter({
      declared: ["project:notes", "org:finance", "org:hr"],
      readsRawTranscript: false,
      submitterGrants: ["project:notes"],
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("DATA_SCOPE_EXCEEDS_SUBMITTER");
    // 「逐条」是判据：界面要按项给「申请授权」入口，一句汇总话做不到。
    expect(r.exceeded).toEqual(["org:finance", "org:hr"]);
    expect(r.reason).toContain("org:finance");
    expect(r.reason).toContain("上界");
    expect(r.mayEnterReviewQueue).toBe(false);
  });

  it("E1：声明读原始转写但未获授权 ⇒ 具名子类 RAW_TRANSCRIPT_NOT_AUTHORIZED", () => {
    const r = checkDataScopeWithinSubmitter({
      declared: ["project:notes"],
      readsRawTranscript: true,
      submitterGrants: ["project:notes"],
    });
    expect(r.code).toBe("RAW_TRANSCRIPT_NOT_AUTHORIZED");
    expect(r.exceeded).toEqual([RAW_TRANSCRIPT_SCOPE]);
    expect(r.mayEnterReviewQueue).toBe(false);
  });

  it("持有原始转写授权 ⇒ 放行（两码不得合并成一个「反正是越权」）", () => {
    const r = checkDataScopeWithinSubmitter({
      declared: ["project:notes"],
      readsRawTranscript: true,
      submitterGrants: ["project:notes", RAW_TRANSCRIPT_SCOPE],
    });
    expect(r.ok).toBe(true);
  });

  it("同时命中两条时，报的是更具体的那一句", () => {
    const r = checkDataScopeWithinSubmitter({
      declared: ["org:finance"],
      readsRawTranscript: true,
      submitterGrants: [],
    });
    expect(r.code).toBe("RAW_TRANSCRIPT_NOT_AUTHORIZED");
  });
});

describe("越权 ⇒ 不入库、不进待审核队列（E1 / V6：行为，不是文案）", () => {
  it("越权提交时 saveDraft 一次都没被调用", async () => {
    const store = collectDraftStore();
    const r = await createSkillDraft(
      {
        orgId: "o1",
        submitterId: "u1",
        name: "财务口径核对",
        duty: "核对财务口径",
        contract: validContract({ dataScope: ["project:notes", "org:finance"] }),
        entry: "admin-new",
        // #459：契约 `createSkillDraft.in` 必填，此前用例层把它们丢了。
        visibility: "org-wide",
        ownerTeamId: null,
        modelRef: "model-default",
      },
      { grants: grantsOf("project:notes"), store, audit: collectAudit() },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("DATA_SCOPE_EXCEEDS_SUBMITTER");
    expect(r.exceeded).toEqual(["org:finance"]);
    expect(store.saved, "越权却入了库").toEqual([]);
    // 进了队列，审核人就会替提交人背这个书——他看到的是一份「已过校验」的待审项。
    expect(r.enteredReviewQueue).toBe(false);
  });

  it("V6：声明读原始转写但未获授权的提交，判校验失败且不进待审核队列", async () => {
    const store = collectDraftStore();
    const r = await createSkillDraft(
      {
        orgId: "o1",
        submitterId: "u1",
        name: "逐字稿要点",
        duty: "从原始转写提炼要点",
        contract: validContract({ readsRawTranscript: true }),
        entry: "admin-new",
        // #459：契约 `createSkillDraft.in` 必填，此前用例层把它们丢了。
        visibility: "org-wide",
        ownerTeamId: null,
        modelRef: "model-default",
      },
      { grants: grantsOf("project:notes"), store, audit: collectAudit() },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("RAW_TRANSCRIPT_NOT_AUTHORIZED");
    expect(store.saved).toEqual([]);
    expect(r.enteredReviewQueue).toBe(false);
  });
});

/* ────────────── ② 运行时：有效范围 ＝ 声明 ∩ Context Pack ────────────── */

describe("有效数据范围 ＝ 声明范围 ∩ Context Pack 实际返回项（I-24）", () => {
  it("交集，不是并集，也不是「声明了就能读」", () => {
    expect(effectiveDataScope(["a", "b", "c"], ["b", "c", "d"])).toEqual(["b", "c"]);
  });

  it("越出声明范围的取数被拒，且说得出理由", () => {
    const v = authorizeScopeRead({
      requested: "org:hr",
      declared: ["project:notes"],
      contextPackReturned: ["project:notes", "org:hr"],
    });
    // Context Pack 返回了它，声明里没有 ⇒ 依然拒：
    // 否则一次装配得慷慨的检索就成了越权通道。
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("不在该 skill 的声明数据范围内");
  });

  it("声明了但本次 pack 没返回 ⇒ 也拒，理由是另一句", () => {
    const v = authorizeScopeRead({
      requested: "org:hr",
      declared: ["org:hr"],
      contextPackReturned: ["project:notes"],
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("Context Pack 未返回");
  });

  it("两者都有 ⇒ 放行（不过火）", () => {
    const v = authorizeScopeRead({
      requested: "project:notes",
      declared: ["project:notes"],
      contextPackReturned: ["project:notes"],
    });
    expect(v.allowed).toBe(true);
  });

  it("运行时取上下文经 Context API，并留下可重放的 pack 句柄", async () => {
    const ctx = await resolveRuntimeContext(
      {
        runId: "run-1",
        orgId: "o1",
        principalId: "u1",
        query: "本项目的会议要点",
        declaredScope: ["project:notes", "org:finance"],
      },
      { contextApi: contextApiReturning("project:notes", "org:hr") },
    );

    expect(ctx.packId, "I-24：每次运行留一条 context_packs 记录").toBe("pack-1");
    expect(ctx.effectiveScope).toEqual(["project:notes"]);
    expect(ctx.authorizeRead("org:finance").allowed).toBe(false);
    expect(ctx.authorizeRead("org:hr").allowed).toBe(false);
    expect(ctx.authorizeRead("project:notes").allowed).toBe(true);
  });
});

/* ────────────── ③ 结构上：只经 Context API（I-25） ────────────── */

describe("skill 运行时只经 Context API —— 依赖规则门控（I-25）", () => {
  it("真的扫了 skill 的源码树（断言文件数，不是退出码）", () => {
    const r = runGate();
    expect(r.code, r.out).toBe(0);
    expect(scanned(r.out), "扫了 0 个文件——门控在空转").toBeGreaterThan(0);
  });

  it("反证：直连业务库 / 向量库 / 兄弟检索层，三种绕行全部被抓", () => {
    const r = runGate("apps/api/__fixtures__/skill-runtime-bad");
    expect(r.code, "违规 fixture 必须让门控变红").toBe(1);
    expect(r.out).toContain("direct-db.ts");
    expect(r.out).toContain("`pg`");
    // 动态 import 与静态 import 在运行时是同一件事，只认后者等于留了一条门。
    expect(r.out).toContain("dynamic-vector.ts");
    expect(r.out).toContain("@pinecone-database/pinecone");
    // 最容易被当成「没违规」的一种：不碰任何数据库客户端，自己拼一个 pack。
    expect(r.out).toContain("sibling-retrieval.ts");
    expect(r.out).toContain("自己拼一个 pack");
  });

  it("不过火：经 ContextApiPort 的正确写法必须放行", () => {
    const r = runGate("apps/api/__fixtures__/skill-runtime-good");
    expect(r.code, r.out).toBe(0);
    expect(scanned(r.out)).toBeGreaterThan(0);
  });

  it("门控挂在 apps/api 的 lint 任务上（不挂就是没上线）", () => {
    const pkg = JSON.parse(
      execFileSync("node", ["-p", `require("fs").readFileSync("${join(REPO, "apps/api/package.json")}","utf8")`], {
        encoding: "utf8",
      }),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["lint"]).toContain("lint-skill-context-api-only.mjs");
  });
});
